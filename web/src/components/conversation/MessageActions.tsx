import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  Download,
  LoaderCircle,
  MoreHorizontal,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from "lucide-react";
import type { Api } from "../../api";
import "./MessageActions.css";

interface Feedback {
  message_id: string;
  rating: "good" | "bad";
  tags: string[];
  text: string | null;
}
const tagLabels = {
  "incorrect-or-incomplete": "不正确或不完整",
  "not-what-i-asked-for": "不是我想要的",
  "slow-or-buggy": "响应慢或有错误",
  "style-or-tone": "风格或语气",
  "safety-or-legal-concern": "安全或法律问题",
  other: "其他",
};
const feedbackCache = new WeakMap<Api, Map<string, Promise<Feedback[]>>>();
function feedbackFor(api: Api, sessionId: string) {
  let sessions = feedbackCache.get(api);
  if (!sessions) {
    sessions = new Map();
    feedbackCache.set(api, sessions);
  }
  let result = sessions.get(sessionId);
  if (!result) {
    result = api
      .request<{ feedback: Feedback[] }>(`/sessions/${sessionId}/feedback`)
      .then((value) => value.feedback);
    sessions.set(sessionId, result);
    result.catch(() => {
      if (sessions?.get(sessionId) === result) sessions.delete(sessionId);
    });
  }
  return result;
}

