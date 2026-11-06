import type { ConversationTurn, Message } from "./types";

/** Describe only the current live turn; old unfinished history is not activity. */
export function workingActivity(turns: ConversationTurn[]): string {
  const current = turns.at(-1);
  if (current?.status !== "inProgress") return "正在处理你的请求…";
  const active = current.messages.filter(
    (message) =>
      message.item &&
      ["inProgress", "in_progress", "running", "started"].includes(
        message.item.status,
      ),
  );
  const tools = active.filter((message) => message.role === "tool");
  if (tools.length) {
    const label = toolPresentation(tools.at(-1)!.item).label;
    return tools.length > 1
      ? `${label}（另有 ${tools.length - 1} 项进行中）`
      : label;
  }
  const latest = active.at(-1) ?? current.messages.at(-1);
  if (latest?.role === "assistant" && latest.item?.status !== "completed")
    return "正在生成回复…";
  if (latest?.role === "reasoning") return "正在思考…";
  return "正在处理你的请求…";
}

export type ToolPresentation = {
  label: string;
  kind: "command" | "read" | "list" | "search" | "files" | "image" | "tool";
  running: boolean;
};

/** Labels come from the item's declared action/lifecycle, never from shell guesses. */
export function toolPresentation(
  item: Record<string, any> = {},
): ToolPresentation {
  const running = ["inProgress", "in_progress", "running", "started"].includes(
    item.status,
  );
  const failed = failedItem(item);
  const done = item.status === "completed" || item.status === "success";
  if (item.type === "collabAgentToolCall") {
    const count = agentActivityTargets(item).length;
    return {
      label: `${agentActionLabel(item)} ${count > 1 ? `${count} 个 Agent` : "Agent"}`,
      kind: "tool",
      running,
    };
  }
  if (item.type === "subAgentActivity") {
    const name =
      text(item.displayName) || agentPathName(item.agentPath) || "Agent";
    return {
      label:
        item.kind === "interacted"
          ? `已发送消息给 ${name}`
          : `${name} ${item.kind === "completed" ? "已完成" : item.kind === "interrupted" ? "已中断" : "正在工作"}`,
      kind: "tool",
      running: item.kind === "started",
    };
  }
  if (item.type === "commandExecution") {
    if (failed)
      return { label: "命令运行失败", kind: "command", running: false };
    const actions: Record<string, any>[] = Array.isArray(item.commandActions)
      ? item.commandActions
      : [];
    const kinds = new Set(actions.map((a) => a.type));
    if (kinds.size === 1 && kinds.has("read")) {
      const name =
        actions.length === 1
          ? actions[0].name || actions[0].path?.split("/").pop()
          : `${actions.length} 个文件`;
      return {
        label: `${running ? "正在读取" : done ? "已读取" : "读取"} ${name || "文件"}`,
        kind: "read",
        running,
      };
    }
    if (kinds.size === 1 && kinds.has("listFiles"))
      return {
        label: `${running ? "正在列出" : done ? "已列出" : "列出"}${actions[0]?.path ? ` ${actions[0].path.split("/").pop()} 中的` : ""}文件`,
        kind: "list",
        running,
      };
    if (kinds.size === 1 && kinds.has("search"))
      return {
        label: running ? "正在搜索文件" : done ? "已搜索文件" : "搜索文件",
        kind: "search",
        running,
      };
    return {
      label: running ? "正在运行命令" : done ? "已运行命令" : "运行命令",
      kind: "command",
      running,
    };
  }
  if (item.type === "fileChange")
    return {
      label: `${running ? "正在更改" : done ? "已更改" : "更改"} ${item.changes?.length || 1} 个文件`,
      kind: "files",
      running,
    };
  if (item.type === "imageView" || item.type === "localImage")
    return {
      label: running ? "正在查看图像" : "已查看 1 张图像",
      kind: "image",
      running,
    };
  if (item.type === "webSearch")
    return {
      label: running ? "正在搜索网页" : "已搜索网页",
      kind: "search",
      running,
    };
  if (["mcpToolCall", "dynamicToolCall"].includes(item.type)) {
    const invocation = toolInvocation(item);
    const display = item.toolDisplay ?? item.display ?? {};
    const meta = item.toolDefinition?._meta ?? item._meta ?? {};
    const explicit = running
      ? (display.invoking ?? meta["openai/toolInvocation/invoking"])
      : done && !failed
        ? (display.invoked ?? meta["openai/toolInvocation/invoked"])
        : undefined;
    const title = text(explicit) || text(display.title) || text(item.title);
    const name =
      title || invocation.tool.replace(/[._-]+/g, " ").trim() || "工具";
    return {
      label:
        title && !failed
          ? title
          : `${running ? "正在调用" : failed ? "调用失败：" : done ? "已调用" : "调用"} ${name}`,
      kind: "tool",
      running,
    };
  }
  const name = item.tool || item.title || "工具";
  return {
    label: `${running ? "正在调用" : failed ? "调用失败：" : done ? "已调用" : "调用"} ${name}`,
    kind: "tool",
    running,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** App-server items and native UI projections use different invocation envelopes. */
export function toolInvocation(item: Record<string, any> = {}) {
  return {
    provider:
      text(item.appContext?.appName) ||
      text(item.pluginDisplayName) ||
      text(item.invocation?.server) ||
      text(item.server) ||
      text(item.namespace),
    tool:
      text(item.invocation?.tool) || text(item.tool) || text(item.functionName),
    arguments: item.invocation?.arguments ?? item.arguments,
  };
}

function failedItem(item: Record<string, any>) {
  return (
    ["failed", "error", "declined", "interrupted"].includes(item.status) ||
    item.success === false ||
    item.error != null ||
    (typeof item.exitCode === "number" && item.exitCode !== 0) ||
    item.result?.type === "error" ||
    item.result?.isError === true ||
    item.result?.raw?.isError === true
  );
}

/** Only completed successful calls coalesce. Failures and live calls remain visible. */
export function groupToolActivities(messages: Message[]) {
  const groups: {
    kind: "images" | "tools" | "message";
    messages: Message[];
  }[] = [];
  for (const message of messages) {
    const item = message.item ?? {};
    const tools =
      message.role === "tool" &&
      [
        "commandExecution",
        "mcpToolCall",
        "dynamicToolCall",
        "webSearch",
      ].includes(item.type) &&
      ["completed", "success"].includes(item.status) &&
      !failedItem(item);
    const kind =
      item.type === "imageView" && item.path
        ? "images"
        : tools
          ? "tools"
          : "message";
    const last = groups.at(-1);
    if (kind !== "message" && last?.kind === kind) last.messages.push(message);
    else groups.push({ kind, messages: [message] });
  }
  return groups;
}

/** Summary segments retain first-seen action order, without leaking raw argument text. */
export function activitySummary(messages: Message[]) {
  const segments = new Map<string, string>();
  const providers = new Set<string>();
  for (const message of messages) {
    const item = message.item ?? {};
    const kind = toolPresentation(item).kind;
    if (["mcpToolCall", "dynamicToolCall"].includes(item.type)) {
      const provider = toolInvocation(item).provider;
      if (provider && !["functions", "codex_app"].includes(provider)) {
        providers.add(provider);
        segments.set("providers", "");
      } else segments.set("tools", "调用了工具");
    } else if (item.type === "webSearch") segments.set("web", "搜索了网页");
    else if (["read", "list", "search"].includes(kind))
      segments.set("read", "读取了文件");
    else segments.set("command", "运行了命令");
  }
  if (providers.size)
    segments.set("providers", `使用了 ${[...providers].join("、")} 集成`);
  return [...segments.values()].filter(Boolean).join("，");
}

export type AgentActivityTarget = {
  threadId: string;
  name: string;
  role?: string;
  state?: string;
  message?: string;
};

export function agentActivityTargets(
  item: Record<string, any>,
): AgentActivityTarget[] {
  const threads: any[] = Array.isArray(item.receiverThreads)
    ? item.receiverThreads
    : [];
  const ids = new Set<string>(
    [
      ...threads.map((entry) => text(entry.threadId)),
      ...(Array.isArray(item.receiverThreadIds)
        ? item.receiverThreadIds.filter((id: unknown) => typeof id === "string")
        : []),
      ...Object.keys(item.agentsStates ?? {}),
    ].filter(Boolean),
  );
  return [...ids].map((threadId) => {
    const thread = threads.find((entry) => entry.threadId === threadId)?.thread;
    const state = item.agentsStates?.[threadId];
    return {
      threadId,
      name:
        text(thread?.name) ||
        text(thread?.title) ||
        text(thread?.agentNickname) ||
        text(item.agentNames?.[threadId]) ||
        "Agent",
      role: text(thread?.agentRole),
      state: typeof state === "string" ? state : text(state?.status),
      message: text(state?.message),
    };
  });
}

/** Native A0n: final path component, excluding root, sentence case and separators. */
export function agentPathName(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const component = path
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "root")
    .at(-1);
  if (!component) return null;
  const name = component
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return name ? name[0].toUpperCase() + name.slice(1) : null;
}

export function agentActionLabel(item: Record<string, any>) {
  const running = ["inProgress", "running", "started"].includes(item.status);
  if (item.status === "interrupted") return "已中断";
  const verbs: Record<string, [string, string, string]> = {
    spawnAgent: ["正在创建", "已创建", "创建失败"],
    sendInput: ["正在发送消息给", "已发送消息给", "发送消息失败"],
    sendMessage: ["正在发送消息给", "已发送消息给", "发送消息失败"],
    followupTask: ["正在发送消息给", "已发送消息给", "发送消息失败"],
    resumeAgent: ["正在恢复", "已恢复", "恢复失败"],
    closeAgent: ["正在关闭", "已关闭", "关闭失败"],
    interruptAgent: ["正在中断", "已中断", "中断失败"],
    listAgents: ["正在列出", "已列出", "列出失败"],
    wait: ["正在等待", "已等待", "等待失败"],
  };
  const action = verbs[item.tool ?? item.action] ?? [
    "正在调用",
    "已调用",
    "调用失败",
  ];
  return action[failedItem(item) ? 2 : running ? 0 : 1];
}

export function toolResultPresentation(item: Record<string, any>, output = "") {
  const result = item.result;
  const payload = result?.raw ?? result;
  const content =
    result?.content ?? payload?.content ?? item.contentItems ?? item.content;
  const blocks: Record<string, any>[] = Array.isArray(content)
    ? content.filter((block) => block && typeof block === "object")
    : [];
  const error =
    text(item.error?.message) ||
    text(item.error) ||
    text(result?.error?.message) ||
    text(result?.error);
  let structured = result?.structuredContent ?? payload?.structuredContent;
  // The packaged Ta recognises one unannotated JSON text block and avoids duplicates.
  if (
    blocks.length === 1 &&
    blocks[0].type === "text" &&
    !blocks[0].annotations &&
    typeof blocks[0].text === "string"
  ) {
    const candidate = blocks[0].text.trim();
    if (/^[{[]/.test(candidate))
      try {
        const parsed = JSON.parse(candidate);
        const same =
          structured == null ||
          JSON.stringify(parsed) === JSON.stringify(structured);
        if (same)
          return {
            blocks: [],
            structured: structured ?? parsed,
            error,
            output: "",
          };
      } catch {
        /* Non-JSON text remains plain output. */
      }
  }
  return {
    blocks,
    structured,
    error,
    output: output || text(item.aggregatedOutput) || text(item.output),
  };
}
