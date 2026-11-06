import type { AgentEvent, Message, ConversationTurn } from "./types";
import { validMessageTime } from "./messageTime";
import { renderedUserText } from "./userText";
export function projectEvents(events: AgentEvent[]) {
  const messages: Message[] = [],
    items = new Map<string, Message>(),
    pending = new Map<string, AgentEvent>();
  let active = false;
  const turns: ConversationTurn[] = [];
  const byTurn = new Map<string, ConversationTurn>();
  let current: ConversationTurn | undefined;
  let eventTime = 0;
  let historical = false;
  const rawUserText = new Map<Message, string>();
  const nativeUserEcho = new Map<string, Message>();
  function turn(id?: string) {
    if (id && byTurn.has(id)) current = byTurn.get(id)!;
    else if (id || !current) {
      current = {
        id: id || `partial-${turns.length}`,
        messages: [],
        status: "unknown",
      };
      byTurn.set(current.id, current);
      turns.push(current);
    }
    return current!;
  }
  function append(message: Message) {
    messages.push(message);
    turn().messages.push(message);
  }

  function item(id: string, role: Message["role"]) {
    let m = items.get(id);
    if (!m) {
      m = {
        id,
        role,
        text: "",
        ...(!historical ? { startedAtMs: eventTime } : {}),
      };
      items.set(id, m);
      append(m);
    }
    return m;
  }
  for (const event of events) {
    const p = event.params,
      m = event.method;
    eventTime = event.created_at;
    historical = p.history_turn_id != null || p.history_id != null;
    if (p.history_turn_id) {
      const group = turn(p.history_turn_id);
      if (
        ["completed", "interrupted", "failed", "inProgress"].includes(
          p.history_turn_status,
        )
      )
        group.status = p.history_turn_status;
      if (typeof p.history_work_started_at === "number") {
        group.startedAt = p.history_work_started_at;
        if (validMessageTime(p.history_work_started_at))
          group.turnStartedAtMs = p.history_work_started_at;
      }
      if (typeof p.history_work_completed_at === "number")
        group.completedAt = p.history_work_completed_at;
      if (
        p.item?.type !== "userMessage" &&
        typeof p.history_item_started_at_ms === "number"
      ) {
        const time = p.history_item_started_at_ms;
        group.startedAt =
          group.startedAt === undefined
            ? time
            : Math.min(group.startedAt, time);
        if (p.item?.phase === "final_answer") group.finalStartedAt = time;
      }
      if (typeof p.history_item_completed_at_ms === "number")
        group.completedAt = Math.max(
          group.completedAt || 0,
          p.history_item_completed_at_ms,
        );
    } else if (p.turnId && m !== "turn/started") turn(p.turnId);
    if (event.request_id != null) pending.set(String(event.request_id), event);
    if (m === "serverRequest/resolved") pending.delete(String(p.requestId));
    if (m === "user/message") {
      if (!p.history_turn_id && !active)
        turn(`user-${p.history_id || event.seq}`);
      // Imported event.created_at is an index timestamp, not the message time.
      const timestamp = historical
        ? p.history_item_started_at_ms
        : event.created_at;
      const createdAtMs = validMessageTime(timestamp) ? timestamp : undefined;
      const message: Message = {
        id: `user-${p.history_id || event.seq}`,
        role: "user",
        attachments: p.attachments || [],
        text:
          typeof p.display_text === "string"
            ? p.display_text
            : renderedUserText(typeof p.text === "string" ? p.text : ""),
        ...(createdAtMs === undefined ? {} : { createdAtMs }),
      };
      rawUserText.set(message, typeof p.text === "string" ? p.text : "");
      append(message);
    }
    if (m === "turn/started") {
      const id = p.turn?.id || p.turnId;
      if (id && current?.id.startsWith("user-") && !current.startedAt) {
        byTurn.delete(current.id);
        current.id = id;
        byTurn.set(id, current);
      }
      const group = turn(id);
      group.status = "inProgress";
      group.startedAt =
        typeof p.turn?.startedAt === "number"
          ? p.turn.startedAt * 1000
          : event.created_at;
      if (validMessageTime(group.startedAt))
        group.turnStartedAtMs = group.startedAt;
      active = true;
    }
    if (m === "turn/completed") {
      const group = turn(p.turn?.id || p.turnId);
      group.status = ["interrupted", "failed"].includes(p.turn?.status)
        ? p.turn.status
        : "completed";
      group.completedAt = event.created_at;
    }
    if (
      m === "turn/completed" ||
      m === "plugin/exited" ||
      m === "connection/interrupted" ||
      (m === "thread/status/changed" &&
        ["idle", "systemError", "notLoaded"].includes(p.status?.type))
    ) {
      active = false;
      pending.clear();
    }
    if (m === "item/started" || m === "item/completed") {
      const data = p.item;
      if (!data) continue;
      if (
        data.type === "userMessage" &&
        !historical &&
        typeof p.display_text === "string" &&
        typeof p.turnId === "string" &&
        current?.id === p.turnId &&
        Array.isArray(data.content)
      ) {
        // Native completion can supply richer display metadata for an existing
        // local echo. Bind only an unambiguous raw match in this exact turn.
        const first = data.content.find((part: any) => part?.type === "text");
        if (typeof first?.text === "string") {
          const key = `${p.turnId}\u0000${data.id}`;
          const matches = current.messages.filter(
            (message) =>
              message.role === "user" &&
              rawUserText.get(message) === first.text,
          );
          const echo =
            nativeUserEcho.get(key) ||
            (matches.length === 1 ? matches[0] : undefined);
          if (echo && rawUserText.get(echo) === first.text) {
            echo.text = p.display_text;
            nativeUserEcho.set(key, echo);
          }
        }
      }
      const role =
        data.type === "agentMessage"
          ? "assistant"
          : data.type === "reasoning"
            ? "reasoning"
            : data.type === "userMessage"
              ? null
              : "tool";
      if (role) {
        const msg = item(data.id, role);
        msg.item = {
          ...data,
          status:
            data.status ||
            (m === "item/completed" ? "completed" : "inProgress"),
        };
        if (data.type === "agentMessage" && data.text) msg.text = data.text;
        if (
          data.type === "agentMessage" &&
          data.phase === "final_answer" &&
          current &&
          !historical
        ) {
          if (m === "item/started" || !current.finalStartedAt)
            current.finalStartedAt = event.created_at;
        }
        if (data.type === "reasoning" && data.summary?.length)
          msg.text = data.summary
            .map((x: any) => (typeof x === "string" ? x : x.text || ""))
            .join("\n");
        if (data.type === "commandExecution" && data.aggregatedOutput)
          msg.text = data.aggregatedOutput;
      }
    }
    if (m === "item/agentMessage/delta")
      item(p.itemId, "assistant").text += p.delta || "";
    if (
      m === "item/reasoning/summaryTextDelta" ||
      m === "item/reasoning/textDelta"
    )
      item(p.itemId, "reasoning").text += p.delta || "";
    if (m === "item/commandExecution/outputDelta")
      item(p.itemId, "tool").text += p.delta || "";
    if (m === "turn/diff/updated") {
      item(`diff-${p.turnId}`, "tool").item = {
        type: "fileChange",
        changes: [{ path: "工作区变更", diff: p.diff }],
      };
    }
    if (m === "error" || m === "connection/interrupted")
      append({
        id: `error-${event.seq}`,
        role: "error",
        text: p.message || p.error?.message || JSON.stringify(p),
      });
    if (m === "turn/completed" && p.turn?.error)
      append({
        id: `error-${event.seq}`,
        role: "error",
        text: p.turn.error.message,
      });
  }
  return { messages, turns, pending: [...pending.values()], active };
}
