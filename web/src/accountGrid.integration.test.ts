import { createServer, type ServerResponse } from "node:http";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AccountLogtoClient, withAccountSubject } from "./accountAuth";
import type { AccountConfig } from "./accountConfig";
import { CyberGridClient, type AccessTokenRequest } from "./vendor/cybergrid";

// Real vendored SDK, fetch and HTTP. Only the OAuth grant provider is isolated;
// no real account, business gateway, or upstream service is mutated.
const epoch = "00000000-0000-4000-8000-000000000001";
const account: AccountConfig = {
  endpoint: "https://identity.fixture.invalid",
  issuer: "https://identity.fixture.invalid/oidc",
  appId: "FixtureWeb",
  nativeAppId: "FixtureNative",
  resource: "https://grid.fixture.invalid/api",
  gridUrl: "http://127.0.0.1:3344",
};
const authConfig = {
  provider: "logto",
  issuer: account.issuer,
  clientId: account.appId,
  resource: account.resource,
  scope: "openid offline_access profile email connect",
  authorizationEndpoint: account.issuer + "/auth",
  tokenEndpoint: account.issuer + "/token",
  revocationEndpoint: account.issuer + "/token/revocation",
  jwksUri: account.issuer + "/jwks",
  coordination: { protocol: "memory-v1", epoch },
};
const device = {
  id: "fixture-device",
  name: "Fixture computer",
  online: true,
  lastSeen: "2026-11-12T00:00:00.000Z",
  ports: [
    {
      id: "anywork-remote",
      type: "anywork-noise-v1",
      transport: "tcp",
      port: 12345,
      tunnelUrl: "https://fixture-gateway.trycloudflare.com",
    },
  ],
};
type Call = {
  path: string;
  method: string;
  body: Record<string, unknown>;
  authorization?: string;
  epoch?: string;
};
let calls: Call[],
  configExtra: Record<string, unknown>,
  devices: unknown[],
  user: string;
let onExchange:
  | ((call: Call, response: ServerResponse) => boolean | Promise<boolean>)
  | undefined;
let onDevices:
  ((response: ServerResponse) => boolean | Promise<boolean>) | undefined;
