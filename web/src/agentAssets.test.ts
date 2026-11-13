import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AgentIcon from "./components/AgentIcon";

afterEach(() => vi.unstubAllEnvs());

describe("Agent images under the actual Web deployment base", () => {
  for (const base of ["/", "/app/"])
    it(`renders existing bundled images at ${base}`, () => {
      vi.stubEnv("BASE_URL", base);
      for (const agent of [
        "codex",
        "deepseek-harness",
        "workbuddy",
        "claude-code",
        "claude-desktop",
      ]) {
        const html = renderToStaticMarkup(createElement(AgentIcon, { agent }));
        const sources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(
          (match) => match[1],
        );
        expect(sources).toHaveLength(
          ["workbuddy", "claude-code", "claude-desktop"].includes(agent)
            ? 1
            : 2,
        );
        for (const src of sources) {
          expect(src.startsWith(`${base}agents/`)).toBe(true);
          const relative = src.slice(base.length);
          expect(
            readFileSync(new URL(`../public/${relative}`, import.meta.url))
              .length,
          ).toBeGreaterThan(0);
        }
      }
    });
});

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

describe("Claude identification and unknown Agent fallback", () => {
  it("bundles the unmodified static official mark and distinguishes its two entry points", () => {
    const source = readFileSync(
      new URL("../public/agents/claude.svg", import.meta.url),
      "utf8",
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "b150888bc7257af83e3b85d3c2be4294f88986026f8168f6c12fc1fde6697350",
    );
    expect(source).not.toMatch(
      /<(?:script|foreignObject|image|iframe|style)\b|\son\w+\s*=|(?:href|src)\s*=|<!DOCTYPE|<!ENTITY|@import|url\(/i,
    );
    const cli = renderToStaticMarkup(
      createElement(AgentIcon, { agent: "claude-code" }),
    );
    const desktop = renderToStaticMarkup(
      createElement(AgentIcon, { agent: "claude-desktop" }),
    );
    expect(cli).toContain("lucide-terminal");
    expect(desktop).toContain("lucide-monitor");
    for (const agent of ["future-agent", "constructor", "__proto__"]) {
      const html = renderToStaticMarkup(createElement(AgentIcon, { agent }));
      expect(html).toContain("lucide-bot");
      expect(html).not.toContain("<img");
    }
  });
});
