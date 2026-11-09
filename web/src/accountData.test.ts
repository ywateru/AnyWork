import { describe, it, expect } from "vitest";
import { AccountStore, parseAccountProfile } from "./accountData";
import { parseAccountConfig } from "./accountConfig";

describe("account data boundary", () => {
  it("requires a complete trusted deployment configuration", () => {
    expect(parseAccountConfig({})).toBeNull();
    expect(() =>
      parseAccountConfig({ VITE_LOGTO_ENDPOINT: "https://tenant.logto.app" }),
    ).toThrow("INVALID_CONFIGURATION");
  });
  it("rejects future schema, private/malformed device identity and oversized data", () => {
    expect(() =>
      parseAccountProfile({
        customData: { anywork: { schemaVersion: 2, devices: {} } },
      }),
    ).toThrow("INVALID_ACCOUNT_DATA");
    expect(() =>
      parseAccountProfile({ customData: { other: "a".repeat(33000) } }),
    ).toThrow("INVALID_ACCOUNT_DATA");
    expect(() =>
      parseAccountProfile({
        customData: {
          anywork: {
            schemaVersion: 1,
            devices: {
              one: {
                label: "one",
                platform: "macos",
                publicKey: "private-key",
                keyVersion: 1,
              },
            },
          },
        },
      }),
    ).toThrow("INVALID_ACCOUNT_DATA");
  });
  it("rejects prototype keys and non-canonical public keys", () => {
    const valid = {
      label: "computer",
      platform: "macos",
      publicKey: "A".repeat(43),
      keyVersion: 1,
    };
    const poisoned = JSON.parse(
      '{"customData":{"anywork":{"schemaVersion":1,"devices":{"__proto__":' +
        JSON.stringify(valid) +
        "}}}}",
    );
    expect(() => parseAccountProfile(poisoned)).toThrow("INVALID_ACCOUNT_DATA");
    expect(() =>
      parseAccountProfile({
        customData: {
          anywork: {
            schemaVersion: 1,
            devices: { one: { ...valid, publicKey: "A".repeat(42) + "B" } },
          },
        },
      }),
    ).toThrow("INVALID_ACCOUNT_DATA");
  });
  it("serializes writes, preserves other namespaces, and uses no-resource account token", async () => {
    let customData: Record<string, unknown> = { another: { setting: 3 } };
    let active = 0;
    const fetcher: typeof fetch = async (_url, options) => {
      expect(new Headers(options?.headers).get("Authorization")).toBe(
        "Bearer opaque-account",
      );
      expect(options?.cache).toBe("no-store");
      if (options?.method === "PATCH") {
        expect(active++).toBe(0);
        await Promise.resolve();
        customData = JSON.parse(options.body as string).customData;
        active--;
      }
      return Response.json({ customData });
    };
    const store = new AccountStore(
      "https://tenant.example",
      async () => "opaque-account",
      fetcher,
    );
    await Promise.all([
      store.update((data) => ({ ...data, preferences: { locale: "en" } })),
      store.update((data) => ({
        ...data,
        preferences: { ...data.preferences, appearance: "dark" },
      })),
    ]);
    expect(customData.another).toEqual({ setting: 3 });
    expect((await store.read()).anywork.preferences).toEqual({
      locale: "en",
      appearance: "dark",
    });
  });
  it("reports detectable concurrent replacement instead of claiming transactional writes", async () => {
    let patched = false;
    const store = new AccountStore(
      "https://tenant.example",
      async () => "opaque",
      async (_url, options) => {
        if (options?.method === "PATCH") patched = true;
        return Response.json({
          customData: patched
            ? {
                anywork: {
                  schemaVersion: 1,
                  devices: {},
                  preferences: { locale: "en" },
                },
              }
            : {},
        });
      },
    );
    await expect(
      store.update((data) => ({ ...data, preferences: { locale: "zh-CN" } })),
    ).rejects.toThrow("CONFIGURATION_CONFLICT");
  });
  it("cancellation after token resolution never sends an account request", async () => {
    const controller = new AbortController();
    let called = false;
    const store = new AccountStore(
      "https://tenant.example",
      async () => {
        controller.abort();
        return "opaque";
      },
      async () => {
        called = true;
        return Response.json({ customData: {} });
      },
    );
    await expect(store.read(controller.signal)).rejects.toThrow();
    expect(called).toBe(false);
  });
});
