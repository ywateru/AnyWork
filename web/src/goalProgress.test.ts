import { describe, expect, it } from "vitest";
import { goalProgressText } from "./goalProgress";

describe("native goal progress", () => {
  it("uses the saved time plus active seconds since the native update", () => {
    expect(
      goalProgressText(
        {
          status: "active",
          timeUsedSeconds: 6 * 3600 + 21 * 60,
          updatedAt: 100,
        },
        106999,
      ),
    ).toBe("6h 21m 6s");
  });
  it("freezes paused goals at the saved duration", () => {
    expect(
      goalProgressText(
        { status: "paused", timeUsedSeconds: 60, updatedAt: 1 },
        999999,
      ),
    ).toBe("1m");
  });
  it("uses compact token budget for active or budget limited goals", () => {
    for (const status of ["active", "budgetLimited"])
      expect(
        goalProgressText({ status, tokensUsed: 1234, tokenBudget: 100000 }, 0),
      ).toBe("1.2K/100K");
  });
  it("returns to duration for other states even when a token budget exists", () => {
    expect(
      goalProgressText(
        {
          status: "paused",
          tokensUsed: 1234,
          tokenBudget: 10000,
          timeUsedSeconds: 86400 + 3600,
        },
        0,
      ),
    ).toBe("1d 1h");
  });
  it("clamps negative and subsecond durations and omits unknown telemetry", () => {
    expect(
      goalProgressText(
        { status: "active", timeUsedSeconds: 0, updatedAt: 10 },
        0,
      ),
    ).toBe("0s");
    expect(
      goalProgressText({ status: "paused", timeUsedSeconds: 0.9 }, 0),
    ).toBe("0s");
    expect(goalProgressText({ status: "active" }, 0)).toBeNull();
    expect(
      goalProgressText({ status: "active", timeUsedSeconds: NaN }, 0),
    ).toBeNull();
  });
});
