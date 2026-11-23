import { describe, expect, it, vi } from "vitest";
import { AccountLogtoClient } from "./accountAuth";
import {
  accountPortalUrl,
  defaultAccountValues,
  resolveAccountConfig,
} from "./accountConfig";

describe("account deployment selection", () => {
  it("uses the complete self-hosted defaults only without any override", () => {
    const config = resolveAccountConfig({ MODE: "production" });
    expect(config).toEqual({
      endpoint: "https://auth.x.aixgg.com",
      issuer: "https://auth.x.aixgg.com/oidc",
      appId: "5ere2kbu9mugfu3xd8e90",
      resource: "https://cyberbus.x.aixgg.com/api",
      productId: "anywork",
      bootstrapPeers: ["wss://cyberbus.x.aixgg.com/"],
      easyTierUrl: "/easytier-browser.js",
    });
    expect(() =>
      resolveAccountConfig({ VITE_LOGTO_ENDPOINT: "https://identity.example" }),
    ).toThrow("INVALID_CONFIGURATION");
    expect(() => resolveAccountConfig({ VITE_LOGTO_ENDPOINT: "" })).toThrow(
      "INVALID_CONFIGURATION",
    );
  });
  it("accepts another complete deployment without mixing default values", () => {
    const config = resolveAccountConfig({
      VITE_LOGTO_ENDPOINT: "https://identity.example",
      VITE_LOGTO_APP_ID: "selfhosted-spa",
      VITE_LOGTO_RESOURCE: "https://bus.example/api",
      VITE_CYBERBUS_PRODUCT_ID: "anywork",
      VITE_CYBERBUS_BOOTSTRAP_PEERS:
        "wss://relay.example/,ws://127.0.0.1:8787/",
      VITE_CYBERBUS_EASYTIER_URL: "/runtime/easytier.js",
    });
    expect(config).toEqual({
      endpoint: "https://identity.example",
      issuer: "https://identity.example/oidc",
      appId: "selfhosted-spa",
      resource: "https://bus.example/api",
      productId: "anywork",
      bootstrapPeers: ["wss://relay.example/", "ws://127.0.0.1:8787/"],
      easyTierUrl: "/runtime/easytier.js",
    });
  });
  it("rejects plain non-loopback relays and cross-origin runtime scripts", () => {
    const base = {
      VITE_LOGTO_ENDPOINT: "https://identity.example",
      VITE_LOGTO_APP_ID: "selfhosted-spa",
      VITE_LOGTO_RESOURCE: "https://bus.example/api",
      VITE_CYBERBUS_PRODUCT_ID: "anywork",
      VITE_CYBERBUS_EASYTIER_URL: "/easytier-browser.js",
    };
    for (const peers of [
      "ws://relay.example/",
      "https://relay.example/",
      `wss://user:${"pass" + "word"}@relay.example/`,
      "wss://relay.example/?token=value",
    ])
      expect(() =>
        resolveAccountConfig({
          ...base,
          VITE_CYBERBUS_BOOTSTRAP_PEERS: peers,
        }),
      ).toThrow("INVALID_CONFIGURATION");
    for (const easyTierUrl of [
      "https://cdn.example/easytier.js",
      "/easytier-browser.js?",
      "/../easytier-browser.js",
      "/easytier-browser.mjs",
    ])
      expect(() =>
        resolveAccountConfig({
          ...base,
          VITE_CYBERBUS_BOOTSTRAP_PEERS: "wss://relay.example/",
          VITE_CYBERBUS_EASYTIER_URL: easyTierUrl,
        }),
      ).toThrow("INVALID_CONFIGURATION");
  });
  it("validates the public portal without accepting untrusted credentials or redirects", () => {
    expect(accountPortalUrl()).toBe("https://anywork.aixgg.com/app/");
    expect(accountPortalUrl("https://work.example/app/")).toBe(
      "https://work.example/app/",
    );
    for (const value of [
      "",
      "http://work.example/app/",
      "https://user:password@work.example/app/",
      "https://work.example/app/?next=https://other.example",
      "https://work.example/app/#token",
      "https://work.example/",
    ])
      expect(() => accountPortalUrl(value)).toThrow("INVALID_CONFIGURATION");
  });
  it("isolates official SDK persisted grants for the same app ID at another issuer", async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    };
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    try {
      const one = resolveAccountConfig(defaultAccountValues);
      const two = {
        ...one,
        endpoint: "https://ueg42e.logto.app",
        issuer: "https://ueg42e.logto.app/oidc",
      };
      const make = (account: typeof one) =>
        new AccountLogtoClient(
          { endpoint: account.endpoint, appId: account.appId },
          account,
        );
      const first = make(one),
        second = make(two),
        otherApp = make({ ...one, appId: "another-spa" });
      await first.adapter.storage.setItem(
        "refreshToken",
        "synthetic-refresh-one",
      );
      await first.adapter.storage.setItem(
        "signInSession",
        "synthetic-login-one",
      );
      expect(await second.adapter.storage.getItem("refreshToken")).toBeNull();
      expect(await otherApp.adapter.storage.getItem("refreshToken")).toBeNull();
      expect(await second.adapter.storage.getItem("signInSession")).toBeNull();
      await second.adapter.storage.setItem(
        "refreshToken",
        "synthetic-refresh-two",
      );
      expect(await first.adapter.storage.getItem("refreshToken")).toBe(
        "synthetic-refresh-one",
      );
      await second.adapter.storage.removeItem("refreshToken");
      await second.adapter.storage.removeItem("signInSession");
      expect(await first.adapter.storage.getItem("signInSession")).toBe(
        "synthetic-login-one",
      );
      expect(await first.adapter.storage.getItem("refreshToken")).toBe(
        "synthetic-refresh-one",
      );
      expect(await make(one).adapter.storage.getItem("refreshToken")).toBe(
        "synthetic-refresh-one",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
