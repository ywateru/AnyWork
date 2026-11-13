import LogtoClient from "@logto/browser";
import { describe, expect, it, vi } from "vitest";
import { AccountLogtoClient, accountScopes } from "./accountAuth";
import { resolveAccountConfig } from "./accountConfig";

/** Real installed Logto SDK, synthetic storage/HTTP/navigation only. */
function adapter(client: LogtoClient, initial: Record<string, string> = {}) {
  const storage = new Map(Object.entries(initial));
  client.adapter.storage = {
    getItem: async (key) => storage.get(key) ?? null,
    setItem: async (key, value) => {
      storage.set(key, value);
    },
    removeItem: async (key) => {
      storage.delete(key);
    },
  };
  client.adapter.generateState = () => "synthetic-state";
  client.adapter.generateCodeVerifier = () => "synthetic-verifier";
  client.adapter.generateCodeChallenge = () => "synthetic-challenge";
  const navigate = vi.fn();
  client.adapter.navigate = navigate;
  const requests: { url: string; options: unknown }[] = [];
  client.adapter.requester = async <T>(
    input: RequestInfo | URL,
    options?: RequestInit,
  ): Promise<T> => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({ url, options });
    if (url.includes(".well-known"))
      return {
        authorization_endpoint: "https://oidc.fixture.invalid/auth",
        userinfo_endpoint: "https://oidc.fixture.invalid/me",
      } as T;
    if (url.endsWith("/me"))
      return { sub: "synthetic-subject", username: "SDK username" } as T;
    throw new Error("Unexpected SDK request");
  };
  return { navigate, requests };
}
describe("installed official Logto contract", () => {
  it("already includes profile by default; our requested email fallback adds email", async () => {
    for (const scopes of [undefined, accountScopes]) {
      const client = new LogtoClient({
        endpoint: "https://oidc.fixture.invalid",
        appId: "fixture",
        scopes,
      });
      const fake = adapter(client);
      await client.signIn({
        redirectUri: "https://web.fixture.invalid/app/callback",
      });
      const url = new URL(fake.navigate.mock.calls[0][0]);
      const requested = url.searchParams.get("scope")!.split(" ");
      expect(requested).toEqual(
        expect.arrayContaining(["openid", "offline_access", "profile"]),
      );
      expect(requested.includes("email")).toBe(scopes !== undefined);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    }
  });
  it("uses real fetchUserInfo and its memoized token field through the account owner", async () => {
    const config = resolveAccountConfig({ MODE: "production" });
    const client = new AccountLogtoClient(
      { endpoint: config.endpoint, appId: config.appId, scopes: accountScopes },
      config,
    );
    const claims = {
      sub: "synthetic-subject",
      iss: config.issuer,
      aud: config.appId,
      exp: Date.now() / 1000 + 300,
      iat: Date.now() / 1000,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const header = Buffer.from(JSON.stringify({ alg: "ES384" })).toString(
      "base64url",
    );
    const opaque = ["synthetic", "userinfo", "token"].join("-");
    const fake = adapter(client, {
      idToken: [header, payload, "synthetic-stored-grant"].join("."),
      accessToken: JSON.stringify({
        "@": {
          token: opaque,
          scope: "openid profile",
          expiresAt: Date.now() / 1000 + 300,
        },
      }),
    });
    // Synthetic persisted grant: verifies SDK call shape, not JWT authentication.
    const result = await client.getAccountUserInfo(
      claims.sub,
      new AbortController().signal,
    );
    expect(result.username).toBe("SDK username");
    expect(fake.requests.at(-1)).toEqual({
      url: "https://oidc.fixture.invalid/me",
      options: {
        headers: { Authorization: "Bearer " + opaque },
      },
    });
    expect(fake.navigate).not.toHaveBeenCalled();
  });
});
