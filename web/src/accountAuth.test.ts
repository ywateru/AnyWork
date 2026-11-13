import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountLogtoClient, withAccountSubject } from "./accountAuth";
import { resolveAccountConfig } from "./accountConfig";
import type { AccessTokenRequest } from "./vendor/cybergrid";

const sdk = vi.hoisted(() => ({
  get: vi.fn<(resource?: string) => Promise<string>>(),
  clear: vi.fn<() => Promise<void>>(),
  signOut: vi.fn<() => Promise<void>>(),
  signIn: vi.fn<() => Promise<void>>(),
  claims: vi.fn<() => Promise<{ sub: string }>>(),
  userInfo: vi.fn<() => Promise<{ sub: string; username?: string }>>(),
}));
vi.mock("@logto/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@logto/browser")>()),
  default: class {
    adapter = { storage: {} };
    getAccessToken = sdk.get;
    clearAccessToken = sdk.clear;
    signOut = sdk.signOut;
    signIn = sdk.signIn;
    getIdTokenClaims = sdk.claims;
    async fetchUserInfo() {
      await this.getAccessToken();
      return sdk.userInfo();
    }
  },
  BrowserStorage: class {},
}));
function token(validFor: number) {
  const claims = Buffer.from(
    JSON.stringify({ exp: Date.now() / 1000 + validFor }),
  ).toString("base64url");
  return `eyJhbGciOiJFUzM4NCJ9.${claims}.fixture`;
}
function request(
  overrides: Partial<AccessTokenRequest> = {},
): AccessTokenRequest {
  const config = resolveAccountConfig({ MODE: "production" });
  return {
    issuer: config.issuer,
    clientId: config.appId,
    resource: config.resource,
    scopes: ["connect"],
    minValidity: 60,
    forceRefresh: false,
    requestReason: "connect",
    generation: 0,
    signal: new AbortController().signal,
    ...overrides,
  };
}
function client() {
  const config = resolveAccountConfig({ MODE: "production" });
  return new AccountLogtoClient(
    { endpoint: config.endpoint, appId: config.appId },
    config,
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  sdk.clear.mockResolvedValue();
  sdk.get.mockResolvedValue("cached-token");
  sdk.signOut.mockResolvedValue();
  sdk.signIn.mockResolvedValue();
  sdk.claims.mockResolvedValue({ sub: "owner" });
  sdk.userInfo.mockResolvedValue({ sub: "owner", username: "Synthetic user" });
});
describe("single browser refresh owner", () => {
  it("serializes opaque, resource and forced-fresh requests without overlapping rotation", async () => {
    const first = deferred<string>();
    const order: string[] = [];
    sdk.get.mockImplementation(async (resource) => {
      order.push(resource ?? "opaque");
      if (!resource) return first.promise;
      return "resource-token";
    });
    sdk.clear.mockImplementation(async () => {
      order.push("clear");
    });
    const c = client();
    const opaque = c.getAccountAccessToken();
    const resource = c.getAccountAccessToken("grid");
    const fresh = c.getAccountAccessToken("grid", true);
    await vi.waitFor(() => expect(order).toEqual(["opaque"]));
    first.resolve("opaque-token");
    await expect(Promise.all([opaque, resource, fresh])).resolves.toEqual([
      "opaque-token",
      "resource-token",
      "resource-token",
    ]);
    expect(order).toEqual(["opaque", "grid", "clear", "grid"]);
  });
  it("fences queued and in-flight tokens before logout, then clears after the only rotation", async () => {
    const exchange = deferred<string>();
    const order: string[] = [];
    sdk.get.mockImplementation(async () => {
      order.push("exchange");
      return exchange.promise;
    });
    sdk.signOut.mockImplementation(async () => {
      order.push("logout");
    });
    const c = client();
    const rotating = c.getAccountAccessToken("grid", true);
    const queued = c.getAccountAccessToken();
    void rotating.catch(() => {});
    void queued.catch(() => {});
    await vi.waitFor(() => expect(sdk.get).toHaveBeenCalledOnce());
    const logout = c.endAccountSession();
    expect(sdk.signOut).not.toHaveBeenCalled();
    exchange.resolve("late-token");
    await expect(rotating).rejects.toThrow("ACCOUNT_REAUTH_REQUIRED");
    await expect(queued).rejects.toThrow("ACCOUNT_REAUTH_REQUIRED");
    await logout;
    expect(order).toEqual(["exchange", "logout"]);
    await expect(c.getAccountAccessToken()).rejects.toThrow(
      "ACCOUNT_REAUTH_REQUIRED",
    );
    expect(sdk.get).toHaveBeenCalledOnce();
  });
  it("does not replay a possibly rotated grant after a failed SDK exchange", async () => {
    sdk.get.mockRejectedValueOnce(new Error("transport-lost"));
    const c = client();
    await expect(c.getAccountAccessToken("grid", true)).rejects.toThrow(
      "ACCOUNT_REAUTH_REQUIRED",
    );
    await expect(c.getAccountAccessToken()).rejects.toThrow(
      "ACCOUNT_REAUTH_REQUIRED",
    );
    await expect(c.getAccountAccessToken("grid", true)).rejects.toThrow(
      "ACCOUNT_REAUTH_REQUIRED",
    );
    expect(sdk.get).toHaveBeenCalledOnce();
    expect(sdk.clear).toHaveBeenCalledOnce();
    await c.startAccountSignIn({
      redirectUri: "https://example.com/app/callback",
    });
    expect(sdk.signIn).toHaveBeenCalledOnce();
  });
});

