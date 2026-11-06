import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, Copy, Pencil } from "lucide-react";
import { formatMessageTime } from "../../messageTime";
import { withFullUserMessageContent } from "../../userMessageCollapse";

export default function UserMessageActions({
  sessionId,
  messageId,
  text,
  createdAtMs,
  content,
  onEdit,
}: {
  sessionId: string;
  messageId: string;
  text: string;
  createdAtMs?: number;
  content: RefObject<HTMLDivElement | null>;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0),
    copying = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    generation.current++;
    copying.current = false;
    setCopied(false);
    setError("");
    return () => {
      generation.current++;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [sessionId, messageId]);
  async function copy() {
    if (copying.current || copied) return;
    copying.current = true;
    setError("");
    const version = generation.current;
    try {
      const snapshot = withFullUserMessageContent(content.current, () => ({
        plain: (
          content.current?.innerText ||
          content.current?.textContent ||
          text
        ).trim(),
        html: content.current?.cloneNode(true) as HTMLElement | undefined,
      }));
      const { plain, html } = snapshot;
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        const fallback = document.createElement("div");
        fallback.textContent = plain;
        html
          ?.querySelectorAll('svg, button, [data-markdown-copy="exclude"]')
          .forEach((node) => node.remove());
        html?.querySelectorAll("[inert], [aria-hidden]").forEach((node) => {
          node.removeAttribute("inert");
          node.removeAttribute("aria-hidden");
        });
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([plain], { type: "text/plain" }),
            "text/html": new Blob([html?.outerHTML || fallback.outerHTML], {
              type: "text/html",
            }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      if (generation.current !== version) return;
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      if (generation.current === version)
        setError("复制失败，请允许浏览器访问剪贴板后重试。");
    } finally {
      if (generation.current === version) copying.current = false;
    }
  }
  if (!text.trim() && !onEdit) return null;
  const time = formatMessageTime(createdAtMs);
  return (
    <>
      <div className="user-message-footer">
        {time && (
          <time
            className="user-message-time"
            dateTime={new Date(createdAtMs!).toISOString()}
          >
            {time}
          </time>
        )}
        {text.trim() && (
          <button
            type="button"
            aria-label={copied ? "已复制" : "复制消息"}
            title={copied ? "已复制" : "复制消息"}
            onClick={() => void copy()}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            aria-label="编辑消息"
            title="编辑消息"
            onClick={onEdit}
          >
            <Pencil size={16} />
          </button>
        )}
      </div>
      {error && (
        <div className="user-message-copy-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
