import { useCallback, useEffect, useState } from "react";
import type { FileTarget } from "../fileLinks";

export type PanelKind = "files" | "git" | "goal" | "terminal" | "subagents";
export type ConversationPanel = {
  id: string;
  kind: PanelKind;
  target?: FileTarget;
  sourceSessionId?: string;
};
type Panels = { tabs: ConversationPanel[]; active: string };
const empty: Panels = { tabs: [], active: "chat" };
const storageKey = "anywork.conversation-panels-v1";

function read(): Record<string, Panels> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const panel = value as Panels;
        if (!panel || !Array.isArray(panel.tabs)) return [];
        const seen = new Set<string>();
        const tabs = panel.tabs.filter((tab) => {
          if (
            !tab ||
            typeof tab.id !== "string" ||
            seen.has(tab.id) ||
            !["files", "git", "goal", "terminal", "subagents"].includes(
              tab.kind,
            )
          )
            return false;
          if (
            tab.target &&
            (tab.kind !== "files" || typeof tab.target.path !== "string")
          )
            return false;
          if (
            tab.sourceSessionId != null &&
            (tab.kind !== "files" || typeof tab.sourceSessionId !== "string")
          )
            return false;
          if (tab.id !== (tab.target ? `file:${tab.target.path}` : tab.kind))
            return false;
          seen.add(tab.id);
          return true;
        });
        return [
          [
            key,
            {
              tabs,
              active: tabs.some((tab) => tab.id === panel.active)
                ? panel.active
                : "chat",
            },
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

/** Only view state is persisted: a tab never owns or starts an execution process. */
export function useConversationPanels(server: string, session: string) {
  const [all, setAll] = useState(read);
  const key = JSON.stringify([server, session]);
  const state = all[key] || empty;
  const update = useCallback(
    (change: (old: Panels) => Panels, id = session) => {
      if (!server || !id) return;
      const scope = JSON.stringify([server, id]);
      setAll((old) => ({ ...old, [scope]: change(old[scope] || empty) }));
    },
    [server, session],
  );
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(all));
    } catch {
      /* View remains usable without storage. */
    }
  }, [all]);
  const active = state.tabs.find((item) => item.id === state.active);
  const setTab = useCallback(
    (value: string | ((kind: string) => string), id = session) => {
      update((old) => {
        const current =
          old.tabs.find((item) => item.id === old.active)?.kind || "chat";
        const kind = typeof value === "function" ? value(current) : value;
        if (kind === "chat") return { ...old, active: "chat" };
        if (!["files", "git", "goal", "terminal", "subagents"].includes(kind))
          return old;
        const existing = [...old.tabs]
          .reverse()
          .find((item) => item.kind === kind);
        const tab = existing || { id: kind, kind: kind as PanelKind };
        return {
          tabs: existing ? old.tabs : [...old.tabs, tab],
          active: tab.id,
        };
      }, id);
    },
    [update, session],
  );
  const openFile = useCallback(
    (target: FileTarget, id = session, sourceSessionId?: string) =>
      update((old) => {
        const tab: ConversationPanel = {
          id: `file:${target.path}`,
          kind: "files",
          target,
          sourceSessionId,
        };
        const exists = old.tabs.some((item) => item.id === tab.id);
        return {
          tabs: exists
            ? old.tabs.map((item) => (item.id === tab.id ? tab : item))
            : [...old.tabs, tab],
          active: tab.id,
        };
      }, id),
    [update, session],
  );
  const activate = (id: string) =>
    update((old) =>
      id === "chat" || old.tabs.some((tab) => tab.id === id)
        ? { ...old, active: id }
        : old,
    );
  const close = (id: string) =>
    update((old) => {
      const index = old.tabs.findIndex((tab) => tab.id === id);
      const tabs = old.tabs.filter((tab) => tab.id !== id);
      return {
        tabs,
        active:
          old.active === id
            ? tabs[Math.max(0, index - 1)]?.id || "chat"
            : old.active,
      };
    });
  return {
    tabs: state.tabs,
    active: state.active,
    tab: active?.kind || "chat",
    fileTarget: active?.target || null,
    sourceSessionId: active?.sourceSessionId,
    setTab,
    openFile,
    activate,
    close,
  };
}