describe("CyberGrid host token contract", () => {
  it.each([
    { issuer: "https://other.invalid/oidc" },
    { clientId: "other" },
    { resource: "https://other.invalid/api" },
    { scopes: [] },
    { scopes: ["connect", "openid"] },
    { minValidity: 0 },
    { minValidity: 3601 },
    { minValidity: 1.5 },
    { forceRefresh: true },
    { requestReason: "authorization-rejected" },
    { generation: -1 },
    { generation: NaN },
  ] as Partial<AccessTokenRequest>[])(
    "rejects a mismatched request before accessing the grant: %j",
    async (invalid) => {
      await expect(
        client().getCyberGridAccessToken(request(invalid)),
      ).rejects.toMatchObject({ code: "INVALID_TOKEN_REQUEST" });
      expect(sdk.get).not.toHaveBeenCalled();
      expect(sdk.clear).not.toHaveBeenCalled();
    },
  );
  it("uses a sufficiently fresh cached resource token without forcing rotation", async () => {
    const cached = token(300);
    sdk.get.mockResolvedValue(cached);
    await expect(client().getCyberGridAccessToken(request())).resolves.toBe(
      cached,
    );
    expect(sdk.clear).not.toHaveBeenCalled();
    expect(sdk.get).toHaveBeenCalledExactlyOnceWith(request().resource);
  });
  it("refreshes a near-expiry token once through the same owner", async () => {
    const renewed = token(300);
    sdk.get.mockResolvedValueOnce(token(20)).mockResolvedValueOnce(renewed);
    await expect(client().getCyberGridAccessToken(request())).resolves.toBe(
      renewed,
    );
    expect(sdk.get).toHaveBeenCalledTimes(2);
    expect(sdk.clear).toHaveBeenCalledOnce();
  });
  it("an explicit rejection forces only one fresh attempt even if its token is too short", async () => {
    sdk.get.mockResolvedValue(token(20));
    const c = client();
    await expect(
      c.getCyberGridAccessToken(
        request({
          forceRefresh: true,
          requestReason: "authorization-rejected",
        }),
      ),
    ).rejects.toMatchObject({ code: "TOKEN_VALIDITY_INSUFFICIENT" });
    expect(sdk.get).toHaveBeenCalledOnce();
    expect(sdk.clear).toHaveBeenCalledOnce();
    // A valid but short token does not mean an OAuth rotation was lost.
    await expect(c.getAccountAccessToken()).resolves.toEqual(
      expect.any(String),
    );
  });
  it.each(["not-a-jwt", token(1)])(
    "fails explicitly when one renewal still cannot meet freshness",
    async (short) => {
      sdk.get.mockResolvedValue(short);
      await expect(
        client().getCyberGridAccessToken(request()),
      ).rejects.toMatchObject({ code: "TOKEN_VALIDITY_INSUFFICIENT" });
      expect(sdk.get).toHaveBeenCalledTimes(2);
      expect(sdk.clear).toHaveBeenCalledOnce();
    },
  );
  it("drops a canceled queued request before touching the SDK", async () => {
    const held = deferred<string>();
    sdk.get.mockReturnValueOnce(held.promise);
    const c = client(),
      controller = new AbortController();
    const first = c.getAccountAccessToken();
    const canceled = c.getCyberGridAccessToken(
      request({ signal: controller.signal }),
    );
    void canceled.catch(() => {});
    controller.abort();
    held.resolve("opaque");
    await first;
    await expect(canceled).rejects.toMatchObject({ name: "AbortError" });
    expect(sdk.get).toHaveBeenCalledOnce();
  });
  it("finishes a canceled in-flight rotation before another resource can acquire the grant", async () => {
    const held = deferred<string>();
    sdk.get.mockReturnValueOnce(held.promise).mockResolvedValue("opaque");
    const c = client(),
      controller = new AbortController();
    const canceled = c.getCyberGridAccessToken(
      request({
        forceRefresh: true,
        requestReason: "authorization-rejected",
        signal: controller.signal,
      }),
    );
    void canceled.catch(() => {});
    await vi.waitFor(() => expect(sdk.get).toHaveBeenCalledOnce());
    controller.abort();
    const next = c.getAccountAccessToken();
    await Promise.resolve();
    expect(sdk.get).toHaveBeenCalledOnce();
    held.resolve(token(300));
    await expect(canceled).rejects.toMatchObject({ name: "AbortError" });
    await expect(next).resolves.toBe("opaque");
    expect(sdk.clear).toHaveBeenCalledOnce();
  });
  it("does not start OAuth if canceled while invalidating the local cache", async () => {
    const held = deferred<void>(),
      controller = new AbortController();
    sdk.clear.mockReturnValueOnce(held.promise);
    const c = client();
    const canceled = c.getCyberGridAccessToken(
      request({
        forceRefresh: true,
        requestReason: "authorization-rejected",
        signal: controller.signal,
      }),
    );
    void canceled.catch(() => {});
    await vi.waitFor(() => expect(sdk.clear).toHaveBeenCalledOnce());
    controller.abort();
    held.resolve();
    await expect(canceled).rejects.toMatchObject({ name: "AbortError" });
    expect(sdk.get).not.toHaveBeenCalled();
    await expect(c.getAccountAccessToken()).resolves.toBe("cached-token");
  });
  it("fences a late Grid token and queued requests when a new sign-in changes owner", async () => {
    const held = deferred<string>();
    sdk.get.mockReturnValueOnce(held.promise);
    const c = client();
    const old = c.getCyberGridAccessToken(request());
    void old.catch(() => {});
    await vi.waitFor(() => expect(sdk.get).toHaveBeenCalledOnce());
    const signIn = c.startAccountSignIn({
      redirectUri: "https://example.com/app/callback",
    });
    held.resolve(token(300));
    await expect(old).rejects.toThrow("ACCOUNT_REAUTH_REQUIRED");
    await signIn;
    expect(sdk.signIn).toHaveBeenCalledOnce();
  });
  it("retains the failed-rotation fence even when the SDK stopped waiting", async () => {
    const held = deferred<string>(),
      controller = new AbortController();
    sdk.get.mockReturnValueOnce(held.promise);
    const c = client();
    const canceled = c.getCyberGridAccessToken(
      request({ signal: controller.signal }),
    );
    void canceled.catch(() => {});
    await vi.waitFor(() => expect(sdk.get).toHaveBeenCalledOnce());
    controller.abort();
    held.reject(new Error("rotation-outcome-unknown"));
    await expect(canceled).rejects.toThrow("ACCOUNT_REAUTH_REQUIRED");
    await expect(c.getAccountAccessToken()).rejects.toThrow(
      "ACCOUNT_REAUTH_REQUIRED",
    );
    expect(sdk.get).toHaveBeenCalledOnce();
  });
});

