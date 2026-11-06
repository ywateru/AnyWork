import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { ChevronDown } from "lucide-react";
import type { Api } from "../../api";
import type { FileTarget } from "../../fileLinks";
import {
  registerFullUserMessageContent,
  USER_MESSAGE_COLLAPSED_LINES,
  USER_MESSAGE_PRECUT_LIMIT,
  userMessagePreview,
} from "../../userMessageCollapse";
import Markdown from "../Markdown";
import "./UserMessageText.css";

const collapsedLines = USER_MESSAGE_COLLAPSED_LINES;
const interactionSelector =
  'a[href], area[href], button, input, select, textarea, summary, audio[controls], video[controls], iframe, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

export default function UserMessageText({
  text,
  api,
  sessionId,
  cwd,
  onOpenFile,
  contentRef,
}: {
  text: string;
  api: Api;
  sessionId: string;
  cwd: string;
  onOpenFile: (target: FileTarget) => void;
  contentRef: RefObject<HTMLDivElement | null>;
}) {
  const clip = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [measurement, setMeasurement] = useState({
    collapsible: false,
    height: 0,
  });
  const contentId = useId();
  const precut = text.length > USER_MESSAGE_PRECUT_LIMIT;
  const collapsible = precut || measurement.collapsible;
  const collapsed = collapsible && !expanded && !printing && !revealing;
  const renderedText = collapsed && precut ? userMessagePreview(text) : text;

  useLayoutEffect(() => {
    setExpanded(false);
    setRevealing(false);
  }, [text, sessionId]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = clip.current;
    // Over the native threshold, the source length forces disclosure and the
    // renderer never measures the full Markdown or extends a crossing code block.
    if (!content || !viewport || precut) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const styles = getComputedStyle(content);
      const lineHeight =
        Number.parseFloat(styles.lineHeight) ||
        (Number.parseFloat(styles.fontSize) || 13) * 1.625;
      const bounds = content.getBoundingClientRect();
      const scale = content.offsetHeight
        ? bounds.height / content.offsetHeight
        : 1;
      const naturalHeight = Math.max(
        content.offsetHeight,
        content.scrollHeight,
      );
      let height = Math.ceil(lineHeight * (collapsedLines - 1));
      // A code block that begins before the cutoff stays whole, as in the
      // native user-message renderer below its pre-cut threshold.
      for (const block of content.querySelectorAll<HTMLElement>(
        'pre, [data-markdown-copy="code-block"]:not(pre)',
      )) {
        const rect = block.getBoundingClientRect();
        const top = (rect.top - bounds.top) / (scale || 1);
        const bottom = (rect.bottom - bounds.top) / (scale || 1);
        if (top < height && bottom > height) height = Math.ceil(bottom);
      }
      const collapsible = naturalHeight > lineHeight * collapsedLines + 0.5;
      setMeasurement((previous) =>
        previous.collapsible === collapsible && previous.height === height
          ? previous
          : { collapsible, height },
      );
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(content);
    const mutation = new MutationObserver(measure);
    mutation.observe(content, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      disposed = true;
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [text, contentRef, precut]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !collapsed || !precut) return;
    return registerFullUserMessageContent(content, () => {
      flushSync(() => setRevealing(true));
      return () => flushSync(() => setRevealing(false));
    });
  }, [contentRef, collapsed, precut]);

  useLayoutEffect(() => {
    const viewport = clip.current;
    if (!collapsed || !viewport) return;
    viewport.scrollTop = 0;
    const original = new Map<HTMLElement, string | null>();
    const restore = (element: HTMLElement, ariaHidden: string | null) => {
      element.removeAttribute("inert");
      if (ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", ariaHidden);
    };
    const update = () => {
      for (const [element, ariaHidden] of original) {
        if (!viewport.contains(element)) {
          restore(element, ariaHidden);
          original.delete(element);
        }
      }
      const visible = viewport.getBoundingClientRect();
      for (const element of viewport.querySelectorAll<HTMLElement>(
        interactionSelector,
      )) {
        if (!original.has(element)) {
          if (element.hasAttribute("inert")) continue;
          original.set(element, element.getAttribute("aria-hidden"));
        }
        const bounds = element.getBoundingClientRect();
        const isLink = element.matches("a[href], area[href]");
        const shown = isLink
          ? Math.min(bounds.right, visible.right) >
              Math.max(bounds.left, visible.left) &&
            Math.min(bounds.bottom, visible.bottom) >
              Math.max(bounds.top, visible.top)
          : bounds.top >= visible.top - 0.5 &&
            bounds.bottom <= visible.bottom + 0.5 &&
            bounds.left >= visible.left - 0.5 &&
            bounds.right <= visible.right + 0.5;
        if (shown) restore(element, original.get(element)!);
        else {
          element.setAttribute("inert", "");
          element.setAttribute("aria-hidden", "true");
        }
      }
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(viewport);
    const mutation = new MutationObserver(update);
    mutation.observe(viewport, { childList: true, subtree: true });
    viewport.addEventListener("scroll", update);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      viewport.removeEventListener("scroll", update);
      for (const [element, ariaHidden] of original)
        restore(element, ariaHidden);
    };
  }, [collapsed, measurement.height, text]);

  useEffect(() => {
    const media = window.matchMedia("print");
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    const changed = () => setPrinting(media.matches);
    changed();
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    media.addEventListener("change", changed);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      media.removeEventListener("change", changed);
    };
  }, []);

  return (
    <div className="user-message-text" data-collapsed={collapsed || undefined}>
      <div
        className="user-message-text-clip"
        ref={clip}
        id={contentId}
        style={
          collapsed
            ? {
                maxHeight: precut
                  ? `${collapsedLines - 1}lh`
                  : measurement.height,
              }
            : undefined
        }
      >
        <div className="markdown user-message-text-content" ref={contentRef}>
          <Markdown
            text={renderedText}
            api={api}
            sessionId={sessionId}
            cwd={cwd}
            onOpenFile={onOpenFile}
            variant="user"
          />
        </div>
      </div>
      {collapsed && (
        <span className="user-message-ellipsis" aria-hidden="true">
          …
        </span>
      )}
      {collapsible && !printing && (
        <button
          className="user-message-disclosure"
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          data-markdown-copy="exclude"
          data-thread-find-skip="true"
          onClick={() => setExpanded((value) => !value)}
        >
          <span>{expanded ? "收起" : "显示更多"}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
