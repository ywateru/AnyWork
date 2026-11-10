import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountLogtoClient } from "./accountAuth";
import { resolveAccountConfig } from "./accountConfig";

const sdk = vi.hoisted(() => ({
  get: vi.fn<(resource?: string) => Promise<string>>(),
  clear: vi.fn<() => Promise<void>>(),
  signOut: vi.fn<() => Promise<void>>(),
  signIn: vi.fn<() => Promise<void>>(),
}));
vi.mock("@logto/browser", () => ({
  default: class {
    adapter = { storage: {} };
    getAccessToken = sdk.get;
    clearAccessToken = sdk.clear;
    signOut = sdk.signOut;
    signIn = sdk.signIn;
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
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  sdk.clear.mockResolvedValue();
  sdk.get.mockResolvedValue("cached-token");
  sdk.signOut.mockResolvedValue();
  sdk.signIn.mockResolvedValue();
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
