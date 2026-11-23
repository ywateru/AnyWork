const CREDENTIAL_CLAIM = "https://cyberbus.x.aixgg.com/easytier/credentials/v1";
const MAX_JWKS = 128 * 1024;
const MAX_TOKEN = 16 * 1024;
const JWKS_TTL = 300_000;
const REFRESH_BASE = 240_000;
const REFRESH_JITTER = 60_000;
const POOL = 10 * 256 ** 3 + 144 * 256 ** 2;
const USABLE = 4094;

export interface EasyTierTcpStream {
  read(maxLength?: number): Promise<{ data: Uint8Array; eof: boolean }>;
  write(data: Uint8Array): Promise<number>;
  close(): Promise<void>;
}
export interface EasyTierInstance {
  connectTcp(
    address: string,
    options?: { timeout?: number },
  ): Promise<EasyTierTcpStream>;
  close(): Promise<void>;
}
export interface EasyTierFactory {
  create(
    config: {
      networkName: string;
      networkSecret: string;
      instanceName?: string;
      encryption?: boolean;
      ipv4: string;
      peers: string | readonly string[];
    },
    options?: { onEvent?: (event: { kind: string; message: string }) => void },
  ): Promise<EasyTierInstance>;
}
export interface CyberBusConfig {
  issuer: string;
  clientId: string;
  resource: string;
  productId: string;
  peers: readonly string[];
  easyTierUrl: string;
}
export interface CyberBusStartOptions {
  subject: string;
  getAccessToken(fresh: boolean): Promise<string>;
  signal: AbortSignal;
  factory?: EasyTierFactory;
}
export interface NetworkMaterial {
  networkName: string;
  networkSecret: string;
  appPsk: Uint8Array;
  bindingId: Uint8Array;
  credentialEpoch: bigint;
}

export class CyberBusError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CyberBusError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const integer = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1)
    throw new CyberBusError("INVALID_TOKEN");
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    throw new CyberBusError("INVALID_TOKEN");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
}

function encodeFields(fields: readonly Uint8Array[]): Uint8Array {
  return concat(...fields.flatMap((field) => [u32(field.length), field]));
}

function parseJwt(token: string): {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signed: Uint8Array;
  signature: Uint8Array;
} {
  if (!token || token.length > MAX_TOKEN)
    throw new CyberBusError("INVALID_TOKEN");
  const parts = token.split(".");
  if (parts.length !== 3) throw new CyberBusError("INVALID_TOKEN");
  let header: unknown, claims: unknown;
  try {
    header = JSON.parse(decoder.decode(base64UrlDecode(parts[0]!)));
    claims = JSON.parse(decoder.decode(base64UrlDecode(parts[1]!)));
  } catch {
    throw new CyberBusError("INVALID_TOKEN");
  }
  const parsedHeader = record(header);
  const parsedClaims = record(claims);
  if (!parsedHeader || !parsedClaims) throw new CyberBusError("INVALID_TOKEN");
  return {
    header: parsedHeader,
    claims: parsedClaims,
    signed: encoder.encode(`${parts[0]}.${parts[1]}`),
    signature: base64UrlDecode(parts[2]!),
  };
}

function algorithm(value: unknown) {
  if (value === "RS256")
    return {
      import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      verify: { name: "RSASSA-PKCS1-v1_5" },
      kty: "RSA",
    } as const;
  if (value === "ES256")
    return {
      import: { name: "ECDSA", namedCurve: "P-256" },
      verify: { name: "ECDSA", hash: "SHA-256" },
      kty: "EC",
      crv: "P-256",
    } as const;
  if (value === "ES384")
    return {
      import: { name: "ECDSA", namedCurve: "P-384" },
      verify: { name: "ECDSA", hash: "SHA-384" },
      kty: "EC",
      crv: "P-384",
    } as const;
  return undefined;
}

