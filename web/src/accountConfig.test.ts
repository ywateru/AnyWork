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
      nativeAppId: "x7lzj58abb1sdp16lkd34",
      resource: "https://anywork-cybergrid-selfhost.vercel.app/api",
      gridUrl: "https://anywork-cybergrid-selfhost.vercel.app",
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
      VITE_LOGTO_RESOURCE: "https://grid.example/api",
      VITE_CYBERGRID_URL: "https://grid.example",
      VITE_CYBERGRID_NATIVE_APP_ID: "selfhosted-native",
    });
    expect(config).toEqual({
      endpoint: "https://identity.example",
      issuer: "https://identity.example/oidc",
      appId: "selfhosted-spa",
      resource: "https://grid.example/api",
      gridUrl: "https://grid.example",
      nativeAppId: "selfhosted-native",
    });
  });
  it("validates the public portal without accepting untrusted credentials or redirects", () => {
    expect(accountPortalUrl()).toBe("https://anywork-tau.vercel.app/app/");
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
