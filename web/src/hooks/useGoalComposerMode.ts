import { useCallback, useLayoutEffect, useRef, useState } from "react";

const memory = new Set<string>();
const prefix = "anywork.goal-composer.";
function read(key: string) {
  try {
    return sessionStorage.getItem(key) === "true" || memory.has(key);
  } catch {
    return memory.has(key);
  }
}

/** The goal chip belongs to the same server/chat draft as the main editor. */
export function useGoalComposerMode(server: string, session: string) {
  const key = prefix + JSON.stringify([server, session]);
  const [enabled, update] = useState(() => read(key));
  const active = useRef(key);
  useLayoutEffect(() => {
    active.current = key;
    update(read(key));
  }, [key]);
  const setEnabled = useCallback((value: boolean) => {
    update(value);
    if (value) memory.add(active.current);
    else memory.delete(active.current);
    try {
      if (value) sessionStorage.setItem(active.current, "true");
      else sessionStorage.removeItem(active.current);
    } catch {
      /* The current draft still works when browser storage is unavailable. */
    }
  }, []);
  return [enabled, setEnabled] as const;
}
