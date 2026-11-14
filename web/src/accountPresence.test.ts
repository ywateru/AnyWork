import { describe, expect, it } from "vitest";
import { AccountError } from "./accountConfig";
import { presenceFailure, presenceStageLabel } from "./accountPresence";
import { CyberGridError } from "./vendor/cybergrid";

describe("redacted account presence failures", () => {
  it("retains the SDK stage/code/status and the separate Account API stage", () => {
    expect(
      presenceFailure(
        new CyberGridError("FORBIDDEN", 403, { stage: "exchange" }),
        "configuration",
      ),
    ).toEqual({ stage: "exchange", code: "FORBIDDEN", status: 403 });
    expect(
      presenceFailure(new AccountError("ACCOUNT_UNAVAILABLE"), "account"),
    ).toEqual({ stage: "account", code: "ACCOUNT_UNAVAILABLE" });
    expect(presenceStageLabel("host-authorization", "zh-CN")).toBe(
      "在线状态授权",
    );
    expect(presenceStageLabel("directory", "en")).toBe("Device presence query");
  });
  it("never includes arbitrary exception text, codes, stages or status values", () => {
    for (const error of [
      "https://private.invalid/token?grant=private",
      { code: "NETWORK_ERROR", message: "private body" },
      Object.assign(new Error("private token / subject / body"), {
        code: "NETWORK_ERROR\nprivate",
        stage: "https://private.invalid",
        status: "private body",
      }),
      Object.assign(new Error("private body"), {
        code: "constructor",
        stage: "__proto__",
        status: 999,
      }),
    ]) {
      expect(presenceFailure(error, "configuration")).toEqual({
        stage: "configuration",
        code: "UNAVAILABLE",
      });
    }
  });
});
