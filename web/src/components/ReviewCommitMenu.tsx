import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Check, ChevronLeft } from "lucide-react";
import type { Api } from "../api";
import type { ReviewCommit, ReviewCommitsData } from "../reviewDiff";
import ReviewTooltip from "./ReviewTooltip";

function committedTime(value: string) {
  const elapsed = Math.max(0, (Date.now() - Date.parse(value)) / 1000);
  if (!Number.isFinite(elapsed)) return "";
  const [amount, unit] =
    elapsed < 60
      ? [elapsed, "second"]
      : elapsed < 3600
        ? [elapsed / 60, "minute"]
        : elapsed < 86400
          ? [elapsed / 3600, "hour"]
          : elapsed < 2592000
            ? [elapsed / 86400, "day"]
            : elapsed < 31536000
              ? [elapsed / 2592000, "month"]
              : [elapsed / 31536000, "year"];
  return new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" }).format(
    -Math.floor(amount as number),
    unit as Intl.RelativeTimeFormatUnit,
  );
}
export default function ReviewCommitMenu({
  api,
  id,
  base,
  selected,
  revision,
  placement,
  autoFocus,
  anchor,
  onChoose,
  onBack,
  onDismiss,
}: {
  api: Api;
  id: string;
  base: string;
  selected: string | undefined;
  revision: number;
  placement: "left" | "right" | "overlay";
  autoFocus: boolean;
  anchor: RefObject<HTMLButtonElement | null>;
  onChoose: (commit: ReviewCommit) => void;
  onBack: () => void;
  onDismiss: () => void;
}) {
  const [data, setData] = useState<ReviewCommitsData | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const menu = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    if (placement === "overlay") {
      setTop(0);
      return;
    }
    const content = menu.current,
      trigger = anchor.current;
    const parent = content?.offsetParent;
    if (!content || !trigger || !parent) return;
    const position = () => {
      const parentTop = parent.getBoundingClientRect().top;
      const padding = parseFloat(getComputedStyle(content).paddingTop) || 0;
      const desired = trigger.getBoundingClientRect().top - padding;
      const clamped = Math.max(
        6,
        Math.min(desired, window.innerHeight - content.offsetHeight - 6),
      );
      setTop(clamped - parentTop);
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(content);
    observer.observe(trigger);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
    };
  }, [placement, anchor]);
  useEffect(() => {
    // The mobile replacement hides the parent trigger and needs its own focus target.
    if (autoFocus || placement === "overlay") menu.current?.focus();
  }, [autoFocus, placement]);
  useEffect(() => {
    const controller = new AbortController();
    if (menu.current?.contains(document.activeElement)) menu.current.focus();
    setData(null);
    setError("");
    const params = new URLSearchParams();
    if (base) params.set("base_branch", base);
    void api
      .request<ReviewCommitsData>(`/sessions/${id}/review/commits?${params}`, {
        signal: controller.signal,
      })
      .then(
        (result) => {
          if (!controller.signal.aborted) setData(result);
        },
        (e) => {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : String(e));
        },
      );
    return () => controller.abort();
  }, [api, id, base, revision, retry]);
  useEffect(() => {
    // Async results must not take focus back from another menu or the composer.
    if (document.activeElement === menu.current) {
      (
        menu.current?.querySelector<HTMLButtonElement>(
          'button[aria-current="true"]',
        ) ??
        menu.current?.querySelector<HTMLButtonElement>(
          "button[data-commit],button[data-retry]",
        )
      )?.focus();
    }
  }, [data, error, autoFocus, placement]);
  return (
    <div
      ref={menu}
      role="menu"
      tabIndex={-1}
      aria-label="分支提交"
      className={`review-menu review-commit-menu review-commit-${placement}`}
      style={{ top }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "ArrowLeft") {
          event.preventDefault();
          onBack();
          return;
        }
        if (event.key === "Tab") {
          onDismiss();
          return;
        }
        const buttons = Array.from(
          menu.current?.querySelectorAll<HTMLButtonElement>(
            'button[role^="menuitem"]:not(:disabled)',
          ) ?? [],
        );
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "ArrowDown"
            ? (index + 1) % buttons.length
            : event.key === "ArrowUp"
              ? (index - 1 + buttons.length) % buttons.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : -1;
        if (next >= 0) {
          event.preventDefault();
          buttons[next]?.focus();
        }
      }}
    >
      {placement === "overlay" && (
        <button role="menuitem" className="review-commit-back" onClick={onBack}>
          <ChevronLeft size={14} />
          提交
        </button>
      )}
      <div className="review-commit-list">
        {error ? (
          <>
            <p role="alert" className="review-commit-notice">
              无法加载提交
            </p>
            <button
              role="menuitem"
              data-retry
              title={error}
              onClick={() => {
                menu.current?.focus();
                setRetry((n) => n + 1);
              }}
            >
              重试
            </button>
          </>
        ) : !data ? (
          <p role="status" className="review-commit-notice">
            正在加载提交…
          </p>
        ) : !data.commits.length ? (
          <p role="status" className="review-commit-notice">
            {data.reason === "default-branch-unavailable"
              ? "选择基准分支以查看提交"
              : data.reason === "not-a-repository"
                ? "当前目录不是 Git 仓库"
                : "分支上没有提交"}
          </p>
        ) : (
          data.commits.map((commit) => (
            <ReviewTooltip key={commit.sha} text={commit.message} overflowOnly>
              <button
                role="menuitem"
                data-commit={commit.sha}
                aria-current={selected === commit.sha ? "true" : undefined}
                onClick={() => onChoose(commit)}
              >
                {data.commits.some((item) => item.sha === selected) && (
                  <span className="review-menu-check">
                    {selected === commit.sha && <Check size={14} />}
                  </span>
                )}
                <span className="review-commit-details">
                  <span
                    className="review-commit-subject"
                    data-tooltip-overflow-target
                  >
                    {commit.subject || commit.sha.slice(0, 7)}
                  </span>
                  <time dateTime={commit.committed_at}>
                    {committedTime(commit.committed_at)}
                  </time>
                </span>
              </button>
            </ReviewTooltip>
          ))
        )}
      </div>
    </div>
  );
}
