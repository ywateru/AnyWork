import { useEffect, useRef } from "react";
import {
  CornerDownRight,
  ListEnd,
  LoaderCircle,
  MoreHorizontal,
  Target,
  Trash2,
} from "lucide-react";
import type { Api } from "../../api";
import type { ComposerDocument } from "../../composerSubmission";
import ImagePreview from "../ImagePreview";
import QueuedMessagePreview from "./QueuedMessagePreview";

export interface QueuedMessage {
  id: number;
  text: string;
  attachments: string[];
  status: string;
  error?: string;
  composer?: ComposerDocument;
  goal?: boolean;
}

export default function MessageQueue({
  api,
  sessionId,
  items,
  paused,
  working,
  onAction,
  onEdit,
  canEdit,
  queueingEnabled,
  onToggleQueueing,
}: {
  api: Api;
  sessionId: string;
  items: QueuedMessage[];
  paused: boolean;
  working: boolean;
  onAction: (data: object) => Promise<boolean>;
  onEdit: (item: QueuedMessage) => void;
  canEdit: boolean;
  queueingEnabled: boolean;
  onToggleQueueing: () => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  function positionMenu(menu: HTMLDetailsElement) {
    const rect = menu.querySelector("summary")!.getBoundingClientRect();
    const popup = menu.querySelector<HTMLElement>(".queue-menu");
    if (popup) {
      popup.style.right = `${Math.max(12, innerWidth - rect.right)}px`;
      popup.style.bottom = `${innerHeight - rect.top + 6}px`;
    }
  }
  useEffect(() => {
    const close = (event: Event) => {
      for (const menu of area.current?.querySelectorAll<HTMLDetailsElement>(
        "details[open]",
      ) || []) {
        if (
          event.type !== "pointerdown" ||
          !menu.contains(event.target as Node)
        )
          menu.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  return (
    <div className="message-queue" aria-label="排队消息" ref={area}>
      {paused && (
        <div className="queue-paused" role="status">
          <span>排队已暂停</span>
          <button
            disabled={working}
            onClick={() => void onAction({ action: "pause", paused: false })}
          >
            继续排队
          </button>
        </div>
      )}
      {items.map((item, index) => {
        const unavailable = working || item.status === "sending";
        const pending = item.status === "pending";
        return (
          <div
            className="queue-item"
            key={item.id}
            aria-busy={unavailable}
            data-status={item.status}
          >
            {item.status === "sending" ? (
              <LoaderCircle
                className="queue-item-icon spin"
                size={15}
                aria-hidden="true"
              />
            ) : (
              <ListEnd
                className="queue-item-icon"
                size={15}
                aria-hidden="true"
              />
            )}
            <div className="queue-content">
              {item.attachments.length > 0 && (
                <div className="queue-images">
                  {item.attachments
                    .filter((path) => /\.(png|jpe?g|webp|gif)$/i.test(path))
                    .map((path) => (
                      <ImagePreview
                        key={path}
                        api={api}
                        sessionId={sessionId}
                        path={path}
                        compact
                      />
                    ))}
                </div>
              )}
              <div className="queue-copy">
                {item.goal && (
                  <span className="queue-goal-label">
                    <Target size={12} />
                    目标
                  </span>
                )}
                <QueuedMessagePreview
                  text={item.text}
                  position={index + 1}
                  attachmentCount={item.attachments.length}
                />
                {(item.error || item.status === "sending") && (
                  <small role="status">{item.error || "正在发送…"}</small>
                )}
              </div>
            </div>
            <button
              className="queue-steer"
              disabled={unavailable || !pending}
              hidden={item.status === "sending"}
              title="立即发送，引导当前任务"
              onClick={() => void onAction({ action: "steer", id: item.id })}
            >
              <CornerDownRight size={15} aria-hidden="true" />
              引导
            </button>
            <button
              className="queue-delete"
              disabled={unavailable}
              title="删除排队消息"
              aria-label="删除排队消息"
              onClick={() => void onAction({ action: "delete", id: item.id })}
            >
              <Trash2 size={14} />
            </button>
            <details
              data-floating-menu
              hidden={item.status === "sending"}
              onToggle={(event) => {
                const menu = event.currentTarget;
                if (!menu.open) return;
                if (unavailable || !pending) {
                  menu.open = false;
                  return;
                }
                for (const other of area.current?.querySelectorAll<HTMLDetailsElement>(
                  "details[open]",
                ) || [])
                  if (other !== menu) other.open = false;
                positionMenu(menu);
              }}
              onKeyDown={(event) => {
                const menu = event.currentTarget;
                if (unavailable || !pending) {
                  event.preventDefault();
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  menu.open = false;
                  menu.querySelector("summary")?.focus();
                } else if (
                  ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  menu.open = true;
                  positionMenu(menu);
                  const buttons = [
                    ...menu.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    ),
                  ];
                  const index = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? buttons.length - 1
                        : event.key === "ArrowDown"
                          ? (index + 1) % buttons.length
                          : index <= 0
                            ? buttons.length - 1
                            : index - 1;
                  buttons[next]?.focus();
                }
              }}
            >
              <summary
                aria-label="排队消息选项"
                aria-disabled={unavailable || !pending}
                tabIndex={unavailable || !pending ? -1 : 0}
                onClick={(event) => {
                  if (unavailable || !pending) event.preventDefault();
                  else positionMenu(event.currentTarget.closest("details")!);
                }}
              >
                <MoreHorizontal size={16} />
              </summary>
              <div className="queue-menu" role="menu" aria-label="排队消息选项">
                <button
                  role="menuitem"
                  disabled={
                    unavailable || !canEdit || item.status !== "pending"
                  }
                  onClick={(event) => {
                    event.currentTarget.closest("details")!.open = false;
                    onEdit(item);
                  }}
                >
                  编辑消息
                </button>
                <button
                  role="menuitem"
                  disabled={working}
                  onClick={(event) => {
                    event.currentTarget.closest("details")!.open = false;
                    onToggleQueueing();
                  }}
                >
                  {queueingEnabled ? "关闭排队" : "开启排队"}
                </button>
              </div>
            </details>
          </div>
        );
      })}
    </div>
  );
}
