import { describe, it, expect } from "vitest";
import { localFileTarget } from "./fileLinks";
describe("local document references", () => {
  it("resolves relative and absolute markdown links and line references", () => {
    expect(localFileTarget("./docs/guide.md", "/project")).toEqual({
      path: "/project/docs/guide.md",
    });
    expect(localFileTarget("/project/README.md:12:3", "/project")).toEqual({
      path: "/project/README.md",
      line: 12,
    });
    expect(
      localFileTarget(
        "../README.md#details",
        "/project",
        "/project/docs/guide.md",
      ),
    ).toEqual({ path: "/project/README.md", anchor: "details" });
    expect(
      localFileTarget("file:///project/a%20b.md#L7-L9", "/project"),
    ).toEqual({ path: "/project/a b.md", line: 7 });
  });
  it("leaves web, application, fragment and unsafe links out of the file reader", () => {
    for (const url of [
      "https://example.com/a.md",
      "mailto:a@example.com",
      "codex://thread/a",
      "//example.com/a",
      "file://server/a.md",
      "#details",
      "javascript:alert(1)",
      "%00/a.md",
      "%ZZ",
    ])
      expect(localFileTarget(url, "/project")).toBeNull();
  });
});
