import { useState } from "react";

// Receipt uncertainty survives reconnects, without storing message text or credentials.
const pending = new Set<string>();
function stored(key: string) {
  try {
    return pending.has(key) || sessionStorage.getItem(key) === "1";
  } catch {
    return pending.has(key);
  }
}
export function useUncertainSend(enabled: boolean, scope: string, id: string) {
  const key = JSON.stringify(["mobile-uncertain-send", scope, id]);
  const [, render] = useState(0);
  const update = (value: boolean, target = key) => {
    if (value) pending.add(target);
    else pending.delete(target);
    try {
      if (value) sessionStorage.setItem(target, "1");
      else sessionStorage.removeItem(target);
    } catch {
      // Keep the in-memory fence when storage is unavailable.
    }
    render((n) => n + 1);
  };
  return {
    blocked: enabled && stored(key),
    mark: () => update(true),
    clear: () => update(false),
  };
}
