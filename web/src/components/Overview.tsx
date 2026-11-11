import { ArrowUpRight, LoaderCircle, MessageSquare, Plus } from "lucide-react";
import type { Session } from "../types";
import { Button } from "./ui/button";
export default function Overview({
  sessions,
  loading = false,
  loadError = false,
  onRetry,
  onSelect,
  onCreate,
}: {
  sessions: Session[];
  loading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
  onSelect: (id: string) => void;
  onCreate: (cwd?: string) => void;
}) {
  const active = sessions.filter((s) => !s.archived && !s.auxiliary);
  const recent = [...active]
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 5);
  return (
    <div className="welcome overview-page">
      <div className="overview-intro">
        <div className="overview-mark">
          <img
            src={import.meta.env.BASE_URL + "icon.svg"}
            width="28"
            height="28"
            alt=""
          />
        </div>
        <div className="eyebrow">AnyWork</div>
        <h1>从哪里开始？</h1>
        <p>你的 Agent、项目和会话，都在这里。</p>
        <Button onClick={() => onCreate()}>
          <Plus size={16} />
          开始新会话
          <ArrowUpRight size={15} />
        </Button>
      </div>
      <section className="recent-work">
        <div className="overview-section-title">
          <h2>继续最近的工作</h2>
          <span>
            {loading
              ? "加载中"
              : loadError
                ? "连接异常"
                : `${active.length} 个会话`}
          </span>
        </div>
        {loading || loadError ? (
          <div
            className="overview-empty"
            role={loading ? "status" : "alert"}
            aria-busy={loading}
          >
            {loading ? (
              <>
                <LoaderCircle size={23} className="spin" />
                <p>正在加载会话…</p>
              </>
            ) : (
              <>
                <p>会话加载失败</p>
                <Button onClick={onRetry}>重试</Button>
              </>
            )}
          </div>
        ) : recent.length ? (
          recent.map((s) => (
            <button
              className="recent-session"
              key={s.id}
              onClick={() => onSelect(s.id)}
            >
              <span className={`session-state-dot ${s.status}`} />
              <div>
                <strong>{s.title}</strong>
                <span>
                  {s.cwd.split("/").filter(Boolean).pop()}
                  <i>·</i>
                  {s.agent}
                </span>
              </div>
              <ArrowUpRight size={16} />
            </button>
          ))
        ) : (
          <div className="overview-empty">
            <MessageSquare size={23} />
            <p>还没有会话</p>
            <span>选择工作目录，开始你的第一项任务。</span>
          </div>
        )}
      </section>
    </div>
  );
}
