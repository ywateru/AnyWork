import { openPlatformLink } from "../../platform";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { promptLinkIcons } from "../../promptLinkIcons";
import { editablePromptLinkHref, httpPromptHref } from "../../promptText";
import "./PromptLinkPopover.css";

export interface PromptLinkTarget {
  element: HTMLElement;
  displayText: string;
  href: string;
}

function ReferenceIcon({ name }: { name: keyof typeof promptLinkIcons }) {
  const icon = promptLinkIcons[name];
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox={icon.viewBox}
      fill={icon.fill}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}

/** lsc / esc: nonmodal anchored actions, then text or URL edit in the same surface. */
export default function PromptLinkPopover({
  target,
  onClose,
  onSave,
}: {
  target: PromptLinkTarget;
  onClose: (restoreFocus?: boolean) => void;
  onSave: (text: string, href: string | null) => void;
}) {
  const [mode, setMode] = useState<"actions" | "text" | "url">("actions");
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, visible: false });
  const root = useRef<HTMLFormElement>(null);
  const composing = useRef(false);
  const compositionEnd = useRef(-Infinity);
  const errorId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    setMode("actions");
    setValue("");
    setError(false);
  }, [target]);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = target.element,
        content = root.current;
      if (!anchor.isConnected || !content) {
        close.current(false);
        return;
      }
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0,
        y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth,
        height = viewport?.height ?? innerHeight;
      const rect = anchor.getBoundingClientRect(),
        box = content.getBoundingClientRect();
      const top = rect.top - box.height - 4;
      setPosition({
        left: Math.max(
          x + 8,
          Math.min(
            rect.left + rect.width / 2 - box.width / 2,
            x + width - box.width - 8,
          ),
        ),
        top: Math.max(
          y + 8,
          Math.min(
            top >= y + 8 ? top : rect.bottom + 4,
            y + height - box.height - 8,
          ),
        ),
        visible: true,
      });
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(root.current!);
    resize.observe(target.element);
    const mutations = new MutationObserver(() => {
      if (!target.element.isConnected) close.current(false);
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    visualViewport?.addEventListener("resize", place);
    visualViewport?.addEventListener("scroll", place);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      visualViewport?.removeEventListener("resize", place);
      visualViewport?.removeEventListener("scroll", place);
    };
  }, [target, mode]);

  useLayoutEffect(() => {
    root.current
      ?.querySelector<HTMLElement>(
        mode === "actions" ? "[data-edit-link-text]" : "input",
      )
      ?.focus({ preventScroll: true });
  }, [target, mode, position.visible]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !target.element.contains(event.target)
      )
        close.current(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
    };
  }, [target]);

  const saveLabel =
    mode === "text"
      ? "保存链接文字"
      : value.trim()
        ? "保存链接网址"
        : "移除链接";
  return createPortal(
    <form
      ref={root}
      role="dialog"
      aria-label="链接选项"
      noValidate
      data-mode={mode}
      className="prompt-link-popover"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.visible ? "visible" : "hidden",
      }}
      onMouseDown={(event) => {
        if (mode === "actions") event.preventDefault();
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        compositionEnd.current = performance.now();
      }}
      onKeyDown={(event) => {
        if (
          event.nativeEvent.isComposing ||
          composing.current ||
          event.keyCode === 229 ||
          performance.now() - compositionEnd.current < 100
        ) {
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (mode !== "actions") {
            setMode("actions");
            setError(false);
            setValue("");
          } else onClose();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (
          mode === "actions" ||
          composing.current ||
          performance.now() - compositionEnd.current < 100
        )
          return;
        const text = value.trim();
        if (mode === "text") {
          if (text) onSave(text, target.href);
        } else if (!text) onSave(target.displayText, null);
        else {
          const href = editablePromptLinkHref(text);
          if (href == null) setError(true);
          else onSave(target.displayText, href);
        }
      }}
    >
      {mode === "actions" ? (
        <>
          {httpPromptHref(target.href) && (
            <button
              type="button"
              onClick={() => {
                openPlatformLink(target.href);
                onClose();
              }}
            >
              <ReferenceIcon name="open" />
              打开链接
            </button>
          )}
          <button
            type="button"
            data-edit-link-text
            onClick={() => {
              setMode("text");
              setValue(target.displayText);
            }}
          >
            <ReferenceIcon name="edit" />
            编辑文字
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              setMode("url");
              setValue(target.href);
              setError(false);
            }}
          >
            <ReferenceIcon name="link" />
            编辑链接
          </button>
        </>
      ) : (
        <>
          <input
            aria-label={mode === "text" ? "文字" : "网址"}
            type={mode === "url" ? "url" : "text"}
            autoComplete="off"
            required={mode === "text"}
            value={value}
            placeholder={mode === "text" ? "链接文字" : "https://example.com"}
            aria-invalid={(mode === "url" && error) || undefined}
            aria-describedby={mode === "url" && error ? errorId : undefined}
            onChange={(event) => {
              setValue(event.currentTarget.value);
              setError(false);
            }}
          />
          {error && (
            <span id={errorId} className="sr-only">
              请输入 HTTP、HTTPS 或 mailto 链接
            </span>
          )}
          <button
            type="submit"
            className="prompt-link-save"
            aria-label={saveLabel}
            title={saveLabel}
            disabled={mode === "text" && !value.trim()}
          >
            <ReferenceIcon name="save" />
          </button>
        </>
      )}
    </form>,
    document.body,
  );
}
