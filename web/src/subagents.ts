import type { AgentEvent, Session } from "./types";

export type SubagentStatus =
  "active" | "waiting" | "done" | "failed" | "unknown";
export interface SubagentEntry {
  threadId: string;
  sessionId: string | null;
  name: string;
  status: SubagentStatus;
  preview: string | null;
  objective: string | null;
  startedAtMs: number | null;
  updatedAtMs: number | null;
  model: string | null;
  reasoningEffort: string | null;
  canInteract: boolean;
}

type Data = Record<string, any>;
const record = (value: unknown): Data =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Data)
    : {};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const time = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
const first = (...values: unknown[]) => values.map(text).find(Boolean) ?? null;

function parsed(value: unknown): Data {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}

function status(value: unknown): SubagentStatus {
  const raw =
    typeof value === "string"
      ? value
      : (record(value).type ?? record(value).status);
  switch (raw) {
    case "active":
    case "running":
    case "working":
    case "inProgress":
    case "in_progress":
    case "started":
      return "active";
    case "pendingInit":
    case "waiting":
    case "waitingForInput":
    case "waiting_for_input":
    case "starting":
    case "queued":
      return "waiting";
    case "completed":
    case "done":
    case "idle":
    case "success":
      return "done";
    case "failed":
    case "errored":
    case "error":
    case "systemError":
      return "failed";
    default:
      return "unknown";
  }
}

/** Matches the shipped avatar seed hash, including UTF-16 iteration. */
export function subagentAvatarIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  return hash % 28;
}

export function subagentPreview(value: unknown, limit = 60): string | null {
  const raw = text(value);
  if (!raw) return null;
  const plain = raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const points = Array.from(plain);
  return points.length > limit
    ? points.slice(0, limit - 1).join("") + "…"
    : plain || null;
}

