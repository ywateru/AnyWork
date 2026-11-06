import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Non-modal connection details, anchored to the selected node and kept in view. */
export function ConnectionPopover({
  anchor,
  title,
  onClose,
  children,
}: {
  anchor: HTMLElement | null;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({
    left: 16,
    top: 16,
    maxHeight: innerHeight - 32,
  });
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || !anchor) return;
    function place() {
      const rect = anchor!.getBoundingClientRect();
      const box = element!.getBoundingClientRect();
      const gap = 12;
      const left = Math.max(
        16,
        Math.min(rect.right - box.width, innerWidth - box.width - 16),
      );
      const below = Math.max(0, innerHeight - 16 - rect.bottom - gap);
      const above = Math.max(0, rect.top - gap - 16);
      const naturalHeight =
        element!.scrollHeight + element!.offsetHeight - element!.clientHeight;
      const useBelow = below >= naturalHeight || below >= above;
      // Keep the trigger reachable even when the details need to scroll.
      const maxHeight = Math.max(0, useBelow ? below : above);
      const height = Math.min(naturalHeight, maxHeight);
      const top = useBelow ? rect.bottom + gap : rect.top - gap - height;
      setPosition((old) =>
        old.left === left && old.top === top && old.maxHeight === maxHeight
          ? old
          : { left, top, maxHeight },
      );
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    observer.observe(anchor);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    function pointer(event: PointerEvent) {
      if (
        !element!.contains(event.target as Node) &&
        !anchor!.contains(event.target as Node)
      )
        close.current();
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        anchor!.focus();
      }
    }
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    element
      .querySelector<HTMLElement>(".connection-popover-close")
      ?.focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, [anchor]);
  return createPortal(
    <div
      ref={panel}
      id="connection-details"
      className="connection-popover"
      role="dialog"
      aria-label={title}
      style={position}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon connection-popover-close"
          aria-label="关闭连接详情"
          onClick={() => {
            onClose();
            anchor?.focus();
          }}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </div>,
    document.body,
  );
}
