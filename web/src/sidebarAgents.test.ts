import { describe, expect, it } from "vitest";
import {
  agentName,
  readSidebarAgent,
  sidebarAgentOptions,
  sidebarAgentStorageKey,
  sidebarSessions,
} from "./sidebarAgents";
import type { Plugin, Session } from "./types";
const s = (
  id: string,
  agent: string,
  cwd: string,
  updated_at: number,
  extra = {},
): Session => ({
  id,
  agent,
  cwd,
  updated_at,
  created_at: 0,
  thread_id: id,
  title: id,
  model: null,
  policy: "manual",
  status: "idle",
  archived: false,
  ...extra,
});
const sessions = [
  s("hidden-newest", "codex", "/a", 100),
  s("match older", "deepseek-harness", "/a", 1),
  s("match middle", "deepseek-harness", "/b", 50),
  s("irrelevant newer", "deepseek-harness", "/a", 90),
  s("archive", "deepseek-harness", "/a", 120, { archived: true }),
  s("third party", "custom-agent", "/c", 60),
];
const filter = { agent: "", archived: false, search: "" };
describe("sidebar Agent projection", () => {
  it("filters actual ids without mutating shared data or its order", () => {
    const before = structuredClone(sessions);
    expect(
      sidebarSessions(sessions, {
        ...filter,
        agent: "deepseek-harness",
        search: "match ",
      }).map((s) => s.id),
    ).toEqual(["match middle", "match older"]);
    expect(sessions).toEqual(before);
    expect(
      sidebarSessions(sessions, { ...filter, agent: "custom-agent" }).map(
        (s) => s.id,
      ),
    ).toEqual(["third party"]);
    expect(
      sidebarSessions(sessions, { ...filter, agent: "unavailable" }),
    ).toEqual([]);
  });
  it("intersects archive, directory and search before latest-directory ordering", () => {
    const visible = sidebarSessions(sessions, {
      ...filter,
      agent: "deepseek-harness",
      search: "match ",
    });
    expect([...new Set(visible.map((s) => s.cwd))]).toEqual(["/b", "/a"]);
    expect(
      sidebarSessions(sessions, {
        ...filter,
        agent: "deepseek-harness",
        project: "/a",
        archived: true,
      }).map((s) => s.id),
    ).toEqual(["archive"]);
    expect(
      sidebarSessions(sessions, {
        ...filter,
        project: "/b",
        search: "missing",
      }),
    ).toEqual([]);
    expect(
      sidebarSessions(sessions, { ...filter, search: "/a" }).map((s) => s.id),
    ).toEqual(["hidden-newest", "irrelevant newer", "match older"]);
  });
  it("combines plugins, historical ids and a stale selection with stable branding", () => {
    const plugins = [
      { id: "codex", name: "Codex custom name" },
      { id: "configured", name: "Configured Agent" },
    ] as Plugin[];
    const options = sidebarAgentOptions(plugins, sessions, "stale-plugin");
    expect(options.slice(0, 2).map((x) => x.name)).toEqual([
      "Codex",
      "DeepSeek Harness",
    ]);
    expect(options).toContainEqual({
      id: "configured",
      name: "Configured Agent",
      present: true,
    });
    expect(options).toContainEqual({
      id: "stale-plugin",
      name: "stale-plugin",
      present: false,
    });
    expect(agentName("unknown-agent")).toBe("unknown-agent");
    expect(sidebarAgentOptions([], [], "")).toEqual([
      { id: "codex", name: "Codex", present: false },
      { id: "deepseek-harness", name: "DeepSeek Harness", present: false },
      { id: "workbuddy", name: "WorkBuddy", present: false },
      { id: "claude-code", name: "Claude Code", present: false },
      { id: "claude-desktop", name: "Claude Desktop Code", present: false },
    ]);
  });
  it("scopes persistence to each server and preserves missing plugin selections", () => {
    const data = new Map([
      [sidebarAgentStorageKey("https://one.example"), "unavailable"],
    ]);
    const storage = { getItem: (key: string) => data.get(key) ?? null };
    expect(readSidebarAgent("https://one.example", storage)).toBe(
      "unavailable",
    );
    expect(readSidebarAgent("https://two.example", storage)).toBe("");
    expect(
      readSidebarAgent("https://one.example", {
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("");
  });
  it("keeps WorkBuddy identity available without registering an execution backend", () => {
    expect(
      agentName("workbuddy", [
        { id: "workbuddy", name: "Other name" },
      ] as Plugin[]),
    ).toBe("WorkBuddy");
    const history = [
      s("native buddy", "workbuddy", "/work/buddy", 100),
      ...sessions,
    ];
    expect(
      sidebarAgentOptions([], [], "").find(
        (option) => option.id === "workbuddy",
      ),
    ).toEqual({ id: "workbuddy", name: "WorkBuddy", present: false });
    expect(
      sidebarAgentOptions([], history, "").find(
        (option) => option.id === "workbuddy",
      )?.present,
    ).toBe(true);
    expect(
      sidebarSessions(history, { ...filter, agent: "workbuddy" }).map(
        (session) => session.id,
      ),
    ).toEqual(["native buddy"]);
    expect(sessions.some((session) => session.agent === "workbuddy")).toBe(
      false,
    );
  });
  it("keeps CLI and desktop Claude identities separate, including history-only and unavailable entries", () => {
    const plugins = [
      { id: "claude-code", name: "Wrong CLI label", available: true },
      { id: "claude-desktop", name: "Wrong desktop label", available: false },
      { id: "future-agent", name: "Future Agent", available: true },
    ] as Plugin[];
    const history = [
      s("cli", "claude-code", "/a", 1),
      s("desktop", "claude-desktop", "/b", 2),
    ];
    expect(agentName("claude-code", plugins)).toBe("Claude Code");
    expect(agentName("claude-desktop", plugins)).toBe("Claude Desktop Code");
    expect(
      sidebarSessions(history, { ...filter, agent: "claude-code" }).map(
        (s) => s.id,
      ),
    ).toEqual(["cli"]);
    expect(
      sidebarSessions(history, { ...filter, agent: "claude-desktop" }).map(
        (s) => s.id,
      ),
    ).toEqual(["desktop"]);
    expect(sidebarAgentOptions(plugins, history, "")).toContainEqual({
      id: "future-agent",
      name: "Future Agent",
      present: true,
    });
    expect(sidebarAgentOptions([], history, "")).toContainEqual({
      id: "claude-desktop",
      name: "Claude Desktop Code",
      present: true,
    });
    expect(agentName("constructor")).toBe("constructor");
  });
});
