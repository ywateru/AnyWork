import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import type { Api } from "../api";
import type { Session } from "../types";
import type { SubagentEntry } from "../subagents";
import { emptyHistory, type SessionHistoryCache } from "../sessionHistory";
import type { FileTarget } from "../fileLinks";
import { projectEvents } from "../events";
import { SubagentAvatar } from "./SubagentsPanel";
import TurnView from "./TurnView";
import ConversationMessage from "./conversation/ConversationMessage";
import SubagentComposer from "./SubagentComposer";
import RequestCard from "./RequestCard";
import "./SubagentConversation.css";

/** Opening a child only reads its existing transcript; it never starts an engine. */
export default function SubagentConversation({
  api,
  agent,
  cache,
  sessions,
  onBack,
  onOpenSession,
  onOpenFile,
}: {
  api: Api;
  agent: SubagentEntry;
  cache: SessionHistoryCache;
  sessions: Session[];
  onBack: () => void;
  onOpenSession: (id: string) => void;
  onOpenFile: (id: string, target: FileTarget) => void;
}) {
  const [localError, setError] = useState("");
  const child = sessions.find(
    (s) => s.id === agent.sessionId || s.thread_id === agent.threadId,
  );
  const snapshot = useSyncExternalStore(cache.subscribe, () =>
    child ? cache.get(child.id) : emptyHistory,
  );
  useEffect(
    () => (child ? cache.watch(child.id) : undefined),
    [cache, child?.id],
  );
  const { events, controls, loading, cursor, olderLoading: older } = snapshot;
  const error = localError || snapshot.error || snapshot.olderError;
  const view = useMemo(
    () => projectEvents([...events, ...controls]),
    [events, controls],
  );
  const refresh = () => {
    setError("");
    if (child) cache.retry(child.id);
  };
  async function loadOlder() {
    if (child) await cache.loadOlder(child.id);
  }
  return (
    <section
      className="subagent-conversation"
      aria-label={`子 Agent 会话：${agent.name}`}
    >
      <header className="subagent-conversation-heading">
        <button
          className="icon-button"
          aria-label="返回子 Agent 列表"
          onClick={onBack}
        >
          <ArrowLeft size={17} />
        </button>
        <SubagentAvatar seed={agent.threadId} />
        <div>
          <h2>{agent.name}</h2>
          {(agent.model || agent.reasoningEffort || child?.model) && (
            <span>
              {agent.model || child?.model}
              {agent.reasoningEffort ? ` · ${agent.reasoningEffort}` : ""}
            </span>
          )}
        </div>
        {child && (
          <button
            className="icon-button"
            title="打开完整子会话"
            aria-label="打开完整子会话"
            onClick={() => onOpenSession(child.id)}
          >
            <ExternalLink size={15} />
          </button>
        )}
      </header>
      <div className="subagent-conversation-scroll">
        {!child ? (
          <div className="subagent-conversation-empty">
            <p>这个子 Agent 的历史尚未出现在当前服务器的会话目录中。</p>
            {agent.objective && (
              <p className="subagent-objective">{agent.objective}</p>
            )}
            <p>
              当前状态：
              {agent.status === "done"
                ? "已完成"
                : agent.status === "waiting"
                  ? "等待中"
                  : "正在工作"}
            </p>
          </div>
        ) : loading ? (
          <div className="history-loading" role="status">
            <span className="loading-spinner" />
            正在加载子 Agent 会话…
          </div>
        ) : (
          <>
            {cursor && (
              <div className="older-history">
                <button disabled={older} onClick={() => void loadOlder()}>
                  {older ? "正在加载…" : "加载更早消息"}
                </button>
              </div>
            )}
            {view.turns.map((turn, index) => (
              <TurnView
                key={turn.id}
                turn={turn}
                latestWorking={
                  index === view.turns.length - 1 && agent.status === "active"
                }
                storageKey={`${api.connection.scope ?? api.connection.url}:${child.id}:${turn.id}`}
                render={(message) => (
                  <ConversationMessage
                    key={message.id}
                    message={message}
                    api={api}
                    sessionId={child.id}
                    cwd={child.cwd}
                    onOpenFile={(target) => onOpenFile(child.id, target)}
                  />
                )}
              />
            ))}
            {!events.length && !error && (
              <p className="subagent-conversation-empty">
                还没有可显示的子 Agent 消息。
              </p>
            )}
          </>
        )}
        {error && (
          <div className="history-error" role="alert">
            {error}
            <button onClick={refresh}>
              <RefreshCw size={14} />
              重新加载
            </button>
          </div>
        )}
      </div>
      {child && agent.canInteract && !child.archived && (
        <>
          {view.pending.length > 0 && (
            <div
              className="subagent-requests composer-requests"
              aria-label="子 Agent 待处理请求"
            >
              {view.pending.map((event) => (
                <RequestCard
                  key={String(event.request_id)}
                  event={event}
                  relatedEvents={[...events, ...controls]}
                  api={api}
                  onError={(e) => setError(String(e))}
                />
              ))}
            </div>
          )}
          <SubagentComposer
            api={api}
            session={child}
            name={agent.name}
            onChanged={refresh}
          />
        </>
      )}
    </section>
  );
}
