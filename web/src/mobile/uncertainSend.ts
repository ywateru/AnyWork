import { useState } from "react";

// Receipt uncertainty survives reconnects, without storing message text or credentials.
const pending = new Map<string, string>();
function stored(key: string) {
  try {
    return sessionStorage.getItem(key) || pending.get(key);
  } catch {
    return pending.get(key);
  }
}
export function useUncertainSend(enabled: boolean, scope: string, id: string) {
  const key = JSON.stringify(["mobile-uncertain-send", scope, id]);
  const [, render] = useState(0);
  const receipt = stored(key);
  const settle = (ticket: string | undefined) => {
    // A late response or confirmation must never unlock a later submission.
    if (!ticket || stored(key) !== ticket) return;
    pending.delete(key);
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Keep the in-memory fence when storage is unavailable.
    }
    render((n) => n + 1);
  };
  return {
    blocked: enabled && !!receipt,
    begin: () => {
      const ticket = crypto.randomUUID();
      // Persist before crossing IPC: unload/AbortError may prevent any catch handler.
      try {
        sessionStorage.setItem(key, ticket);
        if (sessionStorage.getItem(key) !== ticket) throw new Error();
      } catch {
        throw new Error("无法保存发送保护，请恢复手机存储后重试；消息尚未发送");
      }
      pending.set(key, ticket);
      render((n) => n + 1);
      return ticket;
    },
    settle,
    clear: () => settle(receipt),
  };
}
