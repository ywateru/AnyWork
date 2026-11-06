import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

let dismissActive: (() => void) | undefined;

// Scoped to review metadata. The queue's selectable preview has its own lifecycle.
export default function ReviewTooltip({
  text,
  overflowOnly = false,
  side = "right",
  children,
}: {
  text: string;
  overflowOnly?: boolean;
  side?: "right" | "top";
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  const host = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    x: number;
    y: number;
    side: "right" | "left" | "top" | "bottom";
  }>({ x: 0, y: 0, side });
  const cancelTimer = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const close = useCallback(() => {
    cancelTimer();
    setOpen(false);
  }, [cancelTimer]);
  function eligible() {
    const trigger = host.current?.firstElementChild as HTMLElement | null;
    const target =
      trigger?.querySelector<HTMLElement>("[data-tooltip-overflow-target]") ??
      trigger;
    return (
      !!text &&
      !!target &&
      (!overflowOnly ||
        target.scrollWidth > target.clientWidth ||
        target.scrollHeight > target.clientHeight)
    );
  }
  function show() {
    cancelTimer();
    if (!eligible()) return;
    dismissActive?.();
    dismissActive = close;
    setOpen(true);
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("blur", close);
    document.addEventListener("keydown", escape, true);
    return () => {
      cancelTimer();
      window.removeEventListener("blur", close);
      document.removeEventListener("keydown", escape, true);
      if (dismissActive === close) dismissActive = undefined;
    };
  }, [close, cancelTimer]);
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = host.current?.firstElementChild;
    const tip = popup.current;
    if (!trigger || !tip) return;
    const positionPopup = () => {
      if (!eligible()) {
        close();
        return;
      }
      const rect = trigger.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
        close();
        return;
      }
      for (
        let ancestor = trigger.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        if (
          !/(auto|scroll|hidden|clip)/.test(
            getComputedStyle(ancestor).overflowY,
          )
        )
          continue;
        const clip = ancestor.getBoundingClientRect();
        if (
          clip.height &&
          (rect.bottom <= clip.top || rect.top >= clip.bottom)
        ) {
          close();
          return;
        }
      }
      const bounds = tip.getBoundingClientRect();
      const margin = 8,
        offset = 2;
      let actual: typeof position.side = side;
      let x = rect.right + offset;
      let y = rect.top + (rect.height - bounds.height) / 2;
      if (side === "right" && x + bounds.width > window.innerWidth - margin) {
        x = rect.left - offset - bounds.width;
        actual = "left";
      } else if (side === "top") {
        x = rect.left + (rect.width - bounds.width) / 2;
        y = rect.top - offset - bounds.height;
        if (y < margin) {
          y = rect.bottom + offset;
          actual = "bottom";
        }
      }
      setPosition({
        x: Math.max(
          margin,
          Math.min(x, window.innerWidth - bounds.width - margin),
        ),
        y: Math.max(
          margin,
          Math.min(y, window.innerHeight - bounds.height - margin),
        ),
        side: actual,
      });
    };
    positionPopup();
    const observer = new ResizeObserver(positionPopup);
    observer.observe(trigger);
    observer.observe(tip);
    window.addEventListener("resize", positionPopup);
    document.addEventListener("scroll", positionPopup, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", positionPopup);
      document.removeEventListener("scroll", positionPopup, true);
    };
  }, [open, text, side, overflowOnly]);
  return (
    <span
      ref={host}
      className="review-tooltip-host"
      data-tooltip-open={open}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch" || !eligible()) return;
        cancelTimer();
        timer.current = setTimeout(show, 200);
      }}
      onPointerLeave={close}
      onPointerDown={close}
      onClick={close}
      onContextMenu={close}
      onBlur={close}
      onFocus={(event) => {
        if ((event.target as HTMLElement).matches(":focus-visible")) show();
      }}
    >
      {cloneElement(children, {
        "aria-describedby":
          [children.props["aria-describedby"], open ? id : null]
            .filter(Boolean)
            .join(" ") || undefined,
      })}
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="tooltip"
            className={`review-tooltip${overflowOnly ? " review-tooltip-menu" : ""}`}
            data-side={position.side}
            style={{ left: position.x, top: position.y }}
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
