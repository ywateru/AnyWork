import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bundled WorkBuddy identification", () => {
  it("retains the original official SVG with only local static references", () => {
    const source = readFileSync(
      new URL("../public/agents/workbuddy.svg", import.meta.url),
      "utf8",
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "7aabffe18a9714f0452fc4ceb8c22731f26a1570bb2e7f6cf200e8a3cdefc16e",
    );
    expect(source).toContain('viewBox="0 0 280 280"');
    expect(source).not.toMatch(
      /<(?:script|foreignObject|image|iframe|style)\b|\son\w+\s*=|(?:href|src)\s*=|<!DOCTYPE|<!ENTITY|@import/i,
    );
    for (const match of source.matchAll(/url\(([^)]*)\)/g))
      expect(match[1]).toMatch(/^#[A-Za-z_][\w.-]*$/);
  });
});
