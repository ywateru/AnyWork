import { useCallback, useLayoutEffect, useRef, useState } from "react";

const memory = new Map<string, string>();
const prefix = "anywork.draft.";
function read(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? memory.get(key) ?? "";
  } catch {
    return memory.get(key) || "";
  }
}

/** Drafts belong to one server and one thread; a reload must not erase unfinished work. */
export function useSessionDraft(server: string, session: string) {
  const key = prefix + JSON.stringify([server, session]);
  const [draft, update] = useState(() => read(key));
  const active = useRef(key);
  useLayoutEffect(() => {
    active.current = key;
    update(read(key));
  }, [key]);
  const setDraft = useCallback((text: string) => {
    update(text);
    if (text) memory.set(active.current, text);
    else memory.delete(active.current);
    try {
      if (text) sessionStorage.setItem(active.current, text);
      else sessionStorage.removeItem(active.current);
    } catch {
      /* Private browsing still permits an in-memory draft. */
    }
  }, []);
  return [draft, setDraft] as const;
}
