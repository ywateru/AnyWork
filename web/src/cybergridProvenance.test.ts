import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("./vendor/cybergrid/", import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, root)));
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const source = JSON.parse(read("SOURCE.json").toString());
describe("vendored CyberGrid provenance", () => {
  it("pins the complete official module set and every retained source digest", () => {
    expect(source.repository).toBe("https://github.com/ywateru/CyberGrid");
    expect(source.commit).toBe("f2a3961536e5c69b13c7dbc661953d9243becbae");
    expect(source.componentVersion).toBe("0.2.0");
    expect(
      Object.keys(source.files)
        .filter((path) => path.endsWith(".ts"))
        .sort(),
    ).toEqual(["bridge.ts", "directory.ts", "endpoints.ts", "index.ts"]);
    for (const [path, entry] of Object.entries(source.files) as [
      string,
      { upstreamPath: string; upstreamSha256: string; vendoredSha256: string },
    ][]) {
      expect(entry.upstreamPath.startsWith("sdk-js/")).toBe(true);
      expect(entry.upstreamSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(hash(read(path)), path).toBe(entry.vendoredSha256);
      if (!path.endsWith(".ts"))
        expect(entry.vendoredSha256, path).toBe(entry.upstreamSha256);
    }
  });
  it("retains original compiler notice bytes matching their upstream SOURCE manifest", () => {
    const notices = JSON.parse(
      read("notices/typescript-5.9.3/SOURCE.json").toString(),
    );
    for (const text of notices.texts)
      expect(
        hash(read("notices/typescript-5.9.3/" + text.path)),
        text.path,
      ).toBe(text.sha256);
  });
});
