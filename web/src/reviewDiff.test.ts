import { describe, expect, it } from "vitest";
import {
  gitPath,
  parseReviewDiff,
  reviewFilePath,
  splitHunkLines,
} from "./reviewDiff";

describe("review patches", () => {
  it("retains exact per-file patches with Unicode, CRLF and missing final newlines", () => {
    const first =
      'diff --git "a/\\344\\270\\255.ts" "b/\\344\\270\\255.ts"\r\n--- "a/\\344\\270\\255.ts"\r\n+++ "b/\\344\\270\\255.ts"\r\n@@ -1 +1 @@\r\n-旧🙂\r\n+新值\r\n\\ No newline at end of file\r\n';
    const second =
      "diff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file";
    const files = parseReviewDiff("patch preamble\n" + first + second);
    expect(files.map((file) => file.patch)).toEqual([first, second]);
    expect(files.map((file) => file.path)).toEqual(["中.ts", "b.txt"]);
    expect(files.map((file) => file.patch).join("")).toBe(first + second);
  });
  it("retains adjacent plain file boundaries and a hunk-only fallback verbatim", () => {
    const first = "--- a/a\n+++ b/a\n@@ -1 +1 @@\n--- code\n+++ code\n";
    const second = "--- a/b\n+++ b/b\n@@ -1 +1 @@\n-a\n+b";
    expect(parseReviewDiff(first + second).map((file) => file.patch)).toEqual([
      first,
      second,
    ]);
    const hunk = "@@ -1 +1 @@\n-before\n+after";
    expect(parseReviewDiff(hunk)[0].patch).toBe(hunk);
  });
  it("preserves line numbers, empty lines and a missing-newline marker", () => {
    const [file] = parseReviewDiff(
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -7,3 +9,3 @@ function\n keep\n-old\n+new\n \n\\ No newline at end of file\n",
    );
    expect([file.path, file.additions, file.deletions]).toEqual(["a.ts", 1, 1]);
    expect(file.hunks[0].lines).toEqual([
      { kind: "context", text: "keep", oldLine: 7, newLine: 9 },
      { kind: "remove", text: "old", oldLine: 8 },
      { kind: "add", text: "new", newLine: 10 },
      { kind: "context", text: "", oldLine: 9, newLine: 11 },
      { kind: "marker", text: "\\ No newline at end of file" },
    ]);
  });
  it("splits successive plain unified files without interpreting header-like code as a new file", () => {
    const files = parseReviewDiff(
      "--- a/a\n+++ b/a\n@@ -1 +1 @@\n--- code\n+++ code\n--- a/b\n+++ /dev/null\n@@ -8 +0,0 @@\n-gone\n",
    );
    expect(
      files.map((f) => [f.path, f.kind, f.additions, f.deletions]),
    ).toEqual([
      ["a", "modified", 1, 1],
      ["b", "deleted", 0, 1],
    ]);
    expect(files[0].hunks[0].lines.map((l) => l.text)).toEqual([
      "-- code",
      "++ code",
    ]);
  });
  it("decodes C-quoted octal UTF8 and escaped special characters", () => {
    expect(gitPath('"a/\\344\\270\\255\\346\\226\\207\\t\\\\\\\".ts"')).toBe(
      'a/中文\t\\".ts',
    );
    expect(gitPath("普通 文件.ts\t2026-11-05")).toBe("普通 文件.ts");
    const [file] = parseReviewDiff(
      'diff --git "a/\\344\\270\\255.ts" "b/\\344\\270\\255.ts"\n--- "a/\\344\\270\\255.ts"\n+++ "b/\\344\\270\\255.ts"\n@@ -1 +1 @@\n-a\n+b\n',
    );
    expect(file.path).toBe("中.ts");
  });
  it("keeps renames, binary files, new files and mode-only changes", () => {
    const files = parseReviewDiff(
      "diff --git a/old name b/new name\nsimilarity index 100%\nrename from old name\nrename to new name\ndiff --git a/image.png b/image.png\nnew file mode 100644\nBinary files /dev/null and b/image.png differ\ndiff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\ndiff --git a/new b/new\nnew file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+hello\n",
    );
    expect(files.map((f) => [f.path, f.kind, f.binary])).toEqual([
      ["new name", "renamed", false],
      ["image.png", "added", true],
      ["run.sh", "modified", false],
      ["new", "added", false],
    ]);
    expect(files[0].previousPath).toBe("old name");
    expect(files[2].metadata).toContain("new mode 100755");
    expect(files[3].hunks[0].lines[0].newLine).toBe(1);
  });
  it("pairs replacement runs and keeps asymmetric additions and markers", () => {
    const lines = parseReviewDiff(
      "--- a/a\n+++ b/a\n@@ -1,2 +1,3 @@\n-a\n-b\n+c\n+d\n+e\n\\ No newline at end of file\n",
    )[0].hunks[0].lines;
    expect(
      splitHunkLines(lines).map((r) => [r.left?.text, r.right?.text]),
    ).toEqual([
      ["a", "c"],
      ["b", "d"],
      [undefined, "e"],
      ["\\ No newline at end of file", undefined],
    ]);
  });
  it("maps requested files only inside the repository root", () => {
    expect(reviewFilePath("/work/repo/a.ts", "/work/repo/")).toBe("a.ts");
    expect(reviewFilePath("/work/repo-other/a.ts", "/work/repo")).toBe(
      "/work/repo-other/a.ts",
    );
    expect(reviewFilePath("./a.ts")).toBe("a.ts");
    expect(parseReviewDiff("")).toEqual([]);
  });
});
