import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  projectSubagents,
  subagentAvatarIndex,
  subagentElapsed,
  subagentPreview,
  subagentRelative,
} from "./subagents";
import SubagentsPanel from "./components/SubagentsPanel";
import avatars from "./subagentAvatars.json";
import type { AgentEvent, Session } from "./types";

const event = (item: Record<string, any>, created_at = 1000): AgentEvent => ({
  seq: created_at,
  session_id: "parent",
  method: "item/completed",
  params: { item },
  created_at,
});
const collab = (
  tool: string,
  id: string,
  state?: string,
  extra: Record<string, any> = {},
) => ({
  type: "collabAgentToolCall",
  tool,
  status: "completed",
  receiverThreadIds: [id],
  agentsStates: state ? { [id]: { status: state } } : {},
  ...extra,
});
const session = (
  thread_id: string,
  status: string,
  updated_at = 3000,
): Session => ({
  id: `session-${thread_id}`,
  thread_id,
  title: `Title ${thread_id}`,
  cwd: "/repo",
  agent: "codex",
  model: "gpt-5.4",
  policy: "auto",
  status,
  archived: false,
  created_at: 1000,
  updated_at,
});

describe("subagent membership and lifecycle", () => {
  it("keeps a child working after spawn tool and parent turn finish", () => {
    const input = [
      event(
        collab("spawnAgent", "child", "running", {
          prompt: "Investigate layout",
          model: "gpt-5.4",
        }),
      ),
      {
        ...event({}, 2000),
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      },
    ];
    expect(projectSubagents(input, [])[0]).toMatchObject({
      threadId: "child",
      status: "active",
      sessionId: null,
      objective: "Investigate layout",
      model: "gpt-5.4",
      canInteract: true,
    });
  });
  it("folds wait updates into the same entry and sorts newest first", () => {
    const agents = projectSubagents(
      [
        event(collab("spawnAgent", "first", "running")),
        event(collab("spawnAgent", "second", "pendingInit"), 2000),
        event(
          collab("wait", "first", "completed", {
            agentsStates: {
              first: { status: "completed", message: "finished" },
            },
          }),
          3000,
        ),
      ],
      [],
    );
    expect(agents.map((agent) => [agent.threadId, agent.status])).toEqual([
      ["first", "done"],
      ["second", "waiting"],
    ]);
    expect(agents[0].preview).toBe("finished");
  });
  it("uses a discovered child's actual runtime and permits navigation only to its real session", () => {
    const agents = projectSubagents(
      [
        event(collab("wait", "child", "completed")),
        event(collab("spawnAgent", "missing", "running")),
      ],
      [session("child", "running"), session("unrelated", "running")],
    );
    expect(agents).toHaveLength(2);
    expect(agents.find((agent) => agent.threadId === "child")).toMatchObject({
      status: "active",
      sessionId: "session-child",
      name: "Title child",
    });
    expect(
      agents.find((agent) => agent.threadId === "missing")?.sessionId,
    ).toBeNull();
  });
  it("hides closed and interrupted agents but lets confirmed live child status win", () => {
    expect(
      projectSubagents(
        [
          event(collab("spawnAgent", "child", "running")),
          event(collab("closeAgent", "child", "shutdown")),
        ],
        [],
      ),
    ).toEqual([]);
    expect(
      projectSubagents(
        [event(collab("wait", "child", "interrupted"))],
        [session("child", "running")],
      )[0].status,
    ).toBe("active");
  });
  it("does not manufacture child membership from read or send calls to unrelated chats", () => {
    const calls = ["read_thread", "send_message_to_thread"].map((tool) =>
      event({
        type: "dynamicToolCall",
        tool,
        arguments: { threadId: "unrelated" },
        contentItems: [{ type: "inputText", text: '{"status":"completed"}' }],
      }),
    );
    expect(projectSubagents(calls, [session("unrelated", "idle")])).toEqual([]);
  });
  it("recognizes an explicit spawn_agent result then applies later status updates", () => {
    const agents = projectSubagents(
      [
        event({
          type: "dynamicToolCall",
          tool: "spawn_agent",
          arguments: { title: "Check typography", prompt: "**Compare** sizes" },
          contentItems: [{ type: "inputText", text: '{"threadId":"child"}' }],
        }),
        event(
          {
            type: "dynamicToolCall",
            tool: "read_thread",
            arguments: { threadId: "child" },
            result: { status: "completed" },
          },
          2000,
        ),
      ],
      [],
    );
    expect(agents[0]).toMatchObject({
      name: "Check typography",
      preview: "Compare sizes",
      status: "done",
    });
  });
  it("keeps create_thread chats separate from Subagents even when their session is discovered", () => {
    const created = event({
      type: "dynamicToolCall",
      tool: "create_thread",
      arguments: { title: "A separate chat" },
      contentItems: [
        { type: "inputText", text: '{"threadId":"child","status":"running"}' },
      ],
    });
    expect(projectSubagents([created], [session("child", "running")])).toEqual(
      [],
    );
  });
  it("uses explicit history times, never the history import timestamp", () => {
    const imported = event(collab("spawnAgent", "child", "running"), 99999999);
    imported.params.history_turn_id = "turn";
    expect(projectSubagents([imported], [])[0].startedAtMs).toBeNull();
    imported.params.history_item_started_at_ms = 12345;
    expect(projectSubagents([imported], [])[0].startedAtMs).toBe(12345);
  });
  it("reads subAgentActivity name/status and ignores interaction-only unknown chats", () => {
    expect(
      projectSubagents(
        [
          event({
            type: "subAgentActivity",
            kind: "interacted",
            agentThreadId: "unknown",
          }),
        ],
        [],
      ),
    ).toEqual([]);
    expect(
      projectSubagents(
        [
          event({
            type: "subAgentActivity",
            kind: "started",
            agentThreadId: "c",
            agentPath: "/root/layout",
          }),
          event(
            { type: "subAgentActivity", kind: "completed", agentThreadId: "c" },
            2000,
          ),
        ],
        [],
      )[0],
    ).toMatchObject({ name: "layout", status: "done" });
  });
  it("bounds malformed payloads and isolates the selected parent", () => {
    const malformed = event({
      type: "dynamicToolCall",
      tool: "create_thread",
      arguments: "broken",
      contentItems: "broken",
    });
    expect(
      projectSubagents(
        [
          malformed,
          {
            ...event(collab("spawnAgent", "other", "running")),
            session_id: "elsewhere",
          },
        ],
        [],
        "parent",
      ),
    ).toEqual([]);
  });
});

