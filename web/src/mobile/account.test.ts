import { describe, expect, it } from "vitest";
import { directoryDiagnosticCode } from "./account";

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
