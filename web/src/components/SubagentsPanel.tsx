import { useEffect, useId, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  subagentAvatarIndex,
  subagentElapsed,
  subagentRelative,
  type SubagentEntry,
} from "../subagents";
import avatarPalette from "../subagentAvatars.json";
import "./SubagentsPanel.css";

export function SubagentAvatar({ seed }: { seed: string }) {
  const index = subagentAvatarIndex(seed);
  const avatar = avatarPalette[index];
  return (
    <span className="subagent-avatar" aria-hidden="true">
      <img
        className="subagent-avatar-light"
        src={avatar.light}
        alt=""
        draggable={false}
      />
      <img
        className="subagent-avatar-dark"
        src={avatar.dark}
        alt=""
        draggable={false}
      />
    </span>
  );
}

function AgentSection({
  title,
  agents,
  limit,
  now,
  onOpenAgent,
  onOpenSession,
}: {
  title: string;
  agents: SubagentEntry[];
  limit: number;
  now: number;
  onOpenAgent?: (agent: SubagentEntry) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const visible = expanded ? agents : agents.slice(0, limit);
  const waiting = agents.filter((agent) => agent.status === "waiting").length;
  if (title === "Done" && !agents.length) return null;
  return (
    <section className="subagents-section" aria-labelledby={id}>
      <h2 id={id}>
        <span>
          {title} · {agents.length}
        </span>
        {waiting > 0 && <span>{waiting} 等待中</span>}
      </h2>
      {!agents.length ? (
        <p className="subagents-empty">没有正在运行的子 Agent</p>
      ) : (
        <div className="subagents-list">
          {visible.map((agent) => (
            <div
              className="subagent-entry"
              key={agent.threadId}
              data-status={agent.status}
            >
              <button
                type="button"
                className="subagent-row"
                onClick={() => onOpenAgent?.(agent)}
                disabled={!onOpenAgent}
                aria-label={`查看子 Agent：${agent.name}`}
              >
                <SubagentAvatar seed={agent.threadId} />
                <span className="subagent-row-body">
                  <span className="subagent-title-line">
                    <span className="subagent-name">{agent.name}</span>
                    <span className="subagent-time">
                      {agent.status === "waiting" && <span>等待中</span>}
                      {agent.status === "failed" ? (
                        <span className="subagent-failed">失败</span>
                      ) : agent.status === "done" ? (
                        agent.updatedAtMs != null && (
                          <time
                            dateTime={new Date(agent.updatedAtMs).toISOString()}
                          >
                            {subagentRelative(agent.updatedAtMs, now)}
                          </time>
                        )
                      ) : (
                        agent.startedAtMs != null && (
                          <span>{subagentElapsed(agent.startedAtMs, now)}</span>
                        )
                      )}
                    </span>
                  </span>
                  {(agent.preview || agent.status !== "done") && (
                    <span className="subagent-preview">
                      {agent.preview ||
                        (agent.status === "waiting"
                          ? "等待指令"
                          : agent.status === "unknown"
                            ? "状态暂不可用"
                            : agent.status === "failed"
                              ? "执行失败"
                              : "正在工作")}
                    </span>
                  )}
                </span>
              </button>
              {agent.sessionId && onOpenSession && (
                <button
                  type="button"
                  className="subagent-open"
                  title="打开子会话"
                  aria-label={`打开子会话：${agent.name}`}
                  onClick={() => onOpenSession(agent.sessionId!)}
                >
                  <ExternalLink size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {agents.length > limit && (
        <button
          type="button"
          className="subagents-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : `显示其余 ${agents.length - limit} 个`}
        </button>
      )}
    </section>
  );
}

export default function SubagentsPanel({
  agents,
  onOpenAgent,
  onOpenSession,
  loading = false,
}: {
  agents: SubagentEntry[];
  onOpenAgent?: (agent: SubagentEntry) => void;
  onOpenSession?: (sessionId: string) => void;
  loading?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (loading)
    return (
      <div className="subagents-panel subagents-loading" role="status">
        正在加载子 Agent…
      </div>
    );
  return (
    <div className="subagents-panel" aria-label="子 Agent">
      <div className="subagents-content">
        <AgentSection
          title="Active"
          agents={agents.filter((agent) => agent.status !== "done")}
          limit={4}
          now={now}
          onOpenAgent={onOpenAgent}
          onOpenSession={onOpenSession}
        />
        <AgentSection
          title="Done"
          agents={agents.filter((agent) => agent.status === "done")}
          limit={10}
          now={now}
          onOpenAgent={onOpenAgent}
          onOpenSession={onOpenSession}
        />
      </div>
    </div>
  );
}
