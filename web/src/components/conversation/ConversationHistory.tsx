import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronUp, LoaderCircle } from "lucide-react";
import type { ConversationTurn } from "../../types";
import { splitTurn } from "../../transcript";
import "./ConversationHistory.css";

/** User messages are stable landmarks even when a turn's tools are collapsed. */
export default function ConversationHistory({
  turns,
  scrollRef,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onNavigate,
}: {
  turns: ConversationTurn[];
  scrollRef: RefObject<HTMLDivElement | null>;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onNavigate: () => void;
}) {
  const entries = useMemo(
    () =>
      turns.flatMap((turn) => {
        const { user, final } = splitTurn(turn);
        return user.map((message) => ({
          id: message.id,
          title:
            message.text.trim() ||
            (message.attachments?.length ? "图片或附件消息" : "用户消息"),
          reply:
            final?.text.trim() ||
            (turn.status === "inProgress" ? "正在执行…" : "查看此处的对话"),
        }));
      }),
    [turns],
  );
  const rail = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState("");
  const [preview, setPreview] = useState<{ id: string; top: number } | null>(
    null,
  );
  const [highlight, setHighlight] = useState("");
  const selected = entries.find((entry) => entry.id === preview?.id);
  const landmarkKey = JSON.stringify(entries.map((entry) => entry.id));
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let frame = 0;
    let positions: { id: string; top: number }[] = [];
    const update = () => {
      const boundary =
        scroll.scrollTop + Math.min(100, scroll.clientHeight / 4);
      let low = 0,
        high = positions.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (positions[mid].top <= boundary) low = mid;
        else high = mid - 1;
      }
      const bottom =
        scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 8;
      setCurrent((bottom ? positions.at(-1) : positions[low])?.id || "");
    };
    const measure = () => {
      const ids = new Set<string>(JSON.parse(landmarkKey));
      const top = scroll.getBoundingClientRect().top;
      positions = Array.from(
        scroll.querySelectorAll<HTMLElement>("[data-message-id]"),
      )
        .filter((node) => ids.has(node.dataset.messageId || ""))
        .map((node) => ({
          id: node.dataset.messageId!,
          top: node.getBoundingClientRect().top - top + scroll.scrollTop,
        }));
      update();
    };
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          update();
        });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    const transcript = scroll.querySelector(".transcript");
    if (transcript) observer.observe(transcript);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [landmarkKey, scrollRef]);
  useEffect(() => {
    const container = list.current;
    const marker = container?.querySelector<HTMLElement>(
      '[aria-current="location"]',
    );
    if (!container || !marker) return;
    const top =
      marker.getBoundingClientRect().top -
      container.getBoundingClientRect().top;
    if (top < 0) container.scrollTop += top;
    else if (top + marker.clientHeight > container.clientHeight)
      container.scrollTop += top + marker.clientHeight - container.clientHeight;
  }, [current]);
  useEffect(() => {
    if (!preview) return;
    const dismiss = (event: PointerEvent) => {
      if (!rail.current?.contains(event.target as Node)) setPreview(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [preview]);
  useEffect(() => {
    if (!highlight) return;
    const node = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ||
        [],
    ).find((item) => item.dataset.messageId === highlight);
    node?.classList.add("history-jump-target");
    const timeout = window.setTimeout(() => {
      node?.classList.remove("history-jump-target");
      setHighlight("");
    }, 1400);
    return () => {
      clearTimeout(timeout);
      node?.classList.remove("history-jump-target");
    };
  }, [highlight, scrollRef]);
  function show(id: string, button: HTMLElement) {
    const bounds = rail.current?.getBoundingClientRect();
    if (bounds)
      setPreview({
        id,
        top: Math.max(
          0,
          Math.min(
            button.getBoundingClientRect().top - bounds.top - 24,
            bounds.height - 164,
          ),
        ),
      });
  }
  function jump(id: string) {
    const scroll = scrollRef.current;
    const node = Array.from(
      scroll?.querySelectorAll<HTMLElement>("[data-message-id]") || [],
    ).find((item) => item.dataset.messageId === id);
    if (!node || !scroll) return;
    onNavigate();
    scroll.scrollTo({
      top:
        scroll.scrollTop +
        node.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top -
        20,
      behavior: "instant",
    });
    setCurrent(id);
    setHighlight(id);
  }
  if (!entries.length) return null;
  return (
    <nav
      className="conversation-history"
      aria-label="对话记录定位"
      ref={rail}
      onPointerLeave={(event) => {
        // A tap can generate compatibility mouseleave after jumping moves the
        // rail. Keep touch previews open until an explicit dismissal.
        if (event.pointerType !== "touch") setPreview(null);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setPreview(null);
      }}
    >
      {hasOlder && (
        <button
          className="history-load-older"
          aria-label="加载更早的对话记录"
          disabled={loadingOlder}
          onClick={onLoadOlder}
        >
          {loadingOlder ? (
            <LoaderCircle size={12} className="spin" />
          ) : (
            <ChevronUp size={12} />
          )}
        </button>
      )}
      <div
        className="history-ticks"
        ref={list}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          const buttons = Array.from(
            list.current?.querySelectorAll<HTMLButtonElement>("button") || [],
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : Math.max(
                    0,
                    Math.min(
                      buttons.length - 1,
                      index + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
          event.preventDefault();
          buttons[next]?.focus();
        }}
      >
        {entries.map((entry, index) => (
          <button
            key={entry.id}
            className={`history-tick${current === entry.id ? " current" : ""}${preview?.id === entry.id ? " previewing" : ""}`}
            aria-label={`第 ${index + 1} 条对话：${entry.title.replace(/\s+/g, " ").slice(0, 90)}`}
            aria-current={current === entry.id ? "location" : undefined}
            aria-describedby={
              preview?.id === entry.id
                ? "conversation-history-preview"
                : undefined
            }
            tabIndex={
              current === entry.id || (!current && index === 0) ? 0 : -1
            }
            onMouseEnter={(event) => show(entry.id, event.currentTarget)}
            onFocus={(event) => show(entry.id, event.currentTarget)}
            onPointerDown={(event) => {
              if (event.pointerType === "touch")
                show(entry.id, event.currentTarget);
            }}
            onClick={() => jump(entry.id)}
          >
            <span />
          </button>
        ))}
      </div>
      {selected && preview && (
        <div
          id="conversation-history-preview"
          className="history-preview"
          style={{ top: preview.top }}
        >
          <strong>{selected.title.slice(0, 360)}</strong>
          <p>{selected.reply.slice(0, 600)}</p>
          <button
            onClick={() => {
              jump(selected.id);
              setPreview(null);
            }}
          >
            跳转到此处
          </button>
        </div>
      )}
    </nav>
  );
}