const grids: CyberGridClient[] = [];
function send(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, {
    "content-type": "application/json",
    "x-cybergrid-epoch": epoch,
  });
  response.end(JSON.stringify(data));
}
function session() {
  return {
    purpose: "console",
    sessionKey: "s".repeat(43),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    coordinatorEpoch: epoch,
    user: { id: user },
  };
}
function jwt(suffix = "fresh", validFor = 300) {
  return `eyJhbGciOiJFUzM4NCJ9.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + validFor })).toString("base64url")}.${suffix}`;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString();
  const call: Call = {
    path: request.url!,
    method: request.method!,
    body: raw ? JSON.parse(raw) : {},
    authorization: request.headers.authorization,
    epoch: request.headers["x-cybergrid-epoch"] as string | undefined,
  };
  calls.push(call);
  if (call.path === "/api/v1/console/auth/config?clientId=" + account.appId)
    return send(response, 200, { ...authConfig, ...configExtra });
  if (call.path === "/api/v1/console/auth/exchange") {
    if (await onExchange?.(call, response)) return;
    return send(response, 200, session());
  }
  if (call.method === "DELETE" && call.path === "/api/v1/console/session")
    return send(response, 200, { ok: true });
  if (call.authorization !== "Bearer " + "s".repeat(43) || call.epoch !== epoch)
    return send(response, 401, { error: { code: "INVALID_SESSION" } });
  if (call.path === "/api/v1/console/apps")
    return send(response, 200, {
      source: "logto",
      apps: [
        {
          id: account.nativeAppId,
          name: "AnyWork",
          type: "Native",
          isDeviceFlow: false,
        },
      ],
    });
  if (call.path.startsWith("/api/v1/console/devices?")) {
    if (await onDevices?.(response)) return;
    return send(response, 200, { devices });
  }
  send(response, 404, { error: { code: "NOT_FOUND" } });
});
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3344, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  calls = [];
  configExtra = {};
  devices = [structuredClone(device)];
  user = "fixture-owner";
  onExchange = undefined;
  onDevices = undefined;
});
afterEach(async () => {
  await Promise.all(grids.splice(0).map((grid) => grid.disconnect()));
  vi.restoreAllMocks();
});
function setup(timeoutMs = 1000) {
  const owner = new AccountLogtoClient(
    { endpoint: account.endpoint, appId: account.appId },
    account,
  );
  const get = vi.spyOn(owner, "getAccessToken").mockResolvedValue(jwt());
  const clear = vi.spyOn(owner, "clearAccessToken").mockResolvedValue();
  const provider = vi.fn((request: AccessTokenRequest) =>
    owner.getCyberGridAccessToken(request),
  );
  const grid = new CyberGridClient({
    baseUrl: account.gridUrl,
    issuer: account.issuer,
    clientId: account.appId,
    resource: account.resource,
    getAccessToken: provider,
    timeoutMs,
  });
  grids.push(grid);
  return { owner, get, clear, provider, grid };
}
describe("official CyberGrid SDK through legacy HTTP", () => {
  it("discovers the original port without policy, bridge, or directory migration", async () => {
    const { grid, provider, clear } = setup();
    await grid.connect();
    expect(await grid.apps()).toEqual([
      {
        id: account.nativeAppId,
        name: "AnyWork",
        type: "Native",
        isDeviceFlow: false,
      },
    ]);
    expect(await grid.devices(account.nativeAppId)).toEqual([device]);
    expect(
      await grid.getPortTunnelUrl(
        account.nativeAppId,
        device.id,
        "anywork-remote",
      ),
    ).toBe(device.ports[0].tunnelUrl);
    expect(clear).not.toHaveBeenCalled();
    expect(provider).toHaveBeenCalledOnce();
    expect(provider.mock.calls[0][0]).toMatchObject({
      issuer: account.issuer,
      clientId: account.appId,
      resource: account.resource,
      scopes: ["connect"],
      minValidity: 60,
      forceRefresh: false,
      requestReason: "connect",
      generation: 0,
    });
    expect(
      calls.every((call) => !/directory|bridge|admission/.test(call.path)),
    ).toBe(true);
  });
  it("an exact first INVALID_IDENTITY rejection refreshes once using the original request ID", async () => {
    const { grid, provider, get, clear } = setup();
    get
      .mockResolvedValueOnce(jwt("cached"))
      .mockResolvedValueOnce(jwt("renewed"));
    let attempts = 0;
    onExchange = (_call, response) => {
      if (attempts++ === 0) {
        send(response, 401, { error: { code: "INVALID_IDENTITY" } });
        return true;
      }
      return false;
    };
    await grid.connect();
    const exchanges = calls.filter((call) => call.method === "POST");
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0].body.requestId).toBe(exchanges[1].body.requestId);
    expect(exchanges[0].body.accessToken).not.toBe(
      exchanges[1].body.accessToken,
    );
    expect(
      provider.mock.calls.map(([request]) => [
        request.forceRefresh,
        request.requestReason,
      ]),
    ).toEqual([
      [false, "connect"],
      [true, "authorization-rejected"],
    ]);
    expect(clear).toHaveBeenCalledOnce();
  });
  it.each([
    [401, "APPLICATION_MISMATCH"],
    [401, "INVALID_SESSION"],
    [403, "FORBIDDEN"],
    [500, "INTERNAL_ERROR"],
  ])("does not force refresh for %s %s", async (status, code) => {
    const { grid, provider, clear } = setup();
    onExchange = (_call, response) => {
      send(response, status as number, { error: { code } });
      return true;
    };
    await expect(grid.connect()).rejects.toHaveProperty("stage", "exchange");
    expect(provider).toHaveBeenCalledOnce();
    expect(clear).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });
  it("never retries force-refresh after a second explicit identity rejection", async () => {
    const { grid, provider, clear } = setup();
    onExchange = (_call, response) => {
      send(response, 401, { error: { code: "INVALID_IDENTITY" } });
      return true;
    };
    await expect(grid.connect()).rejects.toHaveProperty(
      "code",
      "AUTHENTICATION_FAILED",
    );
    expect(provider).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenCalledOnce();
  });
  it("recovers an unknown exchange with the same RAM token and request ID", async () => {
    const { grid, provider, clear } = setup();
    let attempts = 0;
    onExchange = (_call, response) => {
      if (attempts++ === 0) {
        response.destroy();
        return true;
      }
      return false;
    };
    await expect(grid.connect()).rejects.toMatchObject({
      reason: "exchange-outcome-unknown",
    });
    await grid.connect();
    const exchanges = calls.filter((call) => call.method === "POST");
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0].body).toEqual(exchanges[1].body);
    expect(provider).toHaveBeenCalledOnce();
    expect(clear).not.toHaveBeenCalled();
  });
  it("an INVALID_IDENTITY after unknown outcome cannot create another token request", async () => {
    const { grid, provider, clear } = setup();
    let attempts = 0;
    onExchange = (_call, response) => {
      if (attempts++ === 0) response.destroy();
      else send(response, 401, { error: { code: "INVALID_IDENTITY" } });
      return true;
    };
    await expect(grid.connect()).rejects.toMatchObject({
      reason: "exchange-outcome-unknown",
    });
    await expect(grid.connect()).rejects.toMatchObject({
      code: "SESSION_UNAVAILABLE",
      reason: "exchange-outcome-unknown",
      retryable: false,
    });
    expect(provider).toHaveBeenCalledOnce();
    expect(clear).not.toHaveBeenCalled();
    const exchanges = calls.filter((call) => call.method === "POST");
    expect(exchanges[0].body).toEqual(exchanges[1].body);
  });
  it("SDK cancellation stops exchange while its in-flight OAuth owner finishes", async () => {
    const { owner, grid, provider, get } = setup();
    const held = deferred<string>(),
      controller = new AbortController();
    get.mockReturnValueOnce(held.promise).mockResolvedValue("opaque");
    const connecting = grid.connect({ signal: controller.signal });
    void connecting.catch(() => {});
    await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
    controller.abort();
    await expect(connecting).rejects.toMatchObject({ code: "CANCELLED" });
    const next = owner.getAccountAccessToken();
    expect(get).toHaveBeenCalledOnce();
    held.resolve(jwt());
    await expect(provider.mock.results[0].value).rejects.toHaveProperty(
      "code",
      "CANCELLED",
    );
    await expect(next).resolves.toBe("opaque");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });
  it("changing account during token acquisition cannot register the old Grid instance", async () => {
    const { owner, grid, provider, get } = setup();
    let subject = "old";
    const held = deferred<string>();
    get.mockReturnValueOnce(held.promise);
    provider.mockImplementation((request) =>
      withAccountSubject(
        () => subject,
        async () => ({ sub: subject }),
        () => owner.getCyberGridAccessToken(request),
      ),
    );
    const connecting = grid.connect();
    void connecting.catch(() => {});
    await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
    subject = "new";
    held.resolve(jwt());
    await expect(connecting).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
    });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });
  it("rejects a changed verified exchange subject during coordination recovery", async () => {
    const { grid, provider, clear } = setup();
    await grid.connect();
    onDevices = (response) => {
      user = "other-owner";
      send(response, 401, { error: { code: "INVALID_SESSION" } });
      return true;
    };
    await expect(grid.devices(account.nativeAppId)).rejects.toMatchObject({
      code: "IDENTITY_CHANGED",
    });
    expect(
      provider.mock.calls.map(([request]) => request.requestReason),
    ).toEqual(["connect", "coordination-recovery"]);
    expect(clear).not.toHaveBeenCalled();
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  });
  it("cancels a real delayed directory response when its owner disconnects", async () => {
    const { grid } = setup();
    const entered = deferred<void>(),
      release = deferred<void>();
    onDevices = async () => {
      entered.resolve();
      await release.promise;
      return false;
    };
    await grid.connect();
    const result = grid.devices(account.nativeAppId);
    void result.catch(() => {});
    await entered.promise;
    await grid.disconnect();
    release.resolve();
    await expect(result).rejects.toMatchObject({ code: "CANCELLED" });
    expect(grid.getLoginState()).toBe("disconnected");
  });
  it("accepts static canonical product metadata but denies a product outside that policy", async () => {
    const { grid } = setup();
    configExtra = {
      policyVersion: "a".repeat(64),
      products: [{ id: account.nativeAppId, name: "AnyWork" }],
    };
    await grid.connect();
    expect(await grid.devices(account.nativeAppId)).toEqual([device]);
    const count = calls.length;
    await expect(grid.devices("OtherProduct")).rejects.toMatchObject({
      code: "CONFIGURATION_MISMATCH",
    });
    expect(calls).toHaveLength(count);
  });
  it.each([
    "missing-products",
    "duplicate-device",
    "bad-date",
    "custom-port-url",
  ])(
    "fails closed for malformed policy or legacy directory: %s",
    async (invalid) => {
      const { grid, provider } = setup();
      if (invalid === "missing-products") {
        configExtra = { policyVersion: "a".repeat(64) };
        await expect(grid.connect()).rejects.toMatchObject({
          code: "INVALID_RESPONSE",
        });
        expect(provider).not.toHaveBeenCalled();
        return;
      }
      if (invalid === "duplicate-device") devices = [device, device];
      if (invalid === "bad-date")
        devices = [{ ...device, lastSeen: "not-a-date" }];
      if (invalid === "custom-port-url")
        devices = [
          {
            ...device,
            ports: [
              {
                ...device.ports[0],
                tunnelUrl: "https://untrusted.invalid/path",
              },
            ],
          },
        ];
      await grid.connect();
      await expect(grid.devices(account.nativeAppId)).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    },
  );
});
