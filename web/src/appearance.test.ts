import { describe, expect, it } from "vitest";
import { defaultAppearance, normalizeAppearance } from "./appearance";
describe("appearance import", () => {
  it("rejects invalid colors, fonts and modes and bounds numeric settings", () => {
    expect(
      normalizeAppearance({
        mode: "evil",
        accent: "url(secret)",
        background: "#fff",
        font: "unknown",
        fontSize: 999,
        codeFontSize: -10,
        lineHeight: NaN,
      }),
    ).toEqual({ ...defaultAppearance, fontSize: 22, codeFontSize: 11 });
  });
  it("preserves valid custom themes and recovers from non-object input", () => {
    const custom = {
      ...defaultAppearance,
      mode: "dark" as const,
      preset: "rose" as const,
      background: "#123456",
      foreground: "#abcdef",
      accent: "#00ABCD",
      font: "mono" as const,
    };
    expect(normalizeAppearance(custom)).toEqual(custom);
    expect(normalizeAppearance(null)).toEqual(defaultAppearance);
  });
});
