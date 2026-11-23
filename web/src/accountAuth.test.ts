import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountLogtoClient, withAccountSubject } from "./accountAuth";
import { resolveAccountConfig } from "./accountConfig";

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
    const resource = c.getAccountAccessToken("cyberbus");
    const fresh = c.getAccountAccessToken("cyberbus", true);
    await vi.waitFor(() => expect(order).toEqual(["opaque"]));
    first.resolve("opaque-token");
    await expect(Promise.all([opaque, resource, fresh])).resolves.toEqual([
      "opaque-token",
      "resource-token",
      "resource-token",
    ]);
    expect(order).toEqual(["opaque", "cyberbus", "clear", "cyberbus"]);
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
    const rotating = c.getAccountAccessToken("cyberbus", true);
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
    await expect(c.getAccountAccessToken("cyberbus", true)).rejects.toThrow(
      "ACCOUNT_REAUTH_REQUIRED",
    );
    await expect(c.getAccountAccessToken()).rejects.toThrow(
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
  it("serializes UserInfo's SDK token request behind a resource refresh", async () => {
    const c = client(),
      held = deferred<string>();
    sdk.get.mockReturnValueOnce(held.promise).mockResolvedValue("opaque");
    const directory = c.getAccountAccessToken("cyberbus");
    const profile = c.getAccountUserInfo("owner", new AbortController().signal);
    await vi.waitFor(() => expect(sdk.get).toHaveBeenCalledOnce());
    expect(sdk.userInfo).not.toHaveBeenCalled();
    held.resolve("resource-token");
    await directory;
    expect((await profile).username).toBe("Synthetic user");
    expect(sdk.get.mock.calls).toEqual([["cyberbus"], [undefined]]);
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
