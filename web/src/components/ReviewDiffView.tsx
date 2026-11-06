import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  getFiletypeFromFileName,
  getSharedHighlighter,
  processFile,
  registerCustomTheme,
  type FileDiffMetadata,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { DiffFile } from "../reviewDiff";
import themes from "../reviewCodeThemes.json";
import { reviewDiffCSS } from "../reviewDiffStyles";

const theme = { light: "anywork-codex-light", dark: "anywork-codex-dark" };
registerCustomTheme(theme.light, async () => ({
  ...themes.light,
  name: theme.light,
  type: "light",
}));
registerCustomTheme(theme.dark, async () => ({
  ...themes.dark,
  name: theme.dark,
  type: "dark",
}));

function appearance(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
function subscribeAppearance(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

export default function ReviewDiffView({
  file,
  split,
  wrap,
}: {
  file: DiffFile;
  split: boolean;
  wrap: boolean;
}) {
  const themeType = useSyncExternalStore(subscribeAppearance, appearance);
  const parsed = useMemo(() => {
    try {
      const metadata = processFile(file.patch, { throwOnError: true });
      if (!metadata?.hunks.length) return null;
      // Keep our canonical Git C-quoted path decoding for file type detection.
      return { ...metadata, name: file.path, prevName: file.previousPath };
    } catch {
      return null;
    }
  }, [file.patch, file.path, file.previousPath]);
  const [highlight, setHighlight] = useState<{
    file: FileDiffMetadata;
    status: "ready" | "plain" | "failed";
  } | null>(null);
  useEffect(() => {
    if (!parsed) return;
    let active = true;
    // Resolve the locally bundled runtime first, then the optional grammar.
    // A grammar unavailable offline must not leave a permanent loading skeleton.
    getSharedHighlighter({ themes: [theme.light, theme.dark], langs: [] }).then(
      async (highlighter) => {
        let status: "ready" | "plain" = "ready";
        try {
          await highlighter.loadLanguages([getFiletypeFromFileName(file.path)]);
        } catch {
          status = "plain";
        }
        if (active) setHighlight({ file: parsed, status });
      },
      () => {
        if (active) setHighlight({ file: parsed, status: "failed" });
      },
    );
    return () => {
      active = false;
    };
  }, [parsed, file.path]);
  const rendered = useMemo(
    () =>
      highlight?.status === "plain" && parsed
        ? { ...parsed, lang: "text" as const }
        : parsed,
    [parsed, highlight?.status],
  );
  const options = useMemo(
    () => ({
      theme,
      themeType,
      diffStyle: split ? ("split" as const) : ("unified" as const),
      overflow: wrap ? ("wrap" as const) : ("scroll" as const),
      disableFileHeader: true,
      diffIndicators: "bars" as const,
      hunkSeparators: "simple" as const,
      lineDiffType:
        file.additions + file.deletions > 2000
          ? ("none" as const)
          : ("word-alt" as const),
      expansionLineCount: 20,
      unsafeCSS: reviewDiffCSS,
    }),
    [split, wrap, themeType, file.additions, file.deletions],
  );
  if (!parsed || (highlight?.file === parsed && highlight.status === "failed"))
    return (
      <div className="review-diff-fallback">
        <p role="status">无法解析这段差异，显示原始补丁。</p>
        <pre>{file.patch}</pre>
      </div>
    );
  if (highlight?.file !== parsed)
    return (
      <p className="review-file-notice" role="status">
        正在加载差异…
      </p>
    );
  return (
    <>
      {highlight.status === "plain" && (
        <p className="review-file-notice" role="status">
          语法着色暂不可用，已显示差异内容。
        </p>
      )}
      <FileDiff fileDiff={rendered!} options={options} />
    </>
  );
}