describe("account subject fence", () => {
  it("captures the old subject before a delayed first claims read", async () => {
    let subject = "old";
    const held = deferred<{ sub: string }>(),
      operation = vi.fn(async () => "token");
    const result = withAccountSubject(
      () => subject,
      () => held.promise,
      operation,
    );
    subject = "new";
    held.resolve({ sub: "new" });
    await expect(result).rejects.toMatchObject({ code: "IDENTITY_CHANGED" });
    expect(operation).not.toHaveBeenCalled();
  });
  it("rejects a late token after the subject changes during acquisition", async () => {
    let subject: string | undefined = "old";
    const held = deferred<string>();
    const result = withAccountSubject(
      () => subject,
      async () => ({ sub: subject }),
      () => held.promise,
    );
    await Promise.resolve();
    subject = undefined;
    held.resolve("late");
    await expect(result).rejects.toMatchObject({ code: "IDENTITY_CHANGED" });
  });
});

describe("official UserInfo API ownership", () => {
  it("serializes UserInfo's SDK token request behind a directory refresh", async () => {
    const c = client(),
      held = deferred<string>();
    sdk.get.mockReturnValueOnce(held.promise).mockResolvedValue("opaque");
    const directory = c.getAccountAccessToken("directory");
    const profile = c.getAccountUserInfo("owner", new AbortController().signal);
    await vi.waitFor(() => expect(sdk.get).toHaveBeenCalledOnce());
    expect(sdk.userInfo).not.toHaveBeenCalled();
    held.resolve("directory-token");
    await directory;
    expect((await profile).username).toBe("Synthetic user");
    expect(sdk.get.mock.calls).toEqual([["directory"], [undefined]]);
  });
  it("does not poison the refresh owner on a UserInfo network failure", async () => {
    const c = client(),
      signal = new AbortController().signal;
    sdk.userInfo.mockRejectedValueOnce(new Error("offline"));
    await expect(c.getAccountUserInfo("owner", signal)).rejects.toThrow(
      "offline",
    );
    expect((await c.getAccountUserInfo("owner", signal)).username).toBe(
      "Synthetic user",
    );
    expect(sdk.signIn).not.toHaveBeenCalled();
  });
  it("rejects a foreign UserInfo response and mismatching SDK claims", async () => {
    const c = client(),
      signal = new AbortController().signal;
    sdk.userInfo.mockResolvedValueOnce({
      sub: "foreign",
      username: "Foreign name",
    });
    await expect(c.getAccountUserInfo("owner", signal)).rejects.toMatchObject({
      code: "IDENTITY_CHANGED",
    });
    sdk.claims.mockResolvedValue({ sub: "foreign" });
    await expect(c.getAccountUserInfo("owner", signal)).rejects.toMatchObject({
      code: "IDENTITY_CHANGED",
    });
    expect(sdk.userInfo).toHaveBeenCalledOnce();
  });
  it.each(["logout", "sign-in", "abort"])(
    "fences a late official response after %s",
    async (change) => {
      const c = client(),
        controller = new AbortController(),
        held = deferred<{ sub: string; username: string }>();
      sdk.userInfo.mockReturnValue(held.promise);
      const result = c.getAccountUserInfo("owner", controller.signal);
      await vi.waitFor(() => expect(sdk.userInfo).toHaveBeenCalledOnce());
      if (change === "logout") await c.endAccountSession();
      else if (change === "sign-in")
        await c.startAccountSignIn({
          redirectUri: "https://example.com/app/callback",
        });
      else controller.abort();
      held.resolve({ sub: "owner", username: "Late name" });
      await expect(result).rejects.toThrow();
    },
  );
  it("blocks further refreshes if UserInfo's token exchange outcome is unknown", async () => {
    const c = client();
    sdk.get.mockRejectedValueOnce(new Error("refresh lost"));
    await expect(
      c.getAccountUserInfo("owner", new AbortController().signal),
    ).rejects.toThrow("ACCOUNT_REAUTH_REQUIRED");
    await expect(c.getAccountAccessToken()).rejects.toThrow(
      "ACCOUNT_REAUTH_REQUIRED",
    );
    expect(sdk.get).toHaveBeenCalledOnce();
  });
});