export default function MessageActions({
  api,
  sessionId,
  messageId,
  markdown,
  content,
}: {
  api: Api;
  sessionId: string;
  messageId: string;
  markdown: string;
  content: RefObject<HTMLDivElement | null>;
}) {
  const [feedback, setFeedback] = useState<Feedback | null>(null),
    [menu, setMenu] = useState<"rating" | "more" | null>(null),
    [dialog, setDialog] = useState<"good" | "bad" | null>(null),
    [tags, setTags] = useState<string[]>([]),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [copied, setCopied] = useState(false),
    [position, setPosition] = useState({ top: 0, left: 0 });
  const ratingButton = useRef<HTMLButtonElement>(null),
    moreButton = useRef<HTMLButtonElement>(null),
    menuNode = useRef<HTMLDivElement>(null),
    dialogNode = useRef<HTMLDivElement>(null),
    feedbackReturn = useRef<HTMLButtonElement | null>(null),
    alive = useRef(true),
    identity = useRef(`${sessionId}/${messageId}`),
    inFlight = useRef(false),
    operation = useRef(0),
    copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    headingId = useId(),
    descriptionId = useId();
  identity.current = `${sessionId}/${messageId}`;
  useEffect(() => {
    alive.current = true;
    const key = identity.current,
      version = ++operation.current;
    setFeedback(null);
    setMenu(null);
    setDialog(null);
    setError("");
    setNotice("");
    setBusy(false);
    inFlight.current = false;
    feedbackFor(api, sessionId)
      .then((records) => {
        if (
          alive.current &&
          identity.current === key &&
          operation.current === version
        )
          setFeedback(
            records.find((record) => record.message_id === messageId) || null,
          );
      })
      .catch(() => {
        /* Feedback remains available for an explicit save/retry. */
      });
    return () => {
      alive.current = false;
      operation.current++;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [api, sessionId, messageId]);
  const plainText = () =>
    (content.current?.innerText || content.current?.textContent || "").trim();
  function closeMenu(restore = false) {
    const target =
      menu === "rating" ? ratingButton.current : moreButton.current;
    setMenu(null);
    if (restore) target?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!menu) return;
    const trigger =
      menu === "rating" ? ratingButton.current : moreButton.current;
    const place = () => {
      const anchor = trigger?.getBoundingClientRect(),
        panel = menuNode.current;
      if (!anchor || !panel) return;
      const width = panel.offsetWidth,
        height = panel.offsetHeight;
      setPosition({
        left: Math.max(8, Math.min(anchor.left, innerWidth - width - 8)),
        top: Math.max(8, Math.min(anchor.bottom + 5, innerHeight - height - 8)),
      });
    };
    place();
    menuNode.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const pointer = (event: Event) => {
      if (
        !menuNode.current?.contains(event.target as Node) &&
        !trigger?.contains(event.target as Node)
      )
        setMenu(null);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(null);
        trigger?.focus();
        return;
      }
      if (event.key === "Tab") {
        setMenu(null);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const options = Array.from(
        menuNode.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) || [],
      );
      if (!options.length) return;
      event.preventDefault();
      const index = options.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : (index + (event.key === "ArrowUp" ? -1 : 1) + options.length) %
              options.length;
      options[next].focus();
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("focusin", pointer);
    document.addEventListener("keydown", keys);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("focusin", pointer);
      document.removeEventListener("keydown", keys);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [menu]);
  useEffect(() => {
    if (!dialog) return;
    const beforeOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogNode.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!inFlight.current) setDialog(null);
      }
      if (event.key !== "Tab") return;
      const options = Array.from(
        dialogNode.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), textarea:not(:disabled), [tabindex='0']",
        ) || [],
      );
      if (!options.length) {
        event.preventDefault();
        dialogNode.current?.focus();
        return;
      }
      const first = options[0],
        last = options[options.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.body.style.overflow = beforeOverflow;
      document.removeEventListener("keydown", keys);
      if (alive.current) {
        const target = feedbackReturn.current;
        if (target?.isConnected) target.focus({ preventScroll: true });
        else ratingButton.current?.focus({ preventScroll: true });
      }
    };
  }, [dialog]);
  async function copy(raw = false) {
    setError("");
    const key = identity.current;
    try {
      await navigator.clipboard.writeText(raw ? markdown : plainText());
      if (!alive.current || identity.current !== key) return;
      setCopied(true);
      setNotice(raw ? "已复制 Markdown" : "已复制回答");
      if (menu) closeMenu(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => {
        if (alive.current && identity.current === key) setCopied(false);
      }, 1600);
    } catch {
      if (alive.current && identity.current === key)
        setError("复制失败。请允许此页面使用剪贴板后重试。");
    }
  }
  function editFeedback(rating: "good" | "bad") {
    feedbackReturn.current = moreButton.current;
    setTags(
      feedback?.tags
        .map(
          (tag) =>
            ({
              incorrect: "incorrect-or-incomplete",
              incomplete: "incorrect-or-incomplete",
              unhelpful: "not-what-i-asked-for",
            })[tag] || tag,
        )
        .filter((tag) => Object.hasOwn(tagLabels, tag))
        .slice(0, 1) || [],
    );
    setText(feedback?.text || "");
    setError("");
    setMenu(null);
    setDialog(rating);
  }
  async function saveFeedback(
    remove = false,
    rating?: "good" | "bad",
    openDetails = false,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const key = identity.current,
      version = ++operation.current;
    const path = `/sessions/${sessionId}/feedback/${encodeURIComponent(messageId)}`;
    try {
      const result = await api.request<{ feedback: Feedback }>(path, {
        method: remove ? "DELETE" : "PUT",
        ...(remove
          ? {}
          : {
              body: JSON.stringify({
                rating: rating || dialog,
                tags: rating ? [] : tags,
                text: rating ? null : text.trim() || null,
              }),
            }),
      });
      feedbackCache.get(api)?.delete(sessionId);
      if (
        !alive.current ||
        identity.current !== key ||
        operation.current !== version
      )
        return;
      setFeedback(remove ? null : result.feedback);
      setDialog(openDetails ? "bad" : null);
      setMenu(null);
      setNotice(remove ? "已移除本地评价" : "评价已保存到本地工作空间");
      ratingButton.current?.focus();
    } catch (e) {
      if (
        alive.current &&
        identity.current === key &&
        operation.current === version
      )
        setError(e instanceof Error ? e.message : "评价未保存，请重试。");
    } finally {
      if (
        alive.current &&
        identity.current === key &&
        operation.current === version
      ) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  function download() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "AnyWork-answer.md";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    closeMenu(true);
    setNotice("已下载回答");
  }
  return (
    <>
      <div className="message-actions answer-actions" aria-label="回答操作">
        <button
          type="button"
          title={copied ? "已复制" : "复制回答"}
          aria-label="复制回答"
          onClick={() => void copy()}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
        <button
          ref={ratingButton}
          type="button"
          title={
            feedback
              ? `移除“${feedback.rating === "good" ? "回复优秀" : "回复不佳"}”反馈`
              : "评价回复"
          }
          aria-label={
            feedback
              ? `移除“${feedback.rating === "good" ? "回复优秀" : "回复不佳"}”反馈`
              : "评价回复"
          }
          aria-haspopup={feedback ? undefined : "menu"}
          aria-expanded={!feedback && menu === "rating"}
          disabled={busy}
          className={feedback ? "answer-rating-selected" : ""}
          onClick={() =>
            feedback
              ? void saveFeedback(true)
              : setMenu(menu === "rating" ? null : "rating")
          }
        >
          {busy ? (
            <LoaderCircle size={16} className="answer-action-spinner" />
          ) : feedback?.rating === "good" ? (
            <ThumbsUp size={16} fill="currentColor" />
          ) : feedback?.rating === "bad" ? (
            <ThumbsDown size={16} fill="currentColor" />
          ) : (
            <span className="answer-rating-pair" aria-hidden="true">
              <ThumbsUp size={12} />
              <ThumbsDown size={12} />
            </span>
          )}
        </button>
        <button
          type="button"
          title="朗读"
          aria-label="朗读"
          onClick={() => {
            setError("");
            setNotice(
              "此版本尚未提供朗读。可以先复制回答，使用设备的朗读功能。",
            );
          }}
        >
          <Volume2 size={16} />
        </button>
        <button
          ref={moreButton}
          type="button"
          title="更多回答操作"
          aria-label="更多回答操作"
          aria-haspopup="menu"
          aria-expanded={menu === "more"}
          onClick={() => setMenu(menu === "more" ? null : "more")}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      <div
        className={`answer-action-notice${notice.startsWith("此版本") ? " is-unavailable" : ""}`}
        role="status"
        aria-live="polite"
      >
        {notice}
      </div>
      {error && !dialog && (
        <div className="answer-action-error" role="alert">
          {error}
          {feedback && !error.startsWith("复制") && (
            <button onClick={() => void saveFeedback(true)} disabled={busy}>
              重试移除评价
            </button>
          )}
        </div>
      )}
      {menu &&
        createPortal(
          <div
            ref={menuNode}
            className="answer-action-menu"
            role="menu"
            aria-label={menu === "rating" ? "评价回复" : "更多回答操作"}
            style={{ position: "fixed", ...position }}
          >
            {menu === "rating" ? (
              <>
                <button
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void saveFeedback(false, "good")}
                >
                  <ThumbsUp size={16} />
                  回复优秀
                </button>
                <button
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    feedbackReturn.current = ratingButton.current;
                    setTags([]);
                    setText("");
                    void saveFeedback(false, "bad", true);
                  }}
                >
                  <ThumbsDown size={16} />
                  回复不佳
                </button>
                <p>仅保存到 AnyWork 本地工作空间</p>
              </>
            ) : (
              <>
                <button role="menuitem" onClick={() => void copy(true)}>
                  <Copy size={16} />
                  复制 Markdown
                </button>
                <button role="menuitem" onClick={download}>
                  <Download size={16} />
                  下载回答
                </button>
                {feedback && (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => editFeedback(feedback.rating)}
                    >
                      编辑本地评价
                    </button>
                    <button
                      role="menuitem"
                      disabled={busy}
                      onClick={() => void saveFeedback(true)}
                    >
                      移除本地评价
                    </button>
                  </>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
      {dialog &&
        createPortal(
          <div
            className="answer-feedback-backdrop"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget && !inFlight.current)
                setDialog(null);
            }}
          >
            <div
              ref={dialogNode}
              className="answer-feedback-dialog"
              role="dialog"
              tabIndex={-1}
              aria-modal="true"
              aria-labelledby={headingId}
              aria-describedby={descriptionId}
            >
              <button
                className="answer-feedback-close"
                aria-label="关闭评价"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                <X size={18} />
              </button>
              <h2 id={headingId}>提交反馈</h2>

              <div
                className="answer-feedback-tags"
                role="radiogroup"
                aria-label="反馈选项"
              >
                {Object.entries(tagLabels).map(
                  ([value, label], index, entries) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={tags.includes(value)}
                      tabIndex={
                        tags.length
                          ? tags.includes(value)
                            ? 0
                            : -1
                          : index === 0
                            ? 0
                            : -1
                      }
                      disabled={busy}
                      onClick={() => setTags([value])}
                      onKeyDown={(event) => {
                        if (
                          ![
                            "ArrowLeft",
                            "ArrowRight",
                            "ArrowUp",
                            "ArrowDown",
                            "Home",
                            "End",
                          ].includes(event.key)
                        )
                          return;
                        event.preventDefault();
                        const next =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? entries.length - 1
                              : (index +
                                  (["ArrowLeft", "ArrowUp"].includes(event.key)
                                    ? -1
                                    : 1) +
                                  entries.length) %
                                entries.length;
                        setTags([entries[next][0]]);
                        event.currentTarget.parentElement
                          ?.querySelectorAll<HTMLButtonElement>("button")
                          [next]?.focus();
                      }}
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
              <textarea
                aria-label="其他反馈"
                value={text}
                disabled={busy}
                placeholder="填写详情（选填）"
                onChange={(event) =>
                  setText(
                    Array.from(event.target.value).slice(0, 4000).join(""),
                  )
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.keyCode !== 229 &&
                    (tags.length || text.trim())
                  ) {
                    event.preventDefault();
                    void saveFeedback();
                  }
                }}
              />
              <div className="answer-feedback-limit">
                {Array.from(text).length}/4000
              </div>
              <p id={descriptionId}>
                评价仅保存到 AnyWork
                本地工作空间，不发送给模型服务商。安全或法律问题也只在本地记录。
              </p>
              {error && (
                <div className="answer-action-error" role="alert">
                  {error}
                </div>
              )}
              <div className="answer-feedback-footer">
                <button disabled={busy} onClick={() => setDialog(null)}>
                  取消
                </button>
                <button
                  className="answer-feedback-submit"
                  disabled={busy || (!tags.length && !text.trim())}
                  onClick={() => void saveFeedback()}
                >
                  {busy ? (
                    <>
                      <LoaderCircle
                        size={15}
                        className="answer-action-spinner"
                      />
                      正在保存…
                    </>
                  ) : (
                    "提交"
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
