import { describe, expect, it } from "vitest";
import {
  activitySummary,
  agentActionLabel,
  agentActivityTargets,
  agentPathName,
  groupToolActivities,
  toolResultPresentation,
  toolPresentation,
  workingActivity,
} from "./toolPresentation";
import { projectEvents } from "./events";
import type { AgentEvent, ConversationTurn, Message } from "./types";

describe("current activity", () => {
  const turn = (
    messages: Message[],
    status: ConversationTurn["status"] = "inProgress",
  ): ConversationTurn => ({ id: "current", status, messages });
  const message = (
    id: string,
    role: Message["role"],
    type: string,
    extra = {},
  ): Message => ({
    id,
    role,
    text: "",
    item: { type, status: "inProgress", ...extra },
  });
  it("does not reuse unfinished items from completed or older turns", () => {
    const old = turn([message("tool", "tool", "commandExecution")]);
    expect(workingActivity([{ ...old, status: "completed" }])).toBe(
      "正在处理你的请求…",
    );
    expect(workingActivity([old, turn([])])).toBe("正在处理你的请求…");
  });
  it("distinguishes reasoning, response, declared reads and concurrent tools", () => {
    expect(
      workingActivity([turn([message("r", "reasoning", "reasoning")])]),
    ).toBe("正在思考…");
    expect(
      workingActivity([turn([message("a", "assistant", "agentMessage")])]),
    ).toBe("正在生成回复…");
    const read = message("read", "tool", "commandExecution", {
      commandActions: [{ type: "read", name: "README.md" }],
    });
    expect(workingActivity([turn([read])])).toBe("正在读取 README.md");
    expect(
      workingActivity([turn([read, message("search", "tool", "webSearch")])]),
    ).toBe("正在搜索网页（另有 1 项进行中）");
    expect(
      workingActivity([
        turn([{ ...read, item: { ...read.item, status: "completed" } }]),
      ]),
    ).toBe("正在处理你的请求…");
  });
});

describe("tool summaries", () => {
  it("uses declared actions and does not guess reads from shell text", () => {
    expect(
      toolPresentation({
        type: "commandExecution",
        status: "completed",
        command: "cat README.md",
      }).kind,
    ).toBe("command");
    expect(
      toolPresentation({
        type: "commandExecution",
        status: "completed",
        commandActions: [{ type: "read", path: "/project/README.md" }],
      }).label,
    ).toBe("已读取 README.md");
    expect(
      toolPresentation({
        type: "commandExecution",
        status: "inProgress",
        commandActions: [{ type: "listFiles", path: "/project/src" }],
      }),
    ).toEqual({ label: "正在列出 src 中的文件", kind: "list", running: true });
  });
  it("shows failure instead of a successful read when a command fails", () => {
    expect(
      toolPresentation({
        type: "commandExecution",
        status: "completed",
        exitCode: 1,
        commandActions: [{ type: "read", name: "missing" }],
      }),
    ).toEqual({ label: "命令运行失败", kind: "command", running: false });
  });
  it("uses lifecycle events when status is absent and preserves explicit failures", () => {
    const event = (
      method: string,
      seq: number,
      status?: string,
    ): AgentEvent => ({
      method,
      seq,
      session_id: "s",
      created_at: 0,
      params: {
        item: {
          id: "tool",
          type: "commandExecution",
          ...(status ? { status } : {}),
        },
      },
    });
    expect(
      projectEvents([event("item/started", 1)]).messages[0].item?.status,
    ).toBe("inProgress");
    const finished = projectEvents([
      event("item/started", 1),
      event("item/completed", 2),
    ]);
    expect(finished.messages).toHaveLength(1);
    expect(toolPresentation(finished.messages[0].item).running).toBe(false);
    expect(finished.messages[0].item?.status).toBe("completed");
    expect(
      projectEvents([event("item/completed", 1, "failed")]).messages[0].item
        ?.status,
    ).toBe("failed");
  });
});