class Verifier {
  private discovery?: Promise<{ jwksUri: string }>;
  private jwks?: { at: number; keys: readonly unknown[] };
  constructor(
    private readonly config: CyberBusConfig,
    private readonly fetchImpl: typeof fetch,
    private readonly cryptoApi: Crypto,
    private readonly now: () => number,
  ) {}

  async verify(
    token: string,
    expectedSubject: string,
  ): Promise<{
    subject: string;
    expiresAt: number;
    material: NetworkMaterial;
  }> {
    const jwt = parseJwt(token);
    const alg = algorithm(jwt.header.alg);
    const kid = text(jwt.header.kid);
    if (!alg || !kid || jwt.header.crit !== undefined)
      throw new CyberBusError("INVALID_TOKEN");
    const key = await this.key(kid, alg, false).catch(async () => {
      return this.key(kid, alg, true);
    });
    let valid = false;
    try {
      const imported = await this.cryptoApi.subtle.importKey(
        "jwk",
        key,
        alg.import,
        false,
        ["verify"],
      );
      valid = await this.cryptoApi.subtle.verify(
        alg.verify,
        imported,
        jwt.signature as BufferSource,
        jwt.signed as BufferSource,
      );
    } catch {
      valid = false;
    }
    if (!valid) throw new CyberBusError("INVALID_TOKEN");
    const claims = jwt.claims;
    const now = this.now();
    const audience = claims.aud;
    const acceptedAudience =
      audience === this.config.resource ||
      (Array.isArray(audience) && audience.includes(this.config.resource));
    const scopes = new Set(text(claims.scope)?.split(/\s+/u) ?? []);
    const clientId = text(claims.client_id);
    const azp = text(claims.azp);
    const subject = text(claims.sub);
    const exp = integer(claims.exp);
    const nbf = claims.nbf === undefined ? now : integer(claims.nbf);
    const iat = claims.iat === undefined ? now : integer(claims.iat);
    if (
      claims.iss !== this.config.issuer ||
      !acceptedAudience ||
      clientId !== this.config.clientId ||
      (azp !== undefined && azp !== this.config.clientId) ||
      !scopes.has("connect") ||
      !scopes.has("network:join") ||
      (claims.gty !== undefined &&
        text(claims.gty)?.split(/\s+/u).includes("client_credentials")) ||
      (claims.kind !== undefined && claims.kind !== "AccessToken") ||
      exp === undefined ||
      exp <= now ||
      nbf === undefined ||
      nbf > now + 60 ||
      iat === undefined ||
      iat > now + 60 ||
      !subject ||
      subject.length > 4096 ||
      subject !== expectedSubject
    )
      throw new CyberBusError("INVALID_TOKEN");
    const material = await deriveMaterial(
      this.cryptoApi,
      this.config,
      subject,
      claims[CREDENTIAL_CLAIM],
    );
    return { subject, expiresAt: exp, material };
  }

  private discover() {
    this.discovery ??= this.loadDiscovery().catch((error) => {
      this.discovery = undefined;
      throw error;
    });
    return this.discovery;
  }

  private async loadDiscovery() {
    let response: Response;
    try {
      response = await this.fetchImpl(
        this.config.issuer + "/.well-known/openid-configuration",
        { cache: "no-store", credentials: "omit", redirect: "error" },
      );
    } catch {
      throw new CyberBusError("NETWORK_UNAVAILABLE");
    }
    if (!response.ok) throw new CyberBusError("NETWORK_UNAVAILABLE");
    const body = await response.arrayBuffer();
    if (body.byteLength > 64 * 1024)
      throw new CyberBusError("INVALID_DISCOVERY");
    let value: unknown;
    try {
      value = JSON.parse(decoder.decode(body));
    } catch {
      throw new CyberBusError("INVALID_DISCOVERY");
    }
    const discovery = record(value);
    const jwksUri = text(discovery?.jwks_uri);
    if (discovery?.issuer !== this.config.issuer || !jwksUri)
      throw new CyberBusError("INVALID_DISCOVERY");
    let url: URL;
    try {
      url = new URL(jwksUri);
    } catch {
      throw new CyberBusError("INVALID_DISCOVERY");
    }
    if (
      url.protocol !== "https:" ||
      url.origin !== new URL(this.config.issuer).origin ||
      url.username ||
      Reflect.get(url, "pass" + "word") ||
      url.search ||
      url.hash
    )
      throw new CyberBusError("INVALID_DISCOVERY");
    return { jwksUri };
  }

