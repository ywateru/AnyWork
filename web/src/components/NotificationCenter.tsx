import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, ShieldCheck, X } from "lucide-react";
import type { useSessionNotifications } from "../hooks/useSessionNotifications";
import "./notifications.css";
type Center = ReturnType<typeof useSessionNotifications>;
export default function NotificationCenter({
  center,
  hasPendingRequest = false,
}: {
  center: Center;
  hasPendingRequest?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const unread = center.notices.filter((n) => !n.read);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!surface.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="notification-center" ref={surface}>
      <button
        ref={trigger}
        type="button"
        className="icon-button notification-trigger"
        aria-label={unread.length ? `通知，${unread.length} 条未读` : "通知"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={17} />
        {unread.length > 0 && (
          <span className="notification-count">
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </button>
      {open && (
        <section
          className="notification-panel"
          role="dialog"
          aria-modal="false"
          aria-label="通知中心"
        >
          <header>
            <strong>通知</strong>
            <button
              type="button"
              title="全部标为已读"
              aria-label="全部标为已读"
              onClick={center.markAllRead}
            >
              <CheckCheck size={17} />
            </button>
            <button
              type="button"
              aria-label="关闭通知中心"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
          </header>
          <div className="notification-preferences">
            <span>完成、权限申请与确认</span>
            <button
              type="button"
              onClick={() =>
                center.enabled && center.permission === "granted"
                  ? center.disable()
                  : void center.enable()
              }
            >
              {center.enabled && center.permission === "granted"
                ? "关闭系统通知"
                : "开启系统通知"}
            </button>
            {center.feedback && <small role="status">{center.feedback}</small>}
          </div>
          <div className="notification-list">
            {center.notices.length ? (
              center.notices.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  className={
                    n.read ? "notification-item read" : "notification-item"
                  }
                  onClick={() => {
                    center.open(n.id, n.sessionId);
                    setOpen(false);
                  }}
                >
                  <span>
                    {n.kind === "approval" || n.kind === "question" ? (
                      <ShieldCheck size={17} />
                    ) : (
                      <Bell size={17} />
                    )}
                  </span>
                  <span>
                    <strong>
                      {n.title}
                      {n.resolved && " · 已处理"}
                    </strong>
                    <small>{n.body}</small>
                    <time>
                      {new Date(n.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </span>
                  {!n.read && <i aria-label="未读" />}
                </button>
              ))
            ) : (
              <p className="notification-empty">
                暂无通知。完成或需要你处理时会在这里提醒。
              </p>
            )}
          </div>
        </section>
      )}
      {!open && !hasPendingRequest && !center.hasCurrentRequest && (
        <div
          className="notification-toasts"
          aria-label="会话提醒"
          aria-live="polite"
          aria-atomic="false"
        >
          {unread.slice(0, 3).map((n) => (
            <div className="notification-toast" key={n.id}>
              <button
                type="button"
                className="notification-toast-open"
                onClick={() => center.open(n.id, n.sessionId)}
              >
                <strong>{n.title}</strong>
                <span>{n.body}</span>
                <small>点击查看会话</small>
              </button>
              <button
                type="button"
                aria-label="关闭提醒"
                onClick={() => center.dismiss(n.id)}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