describe("subagent list presentation", () => {
  it("renders the evidence-derived section counts and limits without raw payloads", () => {
    const agents = projectSubagents(
      Array.from({ length: 17 }, (_, i) =>
        event(
          collab("spawnAgent", `child-${i}`, i < 6 ? "running" : "completed"),
          i + 1000,
        ),
      ),
      [],
    );
    const html = renderToStaticMarkup(
      createElement(SubagentsPanel, { agents, onOpenAgent: () => {} }),
    );
    expect(html).toContain("Active");
    expect(html).toContain("Done");
    expect(html.match(/class="subagent-row"/g) ?? []).toHaveLength(14);
    expect(html).toContain("显示其余 2 个");
    expect(html).toContain("显示其余 1 个");
    expect(html).not.toContain("agentsStates");
    expect(html).not.toContain("subagent-open");
  });
  it("keeps loading separate from an empty active list", () => {
    const html = renderToStaticMarkup(
      createElement(SubagentsPanel, { agents: [], loading: true }),
    );
    expect(html).toContain("正在加载子 Agent");
    expect(html).not.toContain("没有正在运行");
  });
  it("includes every seeded light/dark avatar with passive SVG content", () => {
    expect(avatars).toHaveLength(28);
    for (const pair of avatars)
      for (const uri of [pair.light, pair.dark]) {
        expect(uri).toMatch(/^data:image\/svg\+xml,/);
        const svg = decodeURIComponent(uri.slice(uri.indexOf(",") + 1));
        expect(svg).toContain("<svg");
        expect(svg).not.toMatch(
          /<script|<foreignObject|\bon\w+\s*=|(?:href|src)=["']https?:/i,
        );
      }
  });
  it("uses stable avatar hashing and readable duration/relative timestamps", () => {
    expect(subagentAvatarIndex("abc")).toBe(6);
    expect(subagentAvatarIndex("子 Agent")).toBe(
      subagentAvatarIndex("子 Agent"),
    );
    expect(subagentElapsed(1000, 184000)).toBe("3m 3s");
    expect(subagentElapsed(1000, 100)).toBe("0s");
    expect(subagentRelative(1000, 121000)).toBe("2 分钟前");
    expect(
      subagentPreview("# **一个** [测试](https://example.com)\n目标"),
    ).toBe("一个 测试 目标");
    expect(Array.from(subagentPreview("😀".repeat(70))!)).toHaveLength(60);
  });
});