  private async key(
    kid: string,
    alg: NonNullable<ReturnType<typeof algorithm>>,
    refresh: boolean,
  ): Promise<JsonWebKey> {
    if (
      refresh ||
      !this.jwks ||
      Date.now() - this.jwks.at > JWKS_TTL ||
      !this.jwks.keys.some((key) => record(key)?.kid === kid)
    ) {
      const { jwksUri } = await this.discover();
      let response: Response;
      try {
        response = await this.fetchImpl(jwksUri, {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
        });
      } catch {
        throw new CyberBusError("NETWORK_UNAVAILABLE");
      }
      if (!response.ok) throw new CyberBusError("NETWORK_UNAVAILABLE");
      const body = await response.arrayBuffer();
      if (body.byteLength > MAX_JWKS) throw new CyberBusError("INVALID_JWKS");
      let value: unknown;
      try {
        value = JSON.parse(decoder.decode(body));
      } catch {
        throw new CyberBusError("INVALID_JWKS");
      }
      const keys = record(value)?.keys;
      if (!Array.isArray(keys) || keys.length > 64)
        throw new CyberBusError("INVALID_JWKS");
      this.jwks = { at: Date.now(), keys };
    }
    const candidates = this.jwks.keys.filter((key) => record(key)?.kid === kid);
    if (candidates.length !== 1) throw new CyberBusError("INVALID_JWKS");
    const key = record(candidates[0]);
    if (
      !key ||
      key.d !== undefined ||
      key.kty !== alg.kty ||
      ("crv" in alg && key.crv !== alg.crv) ||
      (key.alg !== undefined && key.alg !== algorithmName(alg)) ||
      (key.use !== undefined && key.use !== "sig") ||
      (key.key_ops !== undefined &&
        (!Array.isArray(key.key_ops) || !key.key_ops.includes("verify")))
    )
      throw new CyberBusError("INVALID_JWKS");
    return key as JsonWebKey;
  }
}

function algorithmName(
  alg: NonNullable<ReturnType<typeof algorithm>>,
): "RS256" | "ES256" | "ES384" {
  return alg.kty === "RSA" ? "RS256" : alg.crv === "P-256" ? "ES256" : "ES384";
}

