import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Columns2,
  FileDiff,
  FileText,
  MoreHorizontal,
  RefreshCw,
  X,
} from "lucide-react";
import type { Api } from "../api";
import type { FileTarget } from "../fileLinks";
import {
  parseReviewDiff,
  reviewFilePath,
  type ReviewData,
  type ReviewCommit,
  type ReviewRequest,
  type ReviewSource,
} from "../reviewDiff";
import ReviewCommitMenu from "./ReviewCommitMenu";
import ReviewTooltip from "./ReviewTooltip";
import "./ReviewPanel.css";

const ReviewDiffView = lazy(() => import("./ReviewDiffView"));

const sources: { id: ReviewSource; label: string }[] = [
  { id: "last-turn", label: "最后一轮" },
  { id: "uncommitted", label: "未提交" },
  { id: "unstaged", label: "未暂存" },
  { id: "staged", label: "已暂存" },
  { id: "branch", label: "分支" },
];
function storedSource(): ReviewSource {
  try {
    const value = localStorage.getItem("anywork.review.source");
    return sources.find((s) => s.id === value)?.id ?? "branch";
  } catch {
    return "branch";
  }
}
function menuKey(event: React.KeyboardEvent, close: () => void) {
  const menu = event.currentTarget;
  if ((event.target as HTMLElement).closest('[role="menu"]') !== menu) return;
  const buttons = Array.from(
    menu.querySelectorAll<HTMLButtonElement>(
      'button[role^="menuitem"]:not(:disabled)',
    ),
  ).filter(
    (button) =>
      button.closest('[role="menu"]') === menu && !button.closest("[hidden]"),
  );
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
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
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
  } else if (next >= 0) {
    event.preventDefault();
    buttons[next]?.focus();
  }
}

