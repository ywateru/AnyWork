// Adapted from upstream ui-chat/ReasoningRow.tsx (MIT); source revision in provenance.
import { memo, useMemo, useState, type ReactNode } from "react";
import { Brain } from "lucide-react";
import { DisclosureRow } from "./DisclosureRow";
import { TextShimmer } from "./TextShimmer";
import css from "./ReasoningRow.module.css";
function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

function latestCompletedParagraphFirstLine(text: string): string {
  let summary = "";
  let paragraphStart = 0;
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
  while (true) {
    const nextParagraph = separator.exec(text);
    const paragraphEnd =
      nextParagraph === null
        ? text.length
        : nextParagraph.index + nextParagraph[0].indexOf("\n");
    const newline = text.indexOf("\n", paragraphStart);
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim();
      if (candidate !== "") summary = candidate;
    }
    if (nextParagraph === null) return summary;
    paragraphStart = nextParagraph.index + nextParagraph[0].length;
  }
}

export const ReasoningRow = memo(function ReasoningRow({
  text,
  running,
  children,
}: {
  text: string;
  running: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const summaryText = running
    ? latestCompletedParagraphFirstLine(text)
    : firstLine(text);
  const summary = useMemo(
    () => summaryText.replaceAll("**", ""),
    [summaryText],
  );
  if (!text.trim()) return null;
  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? "running" : "ok"}
      data-expanded={expanded || undefined}
      data-preview={(!expanded && summary !== "") || undefined}
    >
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        icon={<Brain size={14} />}
        title="思考"
        running={running}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => setExpanded((value) => !value)}
        collapsedContent={
          <>
            <span
              className={css.separator}
              data-shimmer-decoration
              aria-hidden
            />
            <span className={css.summary} data-streaming={running || undefined}>
              <span className={css.summaryText}>
                <TextShimmer>{summary}</TextShimmer>
              </span>
            </span>
          </>
        }
      >
        {expanded && <div className={css.thinkBody}>{children}</div>}
      </DisclosureRow>
    </div>
  );
});