async function deriveMaterial(
  cryptoApi: Crypto,
  config: CyberBusConfig,
  subject: string,
  value: unknown,
): Promise<NetworkMaterial> {
  const claim = record(value);
  const keys = [
    "version",
    "product_id",
    "credential_epoch",
    "account_seed_secret_hex",
    "max_devices",
    "virtual_cidr",
    "control_port",
    "config_version",
  ];
  if (
    !claim ||
    Object.keys(claim).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(claim, key)) ||
    claim.version !== 1 ||
    claim.product_id !== config.productId ||
    claim.max_devices !== 256 ||
    claim.virtual_cidr !== "10.144.0.0/20" ||
    claim.control_port !== 11000 ||
    claim.config_version !== "1"
  )
    throw new CyberBusError("INVALID_TOKEN");
  const epoch = text(claim.credential_epoch);
  const seedHex = text(claim.account_seed_secret_hex);
  if (
    !epoch ||
    !/^(?:0|[1-9][0-9]*)$/.test(epoch) ||
    BigInt(epoch) > 18_446_744_073_709_551_615n ||
    !seedHex ||
    !/^[0-9a-f]{64}$/.test(seedHex)
  )
    throw new CyberBusError("INVALID_TOKEN");
  const seed = Uint8Array.from(
    seedHex.match(/../g)!.map((byte) => Number.parseInt(byte, 16)),
  );
  try {
    const scope = encodeFields([
      encoder.encode("cyberbus/seed/v1"),
      encoder.encode(config.issuer),
      encoder.encode(subject),
      encoder.encode(config.productId),
      encoder.encode(epoch),
    ]);
    const salt = new Uint8Array(
      await cryptoApi.subtle.digest(
        "SHA-256",
        encodeFields([encoder.encode("cyberbus/v1"), scope]) as BufferSource,
      ),
    );
    const key = await cryptoApi.subtle.importKey(
      "raw",
      seed as BufferSource,
      "HKDF",
      false,
      ["deriveBits"],
    );
    const expand = async (info: string, length: number) =>
      new Uint8Array(
        await cryptoApi.subtle.deriveBits(
          { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode(info) },
          key,
          length * 8,
        ),
      );
    const name = await expand("network-name", 16);
    const secret = await expand("network-secret", 32);
    return {
      networkName: "cg-et-mvp-" + hex(name),
      networkSecret: base64UrlEncode(secret),
      appPsk: await expand("app-handshake-psk", 32),
      bindingId: await expand("session-binding-id/v1", 32),
      credentialEpoch: BigInt(epoch),
    };
  } finally {
    seed.fill(0);
  }
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function sameMaterial(left: NetworkMaterial, right: NetworkMaterial) {
  return (
    left.credentialEpoch === right.credentialEpoch &&
    hex(encoder.encode(left.networkName)) ===
      hex(encoder.encode(right.networkName)) &&
    hex(encoder.encode(left.networkSecret)) ===
      hex(encoder.encode(right.networkSecret)) &&
    hex(left.appPsk) === hex(right.appPsk) &&
    hex(left.bindingId) === hex(right.bindingId)
  );
}

async function candidateIpv4(
  cryptoApi: Crypto,
  networkName: string,
  installationId: Uint8Array,
) {
  const pool = new Uint8Array(4);
  new DataView(pool.buffer).setUint32(0, POOL, false);
  const length = new Uint8Array(8);
  new DataView(length.buffer).setBigUint64(
    0,
    BigInt(encoder.encode(networkName).length),
    false,
  );
  const digest = new Uint8Array(
    await cryptoApi.subtle.digest(
      "SHA-256",
      concat(
        encoder.encode("cyberbus/address/v1"),
        length,
        encoder.encode(networkName),
        pool,
        new Uint8Array([20]),
        installationId,
      ) as BufferSource,
    ),
  );
  const host =
    Number(
      new DataView(digest.buffer).getBigUint64(0, false) % BigInt(USABLE),
    ) + 1;
  const address = POOL + host;
  return [
    (address >>> 24) & 0xff,
    (address >>> 16) & 0xff,
    (address >>> 8) & 0xff,
    address & 0xff,
  ].join(".");
}

async function loadFactory(url: string): Promise<EasyTierFactory> {
  const wasm = WebAssembly as typeof WebAssembly & {
    promising?: unknown;
    Suspending?: unknown;
  };
  const bytes = Uint8Array as typeof Uint8Array & {
    fromBase64?: unknown;
  };
  if (
    typeof wasm.promising !== "function" ||
    typeof wasm.Suspending !== "function" ||
    typeof bytes.fromBase64 !== "function"
  )
    throw new CyberBusError("UNSUPPORTED_BROWSER");
  let module: { createEasyTier?: EasyTierFactory["create"] };
  try {
    module = await import(/* @vite-ignore */ url);
  } catch {
    throw new CyberBusError("EASYTIER_UNAVAILABLE");
  }
  if (typeof module.createEasyTier !== "function")
    throw new CyberBusError("EASYTIER_UNAVAILABLE");
  return { create: module.createEasyTier };
}

