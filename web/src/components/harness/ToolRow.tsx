// Adapted from deepseek-ai/deepseek-harness (MIT), fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159.
// ui-tool/ToolRow's summary/state/body seats use AnyWork's authorized result renderer.
import { memo, type ReactNode } from "react";
import { DisclosureRow } from "./DisclosureRow";
import { TextShimmer } from "./TextShimmer";
import css from "./ToolRow.module.css";

export type ToolRowState = "preparing" | "running" | "ok" | "error" | "stopped";
export const ToolRow = memo(function ToolRow({
  id,
  icon,
  title,
  summary,
  state,
  open,
  onOpenChange,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  summary: string;
  state: ToolRowState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const running = state === "running" || state === "preparing";
  const status = {
    preparing: "准备中",
    running: "运行中",
    ok: "已完成",
    error: "失败",
    stopped: "已中断",
  }[state];
  // Native details retains keyboard disclosure semantics and lazy history loading.
  // Only presentation is supplied to TextShimmer; never duplicate controls/ids.
  const collapsedContent = (
    <>
      {summary !== "" && (
        <>
          <span className={css.sep} data-shimmer-decoration aria-hidden />
          <span
            className={`${css.summary} ${state === "error" ? css.errorSummary : state === "stopped" ? css.stoppedSummary : ""}`}
            title={summary}
          >
            <TextShimmer>{summary}</TextShimmer>
          </span>
        </>
      )}
      {state !== "ok" && <span className={css.summarySuffix}> · {status}</span>}
    </>
  );
  return (
    <details
      className={`tool-card harness-tool ${css.root}`}
      data-message-id={id}
      data-state={state}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary
        aria-label={`${title}${summary ? ` · ${summary}` : ""} · ${status}`}
      >
        <DisclosureRow
          icon={icon}
          title={title}
          running={running}
          open={open}
          expandable={false}
          previewChevron
          keepContentWhenOpen
          onToggle={() => {}}
          rowClassName={css.row}
          leadingClassName={css.leading}
          titleClassName={css.title}
          collapsedContent={collapsedContent}
        />
      </summary>
      {open && <div className={css.bodyWrap}>{children}</div>}
    </details>
  );
});
