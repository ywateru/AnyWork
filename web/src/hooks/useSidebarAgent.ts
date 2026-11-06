import { useMemo, useState } from "react";
import { readSidebarAgent, sidebarAgentStorageKey } from "../sidebarAgents";

export function useSidebarAgent(server: string) {
  const saved = useMemo(() => readSidebarAgent(server, localStorage), [server]);
  const [selection, setSelection] = useState({ server, value: saved });
  const value = selection.server === server ? selection.value : saved;
  function select(value: string) {
    setSelection({ server, value });
    try {
      localStorage.setItem(sidebarAgentStorageKey(server), value);
    } catch {
      // Browsers with disabled storage retain this selection for the current view.
    }
  }
  return [value, select] as const;
}
