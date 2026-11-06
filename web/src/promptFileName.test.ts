import { describe, expect, it } from "vitest";
import { truncatePromptFileName } from "./promptFileName";

describe("prompt file name truncation", () => {
  const fit = (count: number) => (text: string) =>
    Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    ).length <= count;
  it("keeps a recognizable prefix and file extension within the measured width", () => {
    expect(
      truncatePromptFileName("quarterly-financial-report.pdf", fit(15)),
    ).toBe("quarter…ort.pdf");
  });
  it("handles extensionless names and dotfiles without inventing an extension", () => {
    expect(truncatePromptFileName("long directory name", fit(9))).toBe(
      "long dir…",
    );
    expect(truncatePromptFileName(".verylongdotfile", fit(7))).toBe(".veryl…");
  });
  it("does not split an emoji or a combining character sequence", () => {
    const title = "👩🏽‍💻é客户资料最终版本.docx";
    const result = truncatePromptFileName(title, fit(10));
    expect(result).toBe("👩🏽‍💻é客…本.docx");
    expect(result).not.toContain("�");
  });
  it("uses the native narrow-width fallback when even a prefix cannot fit", () => {
    expect(truncatePromptFileName("long-report.pdf", fit(4))).toBe(".pdf");
    expect(truncatePromptFileName("long name", fit(0))).toBe("");
  });
});