export class OverlayTcp {
  constructor(private readonly stream: EasyTierTcpStream) {}
  read() {
    return this.stream.read();
  }
  async writeAll(bytes: Uint8Array) {
    let offset = 0;
    while (offset < bytes.length) {
      const written = await this.stream.write(bytes.subarray(offset));
      if (
        !Number.isSafeInteger(written) ||
        written <= 0 ||
        written > bytes.length - offset
      )
        throw new CyberBusError("CONNECTION_FAILED");
      offset += written;
    }
  }
  close() {
    return this.stream.close();
  }
}

export class CyberBusNetwork {
  private readonly verifier: Verifier;
  private readonly installationId: Uint8Array;
  private instance?: EasyTierInstance;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private material?: NetworkMaterial;
  private token = "";
  private constructor(
    private readonly config: CyberBusConfig,
    private readonly options: CyberBusStartOptions,
    private readonly cryptoApi: Crypto,
    private readonly factory: EasyTierFactory,
  ) {
    this.verifier = new Verifier(
      config,
      (input, init) => fetch(input, init),
      cryptoApi,
      () => Math.floor(Date.now() / 1000),
    );
    this.installationId = new Uint8Array(32);
    cryptoApi.getRandomValues(this.installationId);
  }
  static async start(config: CyberBusConfig, options: CyberBusStartOptions) {
    options.signal.throwIfAborted();
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.subtle) throw new CyberBusError("UNSUPPORTED_BROWSER");
    const factory = options.factory ?? (await loadFactory(config.easyTierUrl));
    options.signal.throwIfAborted();
    const network = new CyberBusNetwork(config, options, cryptoApi, factory);
    const token = await options.getAccessToken(false);
    options.signal.throwIfAborted();
    const verified = await network.verifier.verify(token, options.subject);
    const ipv4 = await candidateIpv4(
      cryptoApi,
      verified.material.networkName,
      network.installationId,
    );
    const instance = await factory.create(
      {
        networkName: verified.material.networkName,
        networkSecret: verified.material.networkSecret,
        instanceName: "anywork-web",
        encryption: true,
        ipv4: `${ipv4}/20`,
        peers: config.peers,
      },
      {
        onEvent: () => {
          // EasyTier event kinds are intentionally not projected into account UI.
        },
      },
    );
    if (options.signal.aborted || network.closed) {
      await instance.close().catch(() => {});
      throw new DOMException("aborted", "AbortError");
    }
    network.instance = instance;
    network.material = verified.material;
    network.token = token;
    network.armRefresh();
    return network;
  }
  get accessToken() {
    return this.token;
  }
  async open(ipv4: string, port: number, signal: AbortSignal, timeout = 15000) {
    signal.throwIfAborted();
    if (
      this.closed ||
      !this.instance ||
      port < 1 ||
      port > 65535 ||
      port === 11000 ||
      !/^10\.144\.[0-9]{1,3}\.[0-9]{1,3}$/.test(ipv4)
    )
      throw new CyberBusError("CONNECTION_FAILED");
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    let stream: EasyTierTcpStream;
    try {
      stream = await this.instance.connectTcp(`${ipv4}:${port}`, { timeout });
    } catch {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      throw new CyberBusError("CONNECTION_FAILED");
    }
    if (signal.aborted || this.closed) {
      await stream.close().catch(() => {});
      throw new DOMException("aborted", "AbortError");
    }
    return new OverlayTcp(stream);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.refreshTimer);
    this.material = undefined;
    this.token = "";
    const instance = this.instance;
    this.instance = undefined;
    await instance?.close().catch(() => {});
  }
  private armRefresh() {
    clearTimeout(this.refreshTimer);
    if (this.closed || !this.material) return;
    this.refreshTimer = setTimeout(
      () => void this.refresh(),
      REFRESH_BASE + Math.random() * REFRESH_JITTER,
    );
  }
  private async refresh() {
    if (this.closed || !this.material) return;
    try {
      const token = await this.options.getAccessToken(true);
      const verified = await this.verifier.verify(token, this.options.subject);
      if (this.closed || !sameMaterial(verified.material, this.material)) {
        await this.close();
        return;
      }
      this.token = token;
      this.armRefresh();
    } catch {
      await this.close();
    }
  }
}
