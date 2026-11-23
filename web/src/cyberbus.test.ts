import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  CyberBusError,
  CyberBusNetwork,
  type EasyTierFactory,
  type EasyTierTcpStream,
} from "./cyberbus";

const encoder = new TextEncoder();
const fixture = JSON.parse(
  readFileSync(
    new URL("../../testdata/cyberbus-derivation.json", import.meta.url),
    "utf8",
  ),
) as Record<string, string>;

function base64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

async function token(options: {
  subject?: string;
  scope?: string;
  resource?: string;
  product?: string;
  expiresAt?: number;
}) {
  const key = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-384" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = (await crypto.subtle.exportKey(
    "jwk",
    key.publicKey,
  )) as JsonWebKey;
  const kid = ["fixture", "signing", "key"].join("-");
  const header = base64Url(
    encoder.encode(JSON.stringify({ alg: "ES384", kid, typ: "JWT" })),
  );
  const claim = {
    version: 1,
    product_id: options.product ?? fixture.product_id,
    credential_epoch: fixture.epoch,
    account_seed_secret_hex: fixture.seed,
    max_devices: 256,
    virtual_cidr: "10.144.0.0/20",
    control_port: 11000,
    config_version: "1",
  };
  const claims = {
    iss: fixture.issuer,
    aud: options.resource ?? "https://cyberbus.example/api",
    client_id: "anywork-spa",
    sub: options.subject ?? fixture.subject,
    iat: Math.floor(Date.now() / 1000) - 1,
    nbf: Math.floor(Date.now() / 1000) - 1,
    exp: options.expiresAt ?? Math.floor(Date.now() / 1000) + 300,
    scope: options.scope ?? "openid connect network:join",
    kind: "AccessToken",
    "https://cyberbus.x.aixgg.com/easytier/credentials/v1": claim,
  };
  const payload = base64Url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-384" },
      key.privateKey,
      encoder.encode(signingInput),
    ),
  );
  return {
    token: `${signingInput}.${base64Url(signature)}`,
    publicJwk: {
      kty: publicJwk.kty,
      crv: publicJwk.crv,
      x: publicJwk.x,
      y: publicJwk.y,
      kid,
      alg: "ES384",
      use: "sig",
      key_ops: ["verify"],
    },
  };
}

function config(peers = ["wss://relay.example/"]) {
  return {
    issuer: fixture.issuer,
    clientId: "anywork-spa",
    resource: "https://cyberbus.example/api",
    productId: "product",
    peers,
    easyTierUrl: "/easytier-browser.js",
  };
}

function factory() {
  const stream: EasyTierTcpStream = {
    read: vi.fn(async () => ({ data: new Uint8Array(), eof: false })),
    write: vi.fn(async (bytes) => bytes.length),
    close: vi.fn(async () => {}),
  };
  const instance = {
    connectTcp: vi.fn(async () => stream),
    close: vi.fn(async () => {}),
  };
  const create = vi.fn<EasyTierFactory["create"]>(async () => instance);
  return { factory: { create }, create, instance, stream };
}

describe("host-owned CyberBus authorization", () => {
  it("verifies a real ES384 token, derives the Rust fixture and starts the overlay", async () => {
    const signed = await token({});
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration"))
        return Response.json({
          issuer: fixture.issuer,
          jwks_uri: fixture.issuer + "/jwks",
        });
      if (url === fixture.issuer + "/jwks")
        return Response.json({ keys: [signed.publicJwk] });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    try {
      const overlay = factory();
      const getAccessToken = vi.fn(async () => signed.token);
      const network = await CyberBusNetwork.start(config(), {
        subject: fixture.subject,
        getAccessToken,
        signal: new AbortController().signal,
        factory: overlay.factory,
      });
      expect(overlay.create).toHaveBeenCalledOnce();
      const material = overlay.create.mock.calls[0]![0];
      expect(material.networkName).toBe(fixture.network_name);
      expect(material.networkSecret).toBe(fixture.network_secret);
      expect(material.encryption).toBe(true);
      expect(overlay.create.mock.calls[0]![0].peers).toEqual(config().peers);
      expect(network.accessToken).toBe(signed.token);
      await expect(
        network.open("10.144.7.8", 11001, new AbortController().signal),
      ).resolves.toBeDefined();
      expect(overlay.instance.connectTcp).toHaveBeenCalledWith(
        "10.144.7.8:11001",
        { timeout: 15000 },
      );
      await expect(
        network.open("10.144.7.8", 11000, new AbortController().signal),
      ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
      await network.close();
      expect(overlay.instance.close).toHaveBeenCalledOnce();
      expect(getAccessToken).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    { scope: "openid connect" },
    { scope: "openid network:join" },
    { subject: "another-subject" },
    { product: "another-product" },
    { expiresAt: 1 },
  ])("rejects an invalid token contract: %j", async (invalid) => {
    const signed = await token(invalid);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration"))
        return Response.json({
          issuer: fixture.issuer,
          jwks_uri: fixture.issuer + "/jwks",
        });
      if (url === fixture.issuer + "/jwks")
        return Response.json({ keys: [signed.publicJwk] });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    try {
      const overlay = factory();
      await expect(
        CyberBusNetwork.start(config(), {
          subject: fixture.subject,
          getAccessToken: async () => signed.token,
          signal: new AbortController().signal,
          factory: overlay.factory,
        }),
      ).rejects.toBeInstanceOf(CyberBusError);
      expect(overlay.create).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
