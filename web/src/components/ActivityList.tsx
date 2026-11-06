import { createContext, Fragment, useContext, type ReactNode } from "react";
import { ChevronRight, MessageCircle, Users } from "lucide-react";
import type { Message } from "../types";
import {
  agentActionLabel,
  agentActivityTargets,
  agentPathName,
  groupToolActivities,
} from "../toolPresentation";
import { SubagentAvatar } from "./SubagentsPanel";
import "./activity.css";

export const ActivityNavigationContext = createContext<{
  openSubagent: (threadId: string, name: string) => void;
  canOpenSubagent?: (threadId: string) => boolean;
} | null>(null);

/** Shared native seeded avatar palette, also used by the Subagents panel. */
export function ActivityAgentAvatar({ seed }: { seed: string }) {
  return (
    <span className="activity-agent-avatar">
      <SubagentAvatar seed={seed} />
    </span>
  );
}

function AgentLink({
  threadId,
  name,
  model,
}: {
  threadId: string;
  name: string;
  model?: string;
}) {
  const navigation = useContext(ActivityNavigationContext);
  if (!navigation || navigation.canOpenSubagent?.(threadId) === false)
    return <span title={model ? `使用 ${model}` : undefined}>{name}</span>;
  return (
    <button
      className="activity-agent-link"
      onClick={() => navigation.openSubagent(threadId, name)}
      aria-label={`打开 ${name} 子 Agent`}
      title={model ? `使用 ${model}` : undefined}
    >
      {name}
    </button>
  );
}

function SubagentActivity({ message }: { message: Message }) {
  const navigation = useContext(ActivityNavigationContext);
  const item = message.item!;
  const name = item.displayName || agentPathName(item.agentPath) || "Agent";
  const interacted = item.kind === "interacted" || item.isMessage === true;
  const threadId = item.agentThreadId || "";
  if (interacted)
    return (
      <div className="agent-event-row" data-message-id={message.id}>
        <MessageCircle size={16} aria-hidden="true" />
        <span>
          已发送消息给{" "}
          {item.displayName || agentPathName(item.agentPath) || "父 Agent"}
        </span>
      </div>
    );
  const status = item.displayStatus || item.kind;
  const label = `${name} ${status === "completed" || status === "done" ? "已完成" : status === "interrupted" ? "已中断" : status === "updated" ? "已更新" : "开始工作"}`;
  const content = (
    <>
      <ActivityAgentAvatar seed={threadId || name} />
      <span>{label}</span>
    </>
  );
  return navigation &&
    threadId &&
    navigation.canOpenSubagent?.(threadId) !== false ? (
    <button
      className="agent-event-row agent-event-button"
      data-message-id={message.id}
      onClick={() => navigation.openSubagent(threadId, name)}
      aria-label={`打开 ${name} 子 Agent`}
    >
      {content}
    </button>
  ) : (
    <div className="agent-event-row" data-message-id={message.id}>
      {content}
    </div>
  );
}

function MultiAgentActivity({ message }: { message: Message }) {
  const item = message.item!;
  const targets = agentActivityTargets(item);
  const label = agentActionLabel(item);
  return (
    <details
      className="activity-group multi-agent-activity"
      data-message-id={message.id}
    >
      <summary>
        <Users size={16} aria-hidden="true" />
        <span>
          {label} {targets.length > 1 ? `${targets.length} 个 Agent` : "Agent"}
        </span>
        <ChevronRight size={12} aria-hidden="true" />
      </summary>
      <div className="activity-group-body agent-action-details">
        {targets.map((target) => (
          <div className="agent-action-target" key={target.threadId}>
            <ActivityAgentAvatar seed={target.threadId} />
            <div className="agent-action-content">
              <div className="agent-action-description">
                <span>{label}</span>{" "}
                <AgentLink
                  threadId={target.threadId}
                  name={target.name}
                  model={item.model}
                />
                {target.role && target.role !== "default" && (
                  <span> ({target.role})</span>
                )}
                {target.state && (
                  <span className="agent-action-state">
                    {" "}
                    (
                    {(
                      {
                        pendingInit: "正在初始化",
                        running: "正在工作",
                        completed: "已完成",
                        errored: "失败",
                        failed: "失败",
                        interrupted: "已中断",
                        shutdown: "已关闭",
                        notFound: "未找到",
                      } as Record<string, string>
                    )[target.state] || target.state}
                    {target.message ? `: ${target.message}` : ""})
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {targets.length === 0 && <div>{label} Agent</div>}
        {typeof item.prompt === "string" && item.prompt.trim() && (
          <div className="agent-action-prompt">
            <span>
              {["spawnAgent", "spawn_agent"].includes(item.tool ?? item.action)
                ? "指令"
                : "消息"}
            </span>
            <p>{item.prompt}</p>
          </div>
        )}
      </div>
    </details>
  );
}

export default function ActivityList({
  messages,
  render,
}: {
  messages: Message[];
  render: (message: Message) => ReactNode;
}) {
  return groupToolActivities(messages).map((group) => {
    const first = group.messages[0];
    if (group.kind === "images")
      return (
        <Fragment key={first.id}>
          {render({
            ...first,
            item: {
              ...first.item,
              paths: group.messages.map((message) => message.item!.path),
            },
          })}
        </Fragment>
      );
    if (["subAgentActivity", "subagent-activity"].includes(first.item?.type))
      return <SubagentActivity key={first.id} message={first} />;
    if (
      ["collabAgentToolCall", "multi-agent-action"].includes(first.item?.type)
    ) {
      // Native conversation hides wait polling; actual lifecycle rows carry its result.
      if ((first.item?.tool ?? first.item?.action) === "wait") return null;
      return <MultiAgentActivity key={first.id} message={first} />;
    }
    // Harness renders each tool in sequence, preserving its description and state.
    // Keep rich result/subagent renderers; do not hide individual tools in an aggregate.
    if (group.kind === "tools")
      return <Fragment key={first.id}>{group.messages.map(render)}</Fragment>;
    return <Fragment key={first.id}>{render(first)}</Fragment>;
  });
}
