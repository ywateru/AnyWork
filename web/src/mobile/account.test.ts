import { describe, expect, it } from "vitest";
import { directoryDiagnosticCode, friendlyError } from "./account";

describe("native directory diagnostic boundary", () => {
  it("retains fixed coordination stages without accepting arbitrary codes", () => {
    for (const code of [
      "MOBILE_COORDINATION_CONFIG_FETCH_FAILED",
      "MOBILE_COORDINATION_REGISTRATION_FAILED",
      "MOBILE_COORDINATION_DIRECTORY_FETCH_FAILED",
      "MOBILE_INVALID_ENDPOINT_POLICY",
      "MOBILE_NETWORK_ERROR",
    ]) {
      expect(directoryDiagnosticCode(code)).toBe(code);
    }
    for (const value of [
      null,
      undefined,
      "",
      "constructor",
      "__proto__",
      "UNREVIEWED_PRIVATE_VALUE",
      "MOBILE_NETWORK_ERROR\nprivate bearer token",
      "https://private.invalid/?token=synthetic",
      { code: "MOBILE_NETWORK_ERROR", token: "private" },
    ]) {
      expect(directoryDiagnosticCode(value)).toBeNull();
    }
  });
});

describe("saved login public messages", () => {
  it("explains the five fixed recovery boundaries without exposing native errors", () => {
    for (const code of [
      "MOBILE_AUTH_STORAGE_UNAVAILABLE",
      "MOBILE_AUTH_RESTORE_UNAVAILABLE",
      "MOBILE_AUTH_SAVED_GRANT_INVALID",
      "MOBILE_AUTH_REFRESH_UNCERTAIN",
      "MOBILE_AUTH_CLEAR_REQUIRED",
    ]) {
      expect(friendlyError({ code })).not.toBe(code);
      expect(friendlyError({ code })).toMatch(/恢复|登录|退出/);
    }
    expect(friendlyError({ code: "MOBILE_AUTH_CLEAR_REQUIRED" })).toContain(
      "重试退出",
    );
  });
});
