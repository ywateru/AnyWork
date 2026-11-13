import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountLogtoClient } from "./accountAuth";
import { accountStorageNamespace, resolveAccountConfig } from "./accountConfig";

// Actual BrowserStorage and installed SDK cache/refresh implementation. Only the
// browser storage host and HTTP responses are synthetic; no getter is replaced.
const config = resolveAccountConfig({ MODE: "production" });
const prefix = "logto:" + accountStorageNamespace(config) + ":";
function persisted(subject: string, generation = subject) {
  const header = Buffer.from(JSON.stringify({ alg: "ES384" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: subject,
      username: subject + " user",
      exp: Date.now() / 1000 + 300,
      iss: config.issuer,
      aud: config.appId,
      iat: Date.now() / 1000,
    }),
  ).toString("base64url");
  return {
    idToken: [header, payload, "synthetic-grant"].join("."),
    refreshToken: "refresh-" + generation,
    accessToken: JSON.stringify(
      Object.fromEntries(
        ["", config.resource].map((resource) => [
          "@" + resource,
          {
            token: generation + (resource ? "-resource" : "-opaque"),
            scope: "openid profile connect",
            expiresAt: Date.now() / 1000 + 300,
          },
        ]),
      ),
    ),
  };
}
function fixture() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  const replace = (grant: ReturnType<typeof persisted> | null) => {
    for (const key of ["idToken", "refreshToken", "accessToken"]) {
      if (grant) values.set(prefix + key, grant[key as keyof typeof grant]);
      else values.delete(prefix + key);
    }
  };
  const owner = () =>
    new AccountLogtoClient(
      { endpoint: config.endpoint, appId: config.appId },
      config,
    );
  const snapshot = () => Object.fromEntries(values);
  return { replace, owner, snapshot };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.unstubAllGlobals());

describe("installed SDK grant owner replacement", () => {
  it("fails closed without crashing construction when browser storage is denied", async () => {
    const f = fixture();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Storage denied");
      },
    });
    const a = f.owner();
    await expect(a.isAuthenticated()).rejects.toThrow(
      "ACCOUNT_REAUTH_REQUIRED",
    );
    await expect(a.getAccountAccessToken()).rejects.toThrow(
      "ACCOUNT_REAUTH_REQUIRED",
    );
  });

  it("rejects A's loaded opaque/resource caches before event delivery and creates clean B caches", async () => {
    const f = fixture();
    f.replace(persisted("A"));
    const a = f.owner();
    await expect(a.getAccountAccessToken()).resolves.toBe("A-opaque");
    await expect(a.getAccountAccessToken(config.resource)).resolves.toBe(
      "A-resource",
    );
    f.replace(persisted("B"));
    await expect(a.getAccountAccessToken()).rejects.toThrow(
      "ACCOUNT_REAUTH_REQUIRED",
    );
    await expect(a.getAccountAccessToken(config.resource)).rejects.toThrow(
      "ACCOUNT_REAUTH_REQUIRED",
    );
    await a.retireAccountOwner();
    const b = f.owner();
    await expect(b.getIdTokenClaims()).resolves.toMatchObject({ sub: "B" });
    await expect(b.getAccountAccessToken()).resolves.toBe("B-opaque");
    await expect(b.getAccountAccessToken(config.resource)).resolves.toBe(
      "B-resource",
    );
  });

  for (const replacement of ["B", "logout", "A-again"] as const)
    for (const delivered of [true, false])
      it(`does not overwrite ${replacement} with a held A rotation (event delivered: ${delivered})`, async () => {
        const f = fixture();
        f.replace(persisted("A"));
        const a = f.owner();
        await a.getAccountAccessToken();
        const response = deferred<Record<string, unknown>>();
        const request = vi.fn(async (url: RequestInfo | URL) => {
          if (String(url).includes(".well-known"))
            return { token_endpoint: "https://oidc.fixture.invalid/token" };
          return response.promise;
        });
        a.adapter.requester = request as typeof a.adapter.requester;
        const rotating = a.getAccountAccessToken(config.resource, true);
        const rejected = expect(rotating).rejects.toThrow(
          "ACCOUNT_REAUTH_REQUIRED",
        );
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
        f.replace(persisted("B"));
        if (replacement === "logout") f.replace(null);
        if (replacement === "A-again") f.replace(persisted("A", "new-A-grant"));
        const replacementStorage = f.snapshot();
        let drained = false;
        const retirement = delivered
          ? a.retireAccountOwner().then(() => {
              drained = true;
            })
          : undefined;
        await Promise.resolve();
        expect(drained).toBe(false);
        response.resolve({
          access_token: "late-A",
          refresh_token: "late-A-refresh",
          expires_in: 300,
          scope: "connect",
        });
        await rejected;
        await retirement;
        expect(f.snapshot()).toEqual(replacementStorage);
        // A forced refresh/clear on the retired owner cannot delete B either.
        await expect(
          a.getAccountAccessToken(config.resource, true),
        ).rejects.toThrow("ACCOUNT_REAUTH_REQUIRED");
        expect(f.snapshot()).toEqual(replacementStorage);
        const next = f.owner();
        if (replacement === "logout")
          await expect(next.isAuthenticated()).resolves.toBe(false);
        else
          await expect(next.getAccountAccessToken()).resolves.toBe(
            replacement === "B" ? "B-opaque" : "new-A-grant-opaque",
          );
      });

  it("allows the same owner to persist its own successful rotation", async () => {
    const f = fixture();
    f.replace(persisted("A"));
    const a = f.owner();
    a.adapter.requester = (async (url: RequestInfo | URL) =>
      String(url).includes(".well-known")
        ? { token_endpoint: "https://oidc.fixture.invalid/token" }
        : {
            access_token: "rotated-A",
            refresh_token: "rotated-refresh-A",
            expires_in: 300,
            scope: "connect",
          }) as typeof a.adapter.requester;
    await expect(a.getAccountAccessToken(config.resource, true)).resolves.toBe(
      "rotated-A",
    );
    await expect(a.getAccountAccessToken(config.resource)).resolves.toBe(
      "rotated-A",
    );
    expect(f.snapshot()[prefix + "refreshToken"]).toBe("rotated-refresh-A");
  });
});
