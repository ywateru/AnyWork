import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  LoaderCircle,
  Plus,
} from "lucide-react";
import type { GroupMode } from "./NavigationHeader";
import type { Session, WorkspaceInfo } from "../types";
import { agentName, sidebarSessions } from "../sidebarAgents";
import AgentIcon from "./AgentIcon";

export default function SessionSidebar({
  sessions,
  loading = false,
  loadError = false,
  onRetry,
  selected,
  archived,
  filter,
  project,
  group,
  agent = "",
  agentLabel,
  onClearAgent,
  onSelect,
  onCreate,
}: {
  sessions: Session[];
  loading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
  selected: string;
  archived: boolean;
  filter: string;
  project?: string;
  group?: GroupMode;
  agent?: string;
  agentLabel?: string;
  onClearAgent?: () => void;
  onSelect: (id: string) => void;
  onCreate: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [helpers, setHelpers] = useState<Record<string, boolean>>({});
  const term = filter.trim().toLowerCase();
  const visible = sidebarSessions(sessions, {
    agent,
    archived,
    project,
    search: filter,
  });
  const paths = new Map<string, WorkspaceInfo & { updated_at: number }>();
  for (const s of visible) {
    const directory = paths.get(s.cwd);
    if (directory)
      directory.updated_at = Math.max(directory.updated_at, s.updated_at);
    else
      paths.set(s.cwd, {
        path: s.cwd,
        name: s.cwd.split("/").pop() || s.cwd,
        root: false,
        sessions: 0,
        updated_at: s.updated_at,
      });
  }
  function row(s: Session) {
    return (
      <button
        key={s.id}
        className={`session-row${s.id === selected ? " active" : ""}`}
        title={`${s.title} · ${agentName(s.agent)} · ${s.cwd} · ${statusText(s.status)}`}
        aria-label={s.title}
        aria-current={s.id === selected ? "page" : undefined}
        onClick={() => onSelect(s.id)}
      >
        <AgentIcon agent={s.agent} />
        <span className="sr-only">
          {agentName(s.agent)} · {statusText(s.status)}
        </span>
        <span className="session-info">
          <strong>{s.title}</strong>
        </span>
        <span className="session-trailing">
          {["running", "starting"].includes(s.status) ? (
            <span
              className="session-execution-indicator"
              role="img"
              aria-label={s.status === "starting" ? "正在启动" : "正在执行"}
              title={statusText(s.status)}
            />
          ) : s.status === "waiting" ? (
            <span className="needs-input" role="img" aria-label="等待回应">
              回应
            </span>
          ) : (
            <time dateTime={new Date(s.updated_at).toISOString()}>
              {relativeTime(s.updated_at)}
            </time>
          )}
        </span>
      </button>
    );
  }
  if (loading || loadError)
    return (
      <nav
        className="session-list"
        aria-label="工作目录与会话"
        aria-busy={loading}
      >
        <div
          className="sidebar-empty sidebar-loading"
          role={loadError ? "alert" : "status"}
        >
          {loading ? (
            <>
              <LoaderCircle size={16} className="spin" aria-hidden="true" />{" "}
              正在加载会话…
            </>
          ) : (
            <>
              会话加载失败 <button onClick={onRetry}>重试</button>
            </>
          )}
        </div>
      </nav>
    );
  if (!visible.length)
    return (
      <nav className="session-list" aria-label="工作目录与会话">
        <div className="sidebar-empty">
          {agent ? (
            <>
              <p>没有符合当前筛选的 {agentLabel || agentName(agent)} 会话</p>
              <button className="sidebar-clear-agent" onClick={onClearAgent}>
                查看所有 Agent
              </button>
            </>
          ) : term || project ? (
            "没有找到匹配的目录或会话"
          ) : archived ? (
            "没有已归档会话"
          ) : (
            "还没有会话，点击 + 开始"
          )}
        </div>
      </nav>
    );
  if (group === "status") {
    const matches = visible.filter(
      (s) => !term || `${s.title} ${s.cwd}`.toLowerCase().includes(term),
    );
    const groups = [
      {
        id: "waiting",
        label: "需要回应",
        items: matches.filter((s) => !s.auxiliary && s.status === "waiting"),
      },
      {
        id: "running",
        label: "执行中",
        items: matches.filter(
          (s) => !s.auxiliary && ["running", "starting"].includes(s.status),
        ),
      },
      {
        id: "recent",
        label: "最近会话",
        items: matches.filter((s) => !s.auxiliary && s.status === "idle"),
      },
      {
        id: "error",
        label: "需要检查",
        items: matches.filter(
          (s) => !s.auxiliary && ["error", "disconnected"].includes(s.status),
        ),
      },
      {
        id: "unknown",
        label: "状态未知",
        items: matches.filter(
          (s) =>
            !s.auxiliary &&
            ![
              "waiting",
              "running",
              "starting",
              "idle",
              "error",
              "disconnected",
            ].includes(s.status),
        ),
      },
      {
        id: "auxiliary",
        label: "辅助会话",
        items: matches.filter((s) => s.auxiliary),
      },
    ];
    return (
      <nav className="session-list status-list" aria-label="工作目录与会话">
        {groups
          .filter((g) => g.items.length)
          .map((g) => {
            const items = [...g.items].sort(
              (a, b) => b.updated_at - a.updated_at,
            );
            const open =
              !!term ||
              (g.id === "auxiliary" ? !!expanded[g.id] : !collapsed[g.id]);
            const all =
              !!term ||
              expanded[g.id] ||
              items.slice(8).some((s) => s.id === selected);
            return (
              <section className="status-group" key={g.id} data-group={g.id}>
                <button
                  className="status-group-heading"
                  aria-expanded={open}
                  onClick={() =>
                    g.id === "auxiliary"
                      ? setExpanded({ ...expanded, [g.id]: !open })
                      : setCollapsed({ ...collapsed, [g.id]: open })
                  }
                >
                  <span>
                    {g.label}
                    <b>{items.length}</b>
                  </span>
                  {open ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </button>
                {open && (
                  <>
                    {(all ? items : items.slice(0, 8)).map(row)}
                    {items.length > 8 && !term && (
                      <button
                        className="show-threads"
                        onClick={() =>
                          setExpanded({ ...expanded, [g.id]: !all })
                        }
                      >
                        {all
                          ? "收起会话"
                          : `展开显示 · 还有 ${items.length - 8} 个会话`}
                      </button>
                    )}
                  </>
                )}
              </section>
            );
          })}
        {!matches.length && (
          <p className="sidebar-empty">
            {term
              ? "没有找到匹配的目录或会话"
              : archived
                ? "没有已归档会话"
                : "还没有会话，点击 + 开始"}
          </p>
        )}
      </nav>
    );
  }
  return (
    <nav className="session-list workspace-list" aria-label="工作目录与会话">
      {[...paths.values()]
        .sort(
          (a, b) => b.updated_at - a.updated_at || a.path.localeCompare(b.path),
        )
        .map((w) => {
          const directoryMatch = `${w.name} ${w.path}`
            .toLowerCase()
            .includes(term);
          const matches = visible.filter(
            (s) =>
              s.cwd === w.path &&
              (!term || directoryMatch || s.title.toLowerCase().includes(term)),
          );
          if (archived && !matches.length) return null;
          if (term && !directoryMatch && !matches.length) return null;
          const main = matches.filter((s) => !s.auxiliary),
            auxiliary = matches.filter((s) => s.auxiliary);
          const open = !!term || !collapsed[w.path];
          const showAll =
            !!term ||
            expanded[w.path] ||
            main.slice(5).some((s) => s.id === selected);
          return (
            <section
              className="workspace-group"
              key={w.path}
              data-workspace={w.path}
            >
              <div className="workspace-heading">
                <button
                  className="workspace-toggle"
                  aria-expanded={open}
                  title={w.path}
                  onClick={() => setCollapsed({ ...collapsed, [w.path]: open })}
                >
                  {open ? (
                    <ChevronDown size={12} className="folder-chevron" />
                  ) : (
                    <ChevronRight size={12} className="folder-chevron" />
                  )}
                  <span className="folder-symbol">
                    {open ? (
                      <FolderOpen size={17} />
                    ) : (
                      <Folder size={17} />
                    )}{" "}
                  </span>
                  <span className="workspace-name">
                    {w.path.split("/").filter(Boolean).pop() || w.path}
                  </span>
                </button>
                <button
                  className="workspace-add"
                  title={`在 ${w.name} 新建会话`}
                  onClick={() => onCreate(w.path)}
                >
                  <Plus size={14} />
                </button>
              </div>
              {open && (
                <div className="workspace-threads">
                  {(showAll ? main : main.slice(0, 5)).map(row)}
                  {main.length > 5 && !term && (
                    <button
                      className="show-threads"
                      onClick={() =>
                        setExpanded({ ...expanded, [w.path]: !showAll })
                      }
                    >
                      {showAll
                        ? "收起会话"
                        : `展开显示 · 还有 ${main.length - 5} 个会话`}
                    </button>
                  )}
                  {auxiliary.length > 0 && (
                    <>
                      <button
                        className="show-threads auxiliary-toggle"
                        aria-expanded={!!term || !!helpers[w.path]}
                        onClick={() =>
                          setHelpers({ ...helpers, [w.path]: !helpers[w.path] })
                        }
                      >
                        {helpers[w.path] || term ? (
                          <ChevronDown size={12} />
                        ) : (
                          <ChevronRight size={12} />
                        )}{" "}
                        辅助会话 <span>{auxiliary.length}</span>
                      </button>
                      {(helpers[w.path] || term) && auxiliary.map(row)}
                    </>
                  )}
                </div>
              )}
            </section>
          );
        })}
      {term &&
        ![...paths.values()].some((w) =>
          `${w.name} ${w.path}`.toLowerCase().includes(term),
        ) &&
        !visible.some((s) => s.title.toLowerCase().includes(term)) && (
          <p className="sidebar-empty">没有找到匹配的目录或会话</p>
        )}
    </nav>
  );
}

function statusText(status: string) {
  return (
    (
      {
        running: "执行中",
        starting: "启动中",
        waiting: "等待回应",
        idle: "待命",
        error: "异常",
        disconnected: "待恢复",
      } as Record<string, string>
    )[status] || "运行状态未知"
  );
}
function relativeTime(value: number) {
  const diff = Math.max(0, Date.now() - value);
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时`;
  return new Date(value).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}
