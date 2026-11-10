import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import NotificationCenter from "./NotificationCenter";

describe("notification overlap boundary", () => {
  it("lets actual pending requests suppress toasts independently of the notice ledger", () => {
    const center = {
      notices: [
        {
          id: "previous-turn",
          sessionId: "current",
          kind: "complete" as const,
          title: "会话执行完成",
          body: "Synthetic session",
          createdAt: 1,
          read: false,
        },
      ],
      hasCurrentRequest: false,
      permission: "default" as const,
      enabled: false,
      feedback: "",
      receive: vi.fn(),
      open: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      dismiss: vi.fn(),
      markAllRead: vi.fn(),
    };
    const unobstructed = renderToStaticMarkup(
      <NotificationCenter center={center} hasPendingRequest={false} />,
    );
    expect(unobstructed).toContain("notification-toast-open");
    const pending = renderToStaticMarkup(
      <NotificationCenter center={center} hasPendingRequest />,
    );
    expect(pending).not.toContain("notification-toast-open");
    expect(pending).toContain("通知，1 条未读");
    expect(pending).toContain("notification-trigger");
  });
});
