export type ReviewSource =
  "branch" | "last-turn" | "uncommitted" | "unstaged" | "staged" | "commit";
export type ReviewRequest = {
  diffFilter?: "branch" | "last-turn";
  path?: string;
};
export interface ReviewData {
  type: "success" | "expected";
  source: ReviewSource;
  diff: string | null;
  root?: string;
  branches: string[];
  base_branch?: string;
  current_branch?: string | null;
  turn_id?: string | null;
  commit?: string;
  reason?: string;
  untracked_files_omitted?: number;
}
export interface ReviewCommit {
  sha: string;
  committed_at: string;
  subject: string;
  message: string;
}
export interface ReviewCommitsData {
  type: "success" | "expected";
  commits: ReviewCommit[];
  reason?: string;
}
export interface DiffLine {
  kind: "context" | "add" | "remove" | "marker";
  text: string;
  oldLine?: number;
  newLine?: number;
}
export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}
export interface DiffFile {
  path: string;
  /** Exact source slice, including line endings and missing-newline markers. */
  patch: string;
  previousPath?: string;
  kind: "modified" | "added" | "deleted" | "renamed";
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  metadata: string[];
}

/** Git C-quotes paths using escaped UTF-8 bytes, not JavaScript Unicode escapes. */
export function gitPath(value: string) {
  if (!value.startsWith('"')) return value.split("\t")[0];
  const bytes: number[] = [];
  for (let i = 1; i < value.length && value[i] !== '"'; i++) {
    if (value[i] !== "\\") {
      const cp = String.fromCodePoint(value.codePointAt(i)!);
      bytes.push(...new TextEncoder().encode(cp));
      i += cp.length - 1;
      continue;
    }
    const escape = value[++i];
    if (/[0-7]/.test(escape ?? "")) {
      let octal = escape;
      for (let n = 0; n < 2 && /[0-7]/.test(value[i + 1] ?? ""); n++)
        octal += value[++i];
      bytes.push(parseInt(octal, 8));
    } else {
      const mapped: Record<string, string> = {
        a: "\x07",
        b: "\b",
        t: "\t",
        n: "\n",
        v: "\v",
        f: "\f",
        r: "\r",
        '"': '"',
        "\\": "\\",
      };
      bytes.push(...new TextEncoder().encode(mapped[escape] ?? escape ?? ""));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
function headerPath(value: string) {
  const path = gitPath(value.replace(/\r$/, ""));
  return path === "/dev/null" ? null : path.replace(/^[ab]\//, "");
}

export function parseReviewDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  let oldLine = 0,
    newLine = 0;
  let oldRemaining = 0,
    newRemaining = 0,
    hasHeaders = false;
  const lines = text.split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const starts: number[] = [];
  const create = (path: string, lineIndex: number) => {
    file = {
      path,
      patch: "",
      kind: "modified",
      binary: false,
      additions: 0,
      deletions: 0,
      hunks: [],
      metadata: [],
    };
    files.push(file);
    starts.push(offsets[lineIndex]);
    hunk = undefined;
    hasHeaders = false;
    return file;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      // ---/+++ or rename headers below provide the authoritative quoted paths.
      const raw = line.slice(11);
      const fallback = raw.startsWith('"')
        ? gitPath(raw)
        : raw.slice(0, raw.lastIndexOf(" b/"));
      create(fallback.replace(/^a\//, "") || raw, i);
      continue;
    }
    if (
      (!hunk || (oldRemaining === 0 && newRemaining === 0)) &&
      line.startsWith("--- ") &&
      lines[i + 1]?.startsWith("+++ ")
    ) {
      const headerIndex = i;
      const oldPath = headerPath(line.slice(4)),
        nextPath = headerPath(lines[++i].slice(4));
      if (!file || hasHeaders)
        create(nextPath ?? oldPath ?? "变更", headerIndex);
      hasHeaders = true;
      hunk = undefined;
      file!.path = nextPath ?? oldPath ?? file!.path;
      if (!oldPath) file!.kind = "added";
      else if (!nextPath) file!.kind = "deleted";
      else if (oldPath !== nextPath) {
        file!.previousPath = oldPath;
        file!.kind = "renamed";
      }
      continue;
    }
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match) {
      if (!file) create("变更", i);
      hunk = { header: line, lines: [] };
      file!.hunks.push(hunk);
      oldLine = Number(match[1]);
      newLine = Number(match[3]);
      oldRemaining = Number(match[2] ?? 1);
      newRemaining = Number(match[4] ?? 1);
      continue;
    }
    if (!file) continue;
    if (hunk) {
      if (line.startsWith("+")) {
        hunk.lines.push({
          kind: "add",
          text: line.slice(1),
          newLine: newLine++,
        });
        file.additions++;
        newRemaining--;
      } else if (line.startsWith("-")) {
        hunk.lines.push({
          kind: "remove",
          text: line.slice(1),
          oldLine: oldLine++,
        });
        file.deletions++;
        oldRemaining--;
      } else if (line.startsWith(" ")) {
        hunk.lines.push({
          kind: "context",
          text: line.slice(1),
          oldLine: oldLine++,
          newLine: newLine++,
        });
        oldRemaining--;
        newRemaining--;
      } else if (line.startsWith("\\"))
        hunk.lines.push({ kind: "marker", text: line });
      continue;
    }
    if (!line) continue;
    file.metadata.push(line);
    if (line.startsWith("new file mode ")) file.kind = "added";
    if (line.startsWith("deleted file mode ")) file.kind = "deleted";
    if (line.startsWith("rename from ")) {
      file.previousPath = gitPath(line.slice(12));
      file.kind = "renamed";
    }
    if (line.startsWith("rename to ")) file.path = gitPath(line.slice(10));
    if (line.startsWith("Binary files ") || line === "GIT binary patch")
      file.binary = true;
  }
  files.forEach((entry, index) => {
    entry.patch = text.slice(starts[index], starts[index + 1] ?? text.length);
  });
  return files;
}

export function splitHunkLines(lines: DiffLine[]) {
  const rows: { left?: DiffLine; right?: DiffLine }[] = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].kind === "context") {
      rows.push({ left: lines[i], right: lines[i++] });
      continue;
    }
    if (lines[i].kind === "marker") {
      rows.push({ left: lines[i++] });
      continue;
    }
    const removed: DiffLine[] = [],
      added: DiffLine[] = [];
    while (lines[i]?.kind === "remove") removed.push(lines[i++]);
    while (lines[i]?.kind === "add") added.push(lines[i++]);
    for (let j = 0; j < Math.max(removed.length, added.length); j++)
      rows.push({ left: removed[j], right: added[j] });
  }
  return rows;
}

export function reviewFilePath(path: string, root?: string) {
  return root && path.startsWith(root.replace(/\/$/, "") + "/")
    ? path.slice(root.replace(/\/$/, "").length + 1)
    : path.replace(/^\.\//, "");
}
