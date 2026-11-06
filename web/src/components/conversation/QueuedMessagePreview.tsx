import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";

// Ue → promptPreview tooltip: a selectable nonmodal dialog. Reading a queued
// prompt must never remove it from the queue or replace the main draft.
export default function QueuedMessagePreview({
  text,
  position,
  attachmentCount,
}: {
  text: string;
  position: number;
  attachmentCount: number;
}) {
  const id = useId();
  const trigger = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({
    left: 16,
    top: 16,
    maxHeight: 0,
    maxWidth: 432,
  });
  const summary = text.trim() ? text : `${attachmentCount} 个附件`;
  const excerpt = Array.from(summary.replace(/\s+/g, " ").trim());
  const label =
    excerpt.length > 80
      ? excerpt.slice(0, 79).join("") + "…"
      : excerpt.join("");

  function cancelTimers() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    hoverTimer.current = closeTimer.current = null;
  }
  function shouldOpen() {
    const element = trigger.current;
    return (
      !!text.trim() &&
      !!element &&
      (/\n|\r/.test(text) ||
        element.scrollWidth > element.clientWidth ||
        element.scrollHeight > element.clientHeight)
    );
  }
  function show() {
    cancelTimers();
    if (shouldOpen()) setOpen(true);
  }
  function close() {
    cancelTimers();
    setOpen(false);
  }
  function leave(event: PointerEvent) {
    cancelTimers();
    if (event.pointerType === "touch") return;
    // Keep the gap between the row and its selectable preview traversable.
    closeTimer.current = setTimeout(() => {
      const selection = window.getSelection();
      if (
        content.current?.contains(document.activeElement) ||
        (selection?.isCollapsed === false &&
          (content.current?.contains(selection.anchorNode) ||
            content.current?.contains(selection.focusNode)))
      )
        return;
      setOpen(false);
    }, 300);
  }
  function blur(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (!trigger.current?.contains(next) && !content.current?.contains(next))
      close();
  }
  function keyboard(event: KeyboardEvent) {
    if (event.isDefaultPrevented()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (content.current?.contains(document.activeElement))
        trigger.current?.focus({ preventScroll: true });
      close();
    } else if (
      (event.key === "Enter" || event.key === " ") &&
      event.currentTarget === trigger.current
    ) {
      event.preventDefault();
      show();
    } else if (
      event.key === "Tab" &&
      open &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      if (event.currentTarget === trigger.current && !event.shiftKey) {
        event.preventDefault();
        content.current?.focus({ preventScroll: true });
      } else if (event.currentTarget === content.current) {
        // Return to the row, then let the browser move to the next row action.
        trigger.current?.focus({ preventScroll: true });
        if (event.shiftKey) event.preventDefault();
        else close();
      }
    }
  }

  useEffect(() => cancelTimers, []);
  useEffect(() => {
    if (!open) return;
    const onWindowBlur = () => close();
    window.addEventListener("blur", onWindowBlur);
    return () => window.removeEventListener("blur", onWindowBlur);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    function positionPreview() {
      const anchor = trigger.current;
      const popup = content.current;
      if (!anchor || !popup) return;
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0,
        y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth,
        height = viewport?.height ?? innerHeight;
      const topRoom = Math.max(0, rect.top - y - 30);
      const bottomRoom = Math.max(0, y + height - rect.bottom - 30);
      const above =
        topRoom >= Math.min(popup.scrollHeight, 240) || topRoom >= bottomRoom;
      const maxHeight = Math.max(0, above ? topRoom : bottomRoom);
      const visibleHeight = Math.min(popup.scrollHeight, maxHeight);
      setPlacement({
        left: Math.max(
          x + 16,
          Math.min(
            rect.x + rect.width / 2 - popup.offsetWidth / 2,
            x + width - popup.offsetWidth - 16,
          ),
        ),
        top: above ? rect.top - 14 - visibleHeight : rect.bottom + 14,
        maxHeight,
        maxWidth: Math.max(0, width - 32),
      });
    }
    positionPreview();
    const resize = new ResizeObserver(positionPreview);
    if (trigger.current) resize.observe(trigger.current);
    if (content.current) resize.observe(content.current);
    window.addEventListener("resize", positionPreview);
    window.addEventListener("scroll", positionPreview, true);
    window.visualViewport?.addEventListener("resize", positionPreview);
    window.visualViewport?.addEventListener("scroll", positionPreview);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", positionPreview);
      window.removeEventListener("scroll", positionPreview, true);
      window.visualViewport?.removeEventListener("resize", positionPreview);
      window.visualViewport?.removeEventListener("scroll", positionPreview);
    };
  }, [open, text]);

  return (
    <>
      <div
        ref={trigger}
        className="queue-text"
        role="group"
        tabIndex={0}
        aria-label={`预览排队消息 ${position}：${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={show}
        onFocus={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !content.current?.contains(event.relatedTarget)
          )
            show();
        }}
        onBlur={blur}
        onKeyDown={keyboard}
        onPointerEnter={(event) => {
          cancelTimers();
          if (event.pointerType !== "touch" && !open)
            hoverTimer.current = setTimeout(show, 700);
        }}
        onPointerLeave={leave}
        onContextMenu={close}
      >
        {summary}
      </div>
      {open &&
        createPortal(
          <div
            id={id}
            ref={content}
            className="queue-message-preview"
            role="dialog"
            aria-label="排队消息预览"
            data-tooltip-keyboard-navigation=""
            tabIndex={0}
            style={placement}
            onPointerEnter={cancelTimers}
            onPointerLeave={leave}
            onKeyDown={keyboard}
            onBlur={blur}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