export default function ReviewPanel({
  api,
  id,
  revision,
  request,
  onOpenFile,
  onClose,
}: {
  api: Api;
  id: string;
  revision: number;
  request?: ReviewRequest | null;
  onOpenFile: (target: FileTarget) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<ReviewSource>(
    () => request?.diffFilter ?? storedSource(),
  );
  const [base, setBase] = useState("");
  const [commit, setCommit] = useState<ReviewCommit | null>(null);
  const [placement, setPlacement] = useState<"left" | "right" | "overlay">(
    "left",
  );
  const commitButton = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const hoverKeyListener = useRef<(() => void) | undefined>(undefined);
  const [commitAutoFocus, setCommitAutoFocus] = useState(false);
  const returnToCommit = useRef(false);
  const preserveSourceFocus = useRef(false);
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [menu, setMenu] = useState<"source" | "commits" | "options" | null>(
    null,
  );
  const [split, setSplit] = useState(false),
    [wrap, setWrap] = useState(false),
    [whitespace, setWhitespace] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const sourceButton = useRef<HTMLButtonElement>(null),
    optionsButton = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dataKey = useRef("");
  const shownPath = useRef<ReviewRequest | null>(null);
  const query = `${source}:${base}:${commit?.sha ?? ""}:${whitespace}`;
  function cancelCommitHover() {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
    if (hoverKeyListener.current) {
      document.removeEventListener("keydown", hoverKeyListener.current, true);
      hoverKeyListener.current = undefined;
    }
  }
  useEffect(() => {
    cancelCommitHover();
    return cancelCommitHover;
  }, [menu]);
  function openCommits(keyboard: boolean) {
    cancelCommitHover();
    setCommitAutoFocus(keyboard);
    commitButton.current?.focus({ preventScroll: true });
    setMenu("commits");
  }
  function hoverCommits(event: React.PointerEvent) {
    if (
      event.pointerType !== "mouse" ||
      menu === "commits" ||
      hoverTimer.current
    )
      return;
    hoverKeyListener.current = cancelCommitHover;
    document.addEventListener("keydown", cancelCommitHover, true);
    hoverTimer.current = setTimeout(() => openCommits(false), 200);
    queueMicrotask(() => {
      if (event.defaultPrevented) cancelCommitHover();
    });
  }
  useEffect(() => {
    if (request?.diffFilter) setSource(request.diffFilter);
    if (request?.path)
      setCollapsed((old) => {
        const next = new Set(old);
        next.delete(request.path!);
        return next;
      });
  }, [request]);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const key = `${api.connection.scope ?? api.connection.url}:${id}:${query}`;
    if (dataKey.current !== key) {
      setData(null);
      setError("");
    }
    async function load() {
      if (loading || controller.signal.aborted) return;
      loading = true;
      setBusy(true);
      try {
        const params = new URLSearchParams({ source });
        if (source === "branch" && base) params.set("base_branch", base);
        if (source === "commit" && commit) params.set("commit", commit.sha);
        if (whitespace) params.set("hide_whitespace", "true");
        const result = await api.request<ReviewData>(
          `/sessions/${id}/review?${params}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          dataKey.current = key;
          setData(result);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        loading = false;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    const focus = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [api, id, query, revision, refresh]);
  const files = useMemo(() => parseReviewDiff(data?.diff ?? ""), [data?.diff]);
  const additions = files.reduce((n, f) => n + f.additions, 0),
    deletions = files.reduce((n, f) => n + f.deletions, 0);
  useEffect(() => {
    if (!menu) return;
    if (menu !== "commits") {
      if (preserveSourceFocus.current && menu === "source") {
        preserveSourceFocus.current = false;
      } else if (returnToCommit.current && menu === "source")
        commitButton.current?.focus();
      else
        menuRef.current
          ?.querySelector<HTMLButtonElement>(
            'button[aria-checked="true"],button',
          )
          ?.focus();
      returnToCommit.current = false;
    }
    const outside = (event: Event) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !sourceButton.current?.contains(event.target as Node) &&
        !optionsButton.current?.contains(event.target as Node)
      )
        setMenu(null);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [menu]);
  useEffect(() => {
    if (menu !== "commits") return;
    const position = () => {
      const rect = menuRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 320;
      setPlacement(
        window.innerWidth < 768
          ? "overlay"
          : window.innerWidth - rect.right >= width + 10
            ? "right"
            : rect.left >= width + 10
              ? "left"
              : "overlay",
      );
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [menu]);
  useEffect(() => {
    if (!request?.path || !data || busy || shownPath.current === request)
      return;
    const target = reviewFilePath(request.path, data.root);
    const file = files.find(
      (file) => file.path === target || file.previousPath === target,
    );
    if (!file) return;
    shownPath.current = request;
    setCollapsed((old) => {
      if (!old.has(file.path)) return old;
      const next = new Set(old);
      next.delete(file.path);
      return next;
    });
    const frame = requestAnimationFrame(() => {
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>("[data-review-path]") ??
          [],
      )
        .find((node) => node.dataset.reviewPath === file.path)
        ?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [request, data, files, busy]);
  function closeMenu() {
    const button =
      menu === "options" ? optionsButton.current : sourceButton.current;
    setMenu(null);
    button?.focus();
  }
  function choose(next: ReviewSource) {
    setSource(next);
    try {
      localStorage.setItem("anywork.review.source", next);
    } catch {}
    closeMenu();
  }
  function backToSources() {
    returnToCommit.current = true;
    setMenu("source");
  }
  const reason =
    data?.reason === "not-a-repository"
      ? "当前目录不是 Git 仓库"
      : data?.reason === "default-branch-unavailable"
        ? "选择基准分支以查看变更"
        : "无法找到与基准分支的共同祖先";
  return (
    <div
      ref={panel}
      className={`review-panel${split ? " review-split" : ""}${wrap ? " review-wrap" : ""}`}
      aria-label="变更审阅"
    >
      <div className="review-toolbar">
        <div className="review-menu-host">
          <button
            ref={sourceButton}
            className="review-source-button"
            aria-label="差异来源"
            aria-haspopup="menu"
            aria-expanded={menu === "source" || menu === "commits"}
            onClick={() =>
              setMenu(menu === "source" || menu === "commits" ? null : "source")
            }
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setMenu("source");
              }
            }}
          >
            <span>
              {source === "commit"
                ? "提交"
                : sources.find((s) => s.id === source)?.label}
            </span>
            <ChevronDown size={13} />
          </button>
          {(menu === "source" || menu === "commits") && (
            <div
              className="review-menu"
              role="menu"
              aria-label="差异来源"
              ref={menuRef}
              onFocus={(event) => {
                const target = event.target as HTMLElement;
                if (
                  menu === "commits" &&
                  target !== commitButton.current &&
                  target.closest('[role="menu"]') === menuRef.current
                ) {
                  // Moving through the source menu must not pull focus back to its first row.
                  preserveSourceFocus.current = true;
                  setMenu("source");
                }
              }}
              onPointerMove={(event) => {
                if (event.pointerType !== "mouse") return;
                const target = (
                  event.target as HTMLElement
                ).closest<HTMLButtonElement>("button");
                if (
                  target &&
                  target.closest('[role="menu"]') === menuRef.current &&
                  target !== commitButton.current
                )
                  target.focus({ preventScroll: true });
              }}
              onKeyDown={(e) => {
                if (e.key === "Tab") setMenu(null);
                menuKey(e, closeMenu);
              }}
            >
              <div hidden={menu === "commits" && placement === "overlay"}>
                {sources
                  .filter((s) => s.id !== "branch")
                  .map((s, i) => (
                    <div key={s.id}>
                      {i === 1 && (
                        <div
                          className="review-menu-separator"
                          role="separator"
                        />
                      )}
                      <button
                        role="menuitemradio"
                        aria-checked={source === s.id}
                        onClick={() => choose(s.id)}
                      >
                        <span className="review-menu-check">
                          {source === s.id && <Check size={14} />}
                        </span>
                        {s.label}
                      </button>
                    </div>
                  ))}
                <div className="review-menu-separator" role="separator" />
                <button
                  ref={commitButton}
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={menu === "commits"}
                  onClick={(event) => openCommits(event.detail === 0)}
                  onPointerEnter={hoverCommits}
                  onPointerMove={hoverCommits}
                  onPointerLeave={cancelCommitHover}
                  onKeyDown={(e) => {
                    cancelCommitHover();
                    if (["ArrowRight", "Enter", " "].includes(e.key)) {
                      e.preventDefault();
                      e.stopPropagation();
                      openCommits(true);
                    } else if (e.key === "Escape" && menu === "commits") {
                      e.preventDefault();
                      e.stopPropagation();
                      backToSources();
                    }
                  }}
                >
                  <span className="review-menu-check">
                    {source === "commit" && <Check size={14} />}
                  </span>
                  提交
                  <ChevronRight size={14} className="review-commit-chevron" />
                </button>
                <button
                  role="menuitemradio"
                  aria-checked={source === "branch"}
                  onClick={() => choose("branch")}
                >
                  <span className="review-menu-check">
                    {source === "branch" && <Check size={14} />}
                  </span>
                  分支
                </button>
              </div>
              {menu === "commits" && (
                <ReviewCommitMenu
                  api={api}
                  id={id}
                  base={base}
                  revision={revision}
                  selected={commit?.sha}
                  placement={placement}
                  autoFocus={commitAutoFocus}
                  anchor={commitButton}
                  onBack={backToSources}
                  onDismiss={() => setMenu(null)}
                  onChoose={(next) => {
                    setCommit(next);
                    setSource("commit");
                    closeMenu();
                  }}
                />
              )}
            </div>
          )}
        </div>
        <span
          className="review-total"
          aria-label={`${additions} 行新增，${deletions} 行删除`}
        >
          <span className="review-add">+{additions}</span>
          <span className="review-remove">−{deletions}</span>
        </span>
        <div className="review-toolbar-space" />
        <button
          className="review-icon-button"
          aria-label="刷新差异"
          title="刷新差异"
          disabled={busy}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={15} className={busy ? "review-refreshing" : ""} />
        </button>
        <div className="review-menu-host">
          <button
            ref={optionsButton}
            className="review-icon-button"
            aria-label="变更选项"
            title="变更选项"
            aria-haspopup="menu"
            aria-expanded={menu === "options"}
            onClick={() => setMenu(menu === "options" ? null : "options")}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setMenu("options");
              }
            }}
          >
            <MoreHorizontal size={18} />
          </button>
          {menu === "options" && (
            <div
              className="review-menu review-options"
              role="menu"
              aria-label="变更选项"
              ref={menuRef}
              onKeyDown={(e) => menuKey(e, closeMenu)}
            >
              <button
                role="menuitemcheckbox"
                aria-checked={split}
                onClick={() => {
                  setSplit(!split);
                  closeMenu();
                }}
              >
                <span className="review-menu-check">
                  {split && <Check size={14} />}
                </span>
                <Columns2 size={14} />
                左右对照
              </button>
              <button
                role="menuitemcheckbox"
                aria-checked={wrap}
                onClick={() => {
                  setWrap(!wrap);
                  closeMenu();
                }}
              >
                <span className="review-menu-check">
                  {wrap && <Check size={14} />}
                </span>
                自动换行
              </button>
              <button
                role="menuitemcheckbox"
                aria-checked={whitespace}
                disabled={source === "last-turn"}
                onClick={() => {
                  setWhitespace(!whitespace);
                  closeMenu();
                }}
              >
                <span className="review-menu-check">
                  {whitespace && <Check size={14} />}
                </span>
                忽略空白变更
              </button>
              <div className="review-menu-separator" role="separator" />
              <button
                role="menuitem"
                onClick={() => {
                  setCollapsed(
                    files.every((f) => collapsed.has(f.path))
                      ? new Set()
                      : new Set(files.map((f) => f.path)),
                  );
                  closeMenu();
                }}
              >
                {files.length > 0 && files.every((f) => collapsed.has(f.path))
                  ? "展开所有差异"
                  : "折叠所有差异"}
              </button>
            </div>
          )}
        </div>
        <button
          className="review-icon-button"
          aria-label="关闭侧面板"
          title="关闭侧面板"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      {source === "commit" && commit && (
        <ReviewTooltip text={commit.message} side="top">
          <div
            className="review-selected-commit"
            aria-label="选中的提交"
            tabIndex={0}
          >
            <span>{commit.subject || commit.sha.slice(0, 7)}</span>
          </div>
        </ReviewTooltip>
      )}
      {source === "branch" && (
        <div className="review-branch-bar">
          <FileDiff size={14} />
          <span title={data?.current_branch ?? undefined}>
            {data?.current_branch ?? "当前分支"}
          </span>
          <span aria-hidden="true">←</span>
          <select
            aria-label="基准分支"
            value={base || data?.base_branch || ""}
            onChange={(e) => setBase(e.target.value)}
          >
            <option value="">选择基准分支</option>
            {[
              ...new Set([
                ...(data?.base_branch ? [data.base_branch] : []),
                ...(data?.branches ?? []),
              ]),
            ].map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="review-content" aria-busy={busy}>
        {error ? (
          <div className="review-empty" role="alert">
            <p>{error}</p>
            <button onClick={() => setRefresh((n) => n + 1)}>重试</button>
          </div>
        ) : !data ? (
          <div className="review-empty" role="status">
            正在加载差异…
          </div>
        ) : data.type === "expected" ? (
          <div className="review-empty">
            <FileDiff size={24} />
            <p>{reason}</p>
          </div>
        ) : !files.length ? (
          <div className="review-empty">
            <FileDiff size={24} />
            <p>{source === "last-turn" ? "这一轮暂无变更" : "暂无变更"}</p>
            {data.diff?.trim() && <pre>{data.diff}</pre>}
          </div>
        ) : (
          files.map((file) => (
            <section
              className="review-file"
              key={file.path}
              data-review-path={file.path}
            >
              <div className="review-file-heading">
                <button
                  className="review-file-toggle"
                  aria-expanded={!collapsed.has(file.path)}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old);
                      next.has(file.path)
                        ? next.delete(file.path)
                        : next.add(file.path);
                      return next;
                    })
                  }
                >
                  {collapsed.has(file.path) ? (
                    <ChevronRight size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                  <FileText size={14} />
                  <span title={file.path}>
                    {file.previousPath && (
                      <span className="review-previous-path">
                        {file.previousPath} →{" "}
                      </span>
                    )}
                    {file.path}
                  </span>
                </button>
                <span className="review-file-kind">
                  {
                    {
                      added: "新增",
                      deleted: "删除",
                      renamed: "重命名",
                      modified: "",
                    }[file.kind]
                  }
                </span>
                <span className="review-total">
                  <span className="review-add">+{file.additions}</span>
                  <span className="review-remove">−{file.deletions}</span>
                </span>
                {file.kind !== "deleted" && (
                  <button
                    className="review-icon-button"
                    aria-label={`打开文件 ${file.path}`}
                    title="打开文件"
                    onClick={() =>
                      onOpenFile({
                        path: data.root
                          ? `${data.root}/${file.path}`
                          : file.path,
                      })
                    }
                  >
                    <FileText size={14} />
                  </button>
                )}
              </div>
              {!collapsed.has(file.path) && (
                <div className="review-file-body">
                  {file.binary ? (
                    <p className="review-file-notice">二进制文件已更改</p>
                  ) : !file.hunks.length ? (
                    <div className="review-file-notice">
                      {file.metadata
                        .filter((line) => !line.startsWith("index "))
                        .map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                    </div>
                  ) : (
                    <div
                      className="review-code"
                      role="region"
                      aria-label={`${file.path} 差异`}
                    >
                      <DiffBoundary key={file.patch} patch={file.patch}>
                        <Suspense
                          fallback={
                            <p className="review-file-notice" role="status">
                              正在加载差异…
                            </p>
                          }
                        >
                          <ReviewDiffView
                            file={file}
                            split={split}
                            wrap={wrap}
                          />
                        </Suspense>
                      </DiffBoundary>
                    </div>
                  )}
                </div>
              )}
            </section>
          ))
        )}
        {!!data?.untracked_files_omitted && (
          <p className="review-file-notice">
            另有 {data.untracked_files_omitted} 个未跟踪项未显示。
          </p>
        )}
      </div>
    </div>
  );
}
class DiffBoundary extends Component<
  { patch: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="review-diff-fallback">
          <p role="status">无法显示这段差异，显示原始补丁。</p>
          <pre>{this.props.patch}</pre>
        </div>
      );
    return this.props.children;
  }
}