describe("native activity reconstruction", () => {
  const tool = (
    id: string,
    type: string,
    extra: Record<string, any> = {},
  ): Message => ({
    id,
    role: "tool",
    text: "",
    item: { type, status: "completed", ...extra },
  });
  it("coalesces adjacent integrations and commands without crossing prose, errors or live calls", () => {
    const items = [
      tool("mcp", "mcpToolCall", { server: "Notes", tool: "read_page" }),
      tool("read", "commandExecution", {
        commandActions: [{ type: "read", name: "a.md" }],
      }),
      {
        id: "prose",
        role: "assistant",
        text: "Checking the result",
      } as Message,
      tool("failed", "mcpToolCall", { error: { message: "Rejected" } }),
      tool("live", "commandExecution", { status: "inProgress" }),
      tool("finished", "commandExecution"),
    ];
    const groups = groupToolActivities(items);
    expect(
      groups.map((group) => [
        group.kind,
        group.messages.map((item) => item.id),
      ]),
    ).toEqual([
      ["tools", ["mcp", "read"]],
      ["message", ["prose"]],
      ["message", ["failed"]],
      ["message", ["live"]],
      ["tools", ["finished"]],
    ]);
    expect(activitySummary(items.slice(0, 2))).toBe(
      "使用了 Notes 集成，读取了文件",
    );
  });
  it("keeps provider first-seen order, deduplicates providers and never includes arguments", () => {
    expect(
      activitySummary([
        tool("a", "mcpToolCall", {
          server: "Notes",
          arguments: { secret: "must stay hidden" },
        }),
        tool("b", "mcpToolCall", {
          invocation: { server: "Notes", tool: "edit_page" },
        }),
        tool("c", "mcpToolCall", { server: "Computer Use" }),
        tool("d", "commandExecution"),
      ]),
    ).toBe("使用了 Notes、Computer Use 集成，运行了命令");
  });
  it("prefers declared lifecycle labels and does not present failed calls as successful", () => {
    expect(
      toolPresentation({
        type: "mcpToolCall",
        status: "inProgress",
        tool: "read_page",
        toolDisplay: { invoking: "正在读取笔记", invoked: "已读取笔记" },
      }).label,
    ).toBe("正在读取笔记");
    expect(
      toolPresentation({
        type: "mcpToolCall",
        status: "completed",
        tool: "read_page",
        toolDisplay: { invoked: "已读取笔记" },
      }).label,
    ).toBe("已读取笔记");
    expect(
      toolPresentation({
        type: "mcpToolCall",
        status: "failed",
        tool: "read_page",
        toolDisplay: { invoked: "已读取笔记" },
      }).label,
    ).toContain("调用失败");
  });
  it("derives readable path names and keeps same-named agents separate by thread", () => {
    expect(agentPathName(" /root/native_ui-research ")).toBe(
      "Native ui research",
    );
    expect(agentPathName("root")).toBeNull();
    expect(
      agentActivityTargets({
        receiverThreads: [
          {
            threadId: "a",
            thread: { title: "Develop app", agentRole: "worker" },
          },
        ],
        receiverThreadIds: ["a", "b"],
        agentsStates: {
          a: { status: "completed", message: "Verified" },
          b: { status: "running" },
        },
      }),
    ).toEqual([
      {
        threadId: "a",
        name: "Develop app",
        role: "worker",
        state: "completed",
        message: "Verified",
      },
      { threadId: "b", name: "Agent", role: "", state: "running", message: "" },
    ]);
    expect(agentActionLabel({ tool: "spawnAgent", status: "inProgress" })).toBe(
      "正在创建",
    );
    expect(agentActionLabel({ tool: "sendMessage", status: "failed" })).toBe(
      "发送消息失败",
    );
  });
});

describe("expanded tool results", () => {
  it("renders MCP structured content once instead of repeating its JSON text block", () => {
    const result = toolResultPresentation({
      result: {
        type: "success",
        raw: {
          content: [{ type: "text", text: '{"ok":true}' }],
          structuredContent: { ok: true },
        },
      },
    });
    expect(result.blocks).toEqual([]);
    expect(result.structured).toEqual({ ok: true });
    expect(result.error).toBe("");
  });
  it("preserves distinct annotated text and structured values, errors and command output", () => {
    const content = [
      {
        type: "text",
        text: "{ invalid JSON",
        annotations: { audience: ["user"] },
      },
    ];
    expect(
      toolResultPresentation({
        result: { content, structuredContent: { ok: false } },
      }).blocks,
    ).toEqual(content);
    expect(
      toolResultPresentation({
        result: { type: "error", error: { message: "Access denied" } },
      }).error,
    ).toBe("Access denied");
    expect(
      toolResultPresentation({ aggregatedOutput: "fallback" }, "live output")
        .output,
    ).toBe("live output");
    expect(
      toolPresentation({
        type: "mcpToolCall",
        status: "completed",
        tool: "read",
        result: { isError: true },
      }).label,
    ).toContain("调用失败");
  });
});
