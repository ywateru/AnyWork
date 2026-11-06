import type { Plugin, Session } from "./types";

export const agentName = (id: string, plugins: Plugin[] = []) =>
  id === "codex"
    ? "Codex"
    : id === "deepseek-harness"
      ? "DeepSeek Harness"
      : id === "workbuddy"
        ? "WorkBuddy"
        : plugins.find((plugin) => plugin.id === id)?.name || id;

export function sidebarAgentOptions(
  plugins: Plugin[],
  sessions: Session[],
  selected: string,
) {
  const present = new Set([
    ...plugins.map((plugin) => plugin.id),
    ...sessions.map((session) => session.agent),
  ]);
  const ids = new Set(["codex", "deepseek-harness", "workbuddy", ...present]);
  if (selected) ids.add(selected);
  const rank = (id: string) =>
    id === "codex"
      ? 0
      : id === "deepseek-harness"
        ? 1
        : id === "workbuddy"
          ? 2
          : 3;
  return [...ids]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((id) => ({
      id,
      name: agentName(id, plugins),
      present: present.has(id),
    }));
}

/** A presentation projection only; never mutate the shared session collection. */
export function sidebarSessions(
  sessions: Session[],
  filters: {
    agent: string;
    archived: boolean;
    project?: string;
    search: string;
  },
) {
  const term = filters.search.trim().toLowerCase();
  return sessions
    .filter(
      (session) =>
        (!filters.agent || session.agent === filters.agent) &&
        session.archived === filters.archived &&
        (!filters.project || session.cwd === filters.project) &&
        (!term ||
          `${session.title} ${session.cwd}`.toLowerCase().includes(term)),
    )
    .sort((a, b) => b.updated_at - a.updated_at || a.id.localeCompare(b.id));
}

export const sidebarAgentStorageKey = (server: string) =>
  `anywork.sidebar-agent.${JSON.stringify(server)}`;

export function readSidebarAgent(
  server: string,
  storage: Pick<Storage, "getItem">,
) {
  try {
    return storage.getItem(sidebarAgentStorageKey(server)) || "";
  } catch {
    // A blocked browser storage still permits an in-memory presentation filter.
    return "";
  }
}
