import { useCallback, useEffect, useRef, useState } from "react";
import {
  noticeForEvent,
  resolveNotices,
  type SessionNotice,
} from "../sessionNotifications";
import type { AgentEvent, Session } from "../types";

export function useSessionNotifications(
  scope: string,
  sessions: Session[],
  selected: string,
  onSelect: (id: string) => void,
  systemNotifications = true,
) {
  const [notices, setNotices] = useState<SessionNotice[]>([]);
  const latestNotices = useRef(notices);
  latestNotices.current = notices;
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem("anywork.notifications") !== "false",
  );
  const [feedback, setFeedback] = useState("");
  const current = useRef({
    scope,
    sessions,
    onSelect,
    enabled,
    systemNotifications,
  });
  current.current = { scope, sessions, onSelect, enabled, systemNotifications };
  const seen = useRef(new Set<string>());
  const systems = useRef(new Map<string, Notification>());
  const generation = useRef(0);
  const startedAt = useRef(Date.now());
  useEffect(() => {
    generation.current++;
    startedAt.current = Date.now();
    seen.current.clear();
    setNotices([]);
    for (const notification of systems.current.values()) notification.close();
    systems.current.clear();
    return () => {
      generation.current++;
      for (const notification of systems.current.values()) notification.close();
      systems.current.clear();
    };
  }, [scope]);
  const open = useCallback((id: string, sessionId: string) => {
    setNotices((old) =>
      old.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    systems.current.get(id)?.close();
    systems.current.delete(id);
    current.current.onSelect(sessionId);
  }, []);
  const receive = useCallback(
    (event: AgentEvent, pending = false) => {
      if (
        ["serverRequest/resolved", "turn/completed", "plugin/exited"].includes(
          event.method,
        )
      )
        setNotices((old) => resolveNotices(old, event));
      if (!pending && event.created_at < startedAt.current - 2000) return;
      const session = current.current.sessions.find(
        (s) => s.id === event.session_id,
      );
      if (!session || session.archived) return;
      const notice = noticeForEvent(event, session.title);
      if (!notice || seen.current.has(notice.id)) return;
      seen.current.add(notice.id);
      if (seen.current.size > 2000)
        seen.current.delete(seen.current.values().next().value!);
      setNotices((old) => [notice, ...old].slice(0, 50));
      if (
        !current.current.systemNotifications ||
        !current.current.enabled ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted" ||
        (!document.hidden && document.hasFocus())
      )
        return;
      const savedGeneration = generation.current;
      const data = {
        id: notice.id,
        sessionId: notice.sessionId,
        scope: current.current.scope,
        url: new URL(`#${encodeURIComponent(notice.sessionId)}`, location.href)
          .href,
      };
      const options: NotificationOptions = {
        body: notice.body,
        tag: JSON.stringify([current.current.scope, notice.id]),
        icon: import.meta.env.BASE_URL + "icon-192.png",
        data,
      };
      void (async () => {
        try {
          const registration =
            "serviceWorker" in navigator
              ? await navigator.serviceWorker.getRegistration()
              : undefined;
          if (
            savedGeneration !== generation.current ||
            latestNotices.current.find((n) => n.id === notice.id)?.read
          )
            return;
          if (registration?.active) {
            await registration.showNotification(notice.title, options);
            if (
              savedGeneration !== generation.current ||
              latestNotices.current.find((n) => n.id === notice.id)?.read
            ) {
              for (const notification of await registration.getNotifications({
                tag: options.tag,
              }))
                notification.close();
            }
            return;
          }
          const notification = new Notification(notice.title, options);
          systems.current.set(notice.id, notification);
          notification.onclick = () => {
            if (savedGeneration === generation.current) {
              window.focus();
              open(notice.id, notice.sessionId);
            }
            notification.close();
          };
        } catch {
          /* Browser restrictions never interrupt the chat or its in-app reminders. */
        }
      })();
    },
    [open],
  );
  useEffect(() => {
    const unread = notices.filter((n) => !n.read).length;
    document.title = unread ? `(${unread}) AnyWork` : "AnyWork";
    // Keep the system tray in sync with read and resolved in-app reminders.
    const resolved = notices.filter((n) => n.read);
    for (const notice of resolved) {
      systems.current.get(notice.id)?.close();
      systems.current.delete(notice.id);
    }
    if (resolved.length && "serviceWorker" in navigator) {
      const tags = new Set(resolved.map((n) => JSON.stringify([scope, n.id])));
      void navigator.serviceWorker
        .getRegistration()
        .then(async (registration) => {
          if (!registration) return;
          for (const notification of await registration.getNotifications())
            if (tags.has(notification.tag)) notification.close();
        })
        .catch(() => {});
    }
  }, [notices, scope]);
  useEffect(() => {
    const message = (event: MessageEvent) => {
      const data = event.data;
      if (
        data?.type === "ANYWORK_NOTIFICATION_CLICK" &&
        data.scope === current.current.scope &&
        current.current.sessions.some((s) => s.id === data.sessionId)
      )
        open(data.id, data.sessionId);
    };
    navigator.serviceWorker?.addEventListener("message", message);
    const refreshPermission = () =>
      setPermission(
        typeof Notification === "undefined"
          ? "unsupported"
          : Notification.permission,
      );
    window.addEventListener("focus", refreshPermission);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", message);
      window.removeEventListener("focus", refreshPermission);
      document.title = "AnyWork";
    };
  }, [open]);
  const enable = async () => {
    if (typeof Notification === "undefined" || !window.isSecureContext) {
      setFeedback("系统通知需要 HTTPS 或 localhost；网页内提醒已开启。");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === "granted") {
        setEnabled(true);
        localStorage.setItem("anywork.notifications", "true");
        setFeedback("已开启完成、权限和确认的系统通知。");
      } else
        setFeedback(
          result === "denied"
            ? "系统通知已被浏览器阻止，请在网站设置中允许；网页内仍会提醒。"
            : "未开启系统通知；网页内仍会提醒。",
        );
    } catch {
      setFeedback("浏览器未能开启系统通知；网页内仍会提醒。");
    }
  };
  const disable = () => {
    setEnabled(false);
    localStorage.setItem("anywork.notifications", "false");
    setFeedback("已关闭系统通知；网页内仍会提醒。");
  };
  return {
    notices,
    hasCurrentRequest: notices.some(
      (n) => n.sessionId === selected && n.requestId != null && !n.resolved,
    ),
    permission,
    enabled,
    feedback,
    receive,
    open,
    enable,
    disable,
    dismiss: (id: string) => {
      setNotices((old) =>
        old.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      systems.current.get(id)?.close();
    },
    markAllRead: () =>
      setNotices((old) => old.map((n) => ({ ...n, read: true }))),
  };
}