/** Read-only projection. A completed tool invocation never implies its child finished. */
export function projectSubagents(
  events: AgentEvent[],
  sessions: Session[],
  parentSessionId?: string,
): SubagentEntry[] {
  const entries = new Map<string, SubagentEntry>();
  const hidden = new Set<string>();
  const parent = sessions.find((session) => session.id === parentSessionId);
  const parentThreadId = parent?.thread_id;
  const byThread = new Map(
    sessions.filter((s) => s.thread_id).map((s) => [s.thread_id!, s]),
  );

  function entry(threadId: unknown, timestamp: number | null) {
    const id = text(threadId);
    if (!id || id === parentThreadId || id === parentSessionId) return null;
    let agent = entries.get(id);
    if (!agent) {
      agent = {
        threadId: id,
        sessionId: null,
        name: "子 Agent",
        status: "unknown",
        preview: null,
        objective: null,
        startedAtMs: timestamp,
        updatedAtMs: timestamp,
        model: null,
        reasoningEffort: null,
        canInteract: false,
      };
      entries.set(id, agent);
    }
    if (timestamp != null)
      agent.updatedAtMs = Math.max(agent.updatedAtMs ?? 0, timestamp);
    return agent;
  }

  function update(agent: SubagentEntry, data: Data, timestamp: number | null) {
    agent.name = first(
      data.displayName,
      data.name,
      data.title,
      data.agentNickname,
      typeof data.agentPath === "string"
        ? data.agentPath.split("/").pop()
        : null,
      agent.name,
    )!;
    agent.objective = first(data.objective, data.prompt, agent.objective);
    agent.preview = first(
      data.statusSummary,
      data.message,
      data.preview,
      agent.preview,
    );
    agent.model = first(data.model, agent.model);
    agent.reasoningEffort = first(
      data.reasoningEffort,
      data.reasoning_effort,
      agent.reasoningEffort,
    );
    agent.startedAtMs = time(data.startedAtMs) ?? agent.startedAtMs;
    agent.updatedAtMs =
      time(data.lastAssistantMessageAtMs) ??
      time(data.recencyAtMs) ??
      timestamp ??
      agent.updatedAtMs;
    const next = status(data.status);
    if (next !== "unknown") agent.status = next;
    if (
      ["shutdown", "notFound", "interrupted"].includes(data.status) ||
      next === "failed"
    )
      hidden.add(agent.threadId);
    else if (next === "active" || next === "waiting" || next === "done")
      hidden.delete(agent.threadId);
    if (typeof data.canInteract === "boolean")
      agent.canInteract = data.canInteract;
  }

  for (const event of events) {
    if (parentSessionId && event.session_id !== parentSessionId) continue;
    const p = event.params;
    const item = record(p.item);
    // Imported timestamps describe indexing; only explicit history times describe work.
    const timestamp =
      p.history_turn_id != null || p.history_id != null
        ? (time(p.history_item_started_at_ms) ??
          time(p.history_work_started_at))
        : time(event.created_at);
    if (
      item.type === "collabAgentToolCall" ||
      item.type === "collab-agent-tool-call"
    ) {
      const receiverThreads = Array.isArray(item.receiverThreads)
        ? item.receiverThreads
        : [];
      const ids = new Set<string>([
        ...(Array.isArray(item.receiverThreadIds)
          ? item.receiverThreadIds.filter((x: unknown) => typeof x === "string")
          : []),
        ...receiverThreads
          .map((x: unknown) => record(x).threadId)
          .filter((x: unknown) => typeof x === "string"),
        ...Object.keys(record(item.agentsStates)),
      ]);
      for (const id of ids) {
        const agent = entry(id, timestamp);
        if (!agent) continue;
        const child = record(
          record(
            receiverThreads.find((x: unknown) => record(x).threadId === id),
          ).thread,
        );
        const state = item.agentsStates?.[id];
        update(agent, child, timestamp);
        if (state != null)
          update(
            agent,
            typeof state === "string" ? { status: state } : record(state),
            timestamp,
          );
        agent.objective = first(item.prompt, agent.objective);
        if (item.tool === "spawnAgent") {
          agent.canInteract = true;
          agent.model = first(item.model, agent.model);
          if (agent.status === "unknown") agent.status = "waiting";
        }
        if (item.tool === "closeAgent") hidden.add(id);
      }
    } else if (
      item.type === "subAgentActivity" ||
      item.type === "subagent-activity"
    ) {
      // An interaction with an unrelated chat is not membership creation.
      if (item.kind === "interacted" && !entries.has(item.agentThreadId))
        continue;
      const agent = entry(item.agentThreadId, timestamp);
      if (agent)
        update(
          agent,
          {
            ...item,
            status: ["completed", "interrupted"].includes(item.kind)
              ? "completed"
              : (item.status ?? "running"),
          },
          timestamp,
        );
    } else if (
      item.type === "dynamicToolCall" ||
      item.type === "dynamic-tool-call"
    ) {
      const tool = String(item.tool ?? "")
        .split(/[./]/)
        .at(-1);
      if (
        ![
          "spawn_agent",
          "send_message_to_thread",
          "send_message",
          "wait_threads",
          "read_thread",
          "close_agent",
        ].includes(tool ?? "")
      )
        continue;
      const args = parsed(item.arguments);
      const content = item.contentItems ?? item.content ?? [];
      const result = {
        ...record(item.result),
        ...parsed(
          Array.isArray(content)
            ? content.find((x: Data) => ["inputText", "text"].includes(x.type))
                ?.text
            : null,
        ),
      };
      const isCreate = tool === "spawn_agent";
      const id = first(
        isCreate ? result.threadId : null,
        isCreate ? result.thread_id : null,
        isCreate ? result.agent_id : null,
        args.threadId,
        args.thread_id,
      );
      if (!id || (!isCreate && !entries.has(id))) continue;
      const agent = entry(id, timestamp);
      if (!agent) continue;
      if (isCreate) {
        update(agent, { ...args, ...result }, timestamp);
        agent.name = first(
          args.title,
          args.task_name,
          result.title,
          agent.name,
        )!;
        agent.objective = first(args.prompt, args.message, agent.objective);
        agent.canInteract = true;
        if (agent.status === "unknown") agent.status = "waiting";
      } else {
        update(agent, result, timestamp);
        if (tool === "close_agent") hidden.add(id);
      }
    }
  }

  for (const agent of entries.values()) {
    const session = byThread.get(agent.threadId);
    if (session) {
      agent.sessionId = session.id;
      agent.name = first(session.title, agent.name)!;
      agent.model = first(session.model, agent.model);
      const runtime = status(session.status);
      if (runtime !== "unknown") agent.status = runtime;
      if (runtime === "failed") hidden.add(agent.threadId);
      agent.updatedAtMs =
        Math.max(agent.updatedAtMs ?? 0, time(session.updated_at) ?? 0) || null;
      if (runtime === "active") hidden.delete(agent.threadId);
    }
    agent.preview =
      subagentPreview(agent.objective) ?? subagentPreview(agent.preview);
  }
  return [...entries.values()]
    .filter((agent) => !hidden.has(agent.threadId))
    .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
}

export function subagentElapsed(startedAtMs: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - startedAtMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function subagentRelative(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}
