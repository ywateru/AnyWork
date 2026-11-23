import { describe, expect, it } from "vitest";
import { AccountError } from "./accountConfig";
import { presenceFailure, presenceStageLabel } from "./accountPresence";

describe("redacted account presence failures", () => {
  it("retains a bounded CyberBus stage/code/status and the Account API stage", () => {
    expect(
      presenceFailure(
        Object.assign(new Error("private body"), {
          code: "FORBIDDEN",
          stage: "exchange",
          status: 403,
        }),
        "configuration",
      ),
    ).toEqual({ stage: "exchange", code: "FORBIDDEN", status: 403 });
    expect(
      presenceFailure(new AccountError("ACCOUNT_UNAVAILABLE"), "account"),
    ).toEqual({ stage: "account", code: "ACCOUNT_UNAVAILABLE" });
    expect(presenceStageLabel("host-authorization", "zh-CN")).toBe(
      "CyberBus 网络授权",
    );
    expect(presenceStageLabel("directory", "en")).toBe("Device locator");
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
