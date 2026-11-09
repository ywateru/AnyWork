import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  HelpCircle,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { Api } from "../api";
import type { AgentEvent } from "../types";
import {
  approvalPresentation,
  approvalReasonParts,
  questionResponse,
  requestQuestions,
  type ApprovalAction,
} from "../requests";
import "./requests.css";

interface RequestCardProps {
  event: AgentEvent;
  api: Api;
  onError: (e: unknown) => void;
  relatedEvents?: AgentEvent[];
}

// A reused numeric request ID in another session must start a fresh UI lifetime.
export default function RequestCard(props: RequestCardProps) {
  return (
    <RequestCardContent
      key={JSON.stringify([
        props.api.connection.scope ?? props.api.connection.url,
        props.api.connection.token,
        props.event.session_id,
        props.event.method,
        props.event.request_id,
        props.event.seq,
      ])}
      {...props}
    />
  );
}

function ApprovalText({ value }: { value: string }) {
  return (
    <>
      {approvalReasonParts(value).map((part, index) =>
        part.href ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

const editableSelector =
  "input, textarea, select, [contenteditable]:not([contenteditable='false' i]), [role='textbox'], [role='combobox']";
const pendingSelector = '.codex-request[data-request-pending="true"]';
const hasOpenOverlay = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], dialog[open], [aria-haspopup][aria-expanded="true"], details[data-floating-menu][open], .session-menu[open], .header-tools-menu[open], .navigation-options[open], details[open] > .queue-menu',
    ),
  ).some(
    (element) =>
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden",
  );

function RequestCardContent({
  event,
  api,
  onError,
  relatedEvents = [],
}: RequestCardProps) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({}),
    [json, setJson] = useState("{}"),
    [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [error, setError] = useState(""),
    [optionsOpen, setOptionsOpen] = useState(false),
    [optionIndex, setOptionIndex] = useState(0),
    [optionPosition, setOptionPosition] = useState<CSSProperties>({}),
    [selectedAction, setSelectedAction] = useState(""),
    [loadedFileItem, setLoadedFileItem] = useState<Record<
      string,
      unknown
    > | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState("");
  const titleId = useId(),
    surface = useRef<HTMLElement>(null),
    approveButton = useRef<HTMLButtonElement>(null),
    optionsButton = useRef<HTMLButtonElement>(null),
    optionsMenu = useRef<HTMLDivElement>(null),
    inFlight = useRef(false),
    detailController = useRef<AbortController | null>(null),
    lifetime = useRef(0),
    composing = useRef(false),
    compositionEndedAt = useRef(-Infinity),
    approval = event.method.endsWith("/requestApproval"),
    presentation = approvalPresentation(event, relatedEvents, loadedFileItem),
    actions = presentation.actions,
    menuActions = [actions.primary, actions.scoped].filter(
      (action): action is ApprovalAction => !!action,
    ),
    questions = requestQuestions(event.params.questions),
    canAnswer = questions.every((q) => answers[q.id]?.some((a) => a.trim()));
  useEffect(() => {
    lifetime.current++;
    if (
      !document.activeElement?.closest(editableSelector) &&
      !hasOpenOverlay() &&
      document.querySelectorAll(pendingSelector).length === 1
    )
      (approval
        ? actions.primary
          ? approveButton.current
          : optionsButton.current || surface.current
        : surface.current
      )?.focus({
        preventScroll: true,
      });
    return () => {
      lifetime.current++;
      detailController.current?.abort();
    };
  }, []);

  async function loadFileDetails() {
    if (detailController.current || !presentation.detailQuery) return;
    const controller = new AbortController();
    detailController.current = controller;
    const version = lifetime.current;
    setDetailLoading(true);
    setDetailError("");
    try {
      const { item } = await api.request<{ item: Record<string, unknown> }>(
        `/sessions/${event.session_id}/history/item?${presentation.detailQuery}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || version !== lifetime.current) return;
      if (
        !item ||
        item.id !== event.params.itemId ||
        item.type !== "fileChange"
      )
        throw new Error("返回的文件变更与当前审批不匹配，请重试。");
      const changes = approvalPresentation(
        event,
        relatedEvents,
        item,
      ).fileChanges;
      if (!changes.length || changes.some((change) => !change.diff))
        throw new Error("文件变更详情仍不完整，请重试。");
      setLoadedFileItem(item);
    } catch (e) {
      if (!controller.signal.aborted && version === lifetime.current)
        setDetailError(e instanceof Error ? e.message : String(e));
    } finally {
      if (version === lifetime.current) {
        detailController.current = null;
        setDetailLoading(false);
      }
    }
  }
  async function reply(data: Record<string, unknown>) {
    if (inFlight.current || submitted) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const version = lifetime.current;
    try {
      await api.post(`/sessions/${event.session_id}/respond`, {
        request_id: event.request_id,
        ...data,
      });
      if (version === lifetime.current) setSubmitted(true);
    } catch (e) {
      if (version === lifetime.current) {
        setError(e instanceof Error ? e.message : String(e));
        onError(e);
      }
    } finally {
      if (version === lifetime.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  const disabled = busy || submitted;
  const closeOptions = (restoreFocus = false) => {
    setOptionsOpen(false);
    if (restoreFocus) optionsButton.current?.focus({ preventScroll: true });
  };
  const choose = (action: ApprovalAction | null) => {
    if (!action || disabled || inFlight.current) return;
    setSelectedAction(action.id);
    closeOptions();
    void reply(action.body);
  };
  useLayoutEffect(() => {
    if (!optionsOpen) return;
    const place = () => {
      const anchor = optionsButton.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(300, window.innerWidth - 24);
      setOptionPosition({
        position: "fixed",
        width,
        left: Math.max(
          12,
          Math.min(anchor.right - width, window.innerWidth - width - 12),
        ),
        bottom: window.innerHeight - anchor.top + 6,
        maxHeight: Math.max(80, anchor.top - 18),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [optionsOpen]);
  useEffect(() => {
    if (!optionsOpen) return;
    optionsMenu.current
      ?.querySelectorAll<HTMLElement>('[role="menuitem"]')
      [optionIndex]?.focus();
  }, [optionsOpen, optionIndex]);
  useEffect(() => {
    if (!optionsOpen) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (
        !optionsMenu.current?.contains(target) &&
        !optionsButton.current?.contains(target)
      )
        closeOptions();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [optionsOpen]);
  useEffect(() => {
    if (!approval || disabled) return;
    const startComposition = () => {
      composing.current = true;
    };
    const endComposition = () => {
      composing.current = false;
      compositionEndedAt.current = performance.now();
    };
    const keys = (key: KeyboardEvent) => {
      if (
        !["Enter", "Escape"].includes(key.key) ||
        key.defaultPrevented ||
        key.repeat ||
        key.isComposing ||
        key.keyCode === 229 ||
        composing.current ||
        performance.now() - compositionEndedAt.current < 100 ||
        key.altKey ||
        key.ctrlKey ||
        key.metaKey ||
        key.shiftKey ||
        inFlight.current ||
        hasOpenOverlay() ||
        document.querySelectorAll(pendingSelector).length !== 1
      )
        return;
      const active = document.activeElement;
      if (active?.closest(editableSelector)) return;
      // Preserve native Enter on Deny, links and other focused controls.
      if (
        active?.closest("button, a[href], summary, [role='button']") &&
        active !== approveButton.current &&
        !(key.key === "Escape" && surface.current?.contains(active))
      )
        return;
      const action = key.key === "Enter" ? actions.primary : actions.deny;
      if (!action) return;
      key.preventDefault();
      choose(action);
    };
    document.addEventListener("keydown", keys);
    document.addEventListener("compositionstart", startComposition);
    document.addEventListener("compositionend", endComposition);
    return () => {
      document.removeEventListener("keydown", keys);
      document.removeEventListener("compositionstart", startComposition);
      document.removeEventListener("compositionend", endComposition);
    };
  }, [approval, disabled, api, event, onError, actions.primary, actions.deny]);
  return (
    <section
      ref={surface}
      className="request-card codex-request"
      data-codex-approval-surface={approval || undefined}
      data-request-pending={!submitted}
      aria-labelledby={titleId}
      aria-busy={busy}
      tabIndex={-1}
    >
      <div className="request-body">
        <div className="request-heading" role="alert" aria-atomic="true">
          {approval ? <ShieldCheck size={18} /> : <HelpCircle size={18} />}
          <div>
            {approval && (
              <span className="request-identity">{presentation.identity}</span>
            )}
            <h3 id={titleId}>
              {approval ? (
                <ApprovalText value={presentation.title} />
              ) : (
                "Agent 需要你的回答"
              )}
            </h3>
            {approval ? (
              presentation.subtitle && (
                <p className="request-subtitle">
                  <ApprovalText value={presentation.subtitle} />
                </p>
              )
            ) : (
              <span className="request-identity">
                {questions.length || 1} 个问题
              </span>
            )}
          </div>
        </div>
        {approval ? (
          <dl className="request-details">
            {presentation.details.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd>
                  {detail.code ? <code>{detail.value}</code> : detail.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : !questions.length ? (
          <p className="request-description">
            {typeof event.params.message === "string"
              ? event.params.message
              : "查看请求详情，并填写此工具需要的响应。"}
          </p>
        ) : null}
        {approval && presentation.rawPermissions && (
          <details className="request-raw">
            <summary>查看完整权限</summary>
            <pre>{presentation.rawPermissions}</pre>
          </details>
        )}
        {approval && presentation.fileChanges.length > 0 && (
          <div className="request-file-changes" aria-label="文件变更">
            {presentation.fileChanges.map((change, index) => (
              <details
                className="request-file-change"
                key={`${change.path}-${index}`}
              >
                <summary>
                  <code>
                    {change.path}
                    {change.movePath && ` → ${change.movePath}`}
                  </code>
                  <span>
                    {(
                      { add: "新增", delete: "删除", update: "修改" } as Record<
                        string,
                        string
                      >
                    )[change.kind] || change.kind}
                  </span>
                </summary>
                {change.diff ? (
                  <pre className="request-file-diff">
                    {change.diff.split("\n").map((line, lineIndex) => (
                      <span
                        className={
                          line.startsWith("+") && !line.startsWith("+++")
                            ? "added"
                            : line.startsWith("-") && !line.startsWith("---")
                              ? "removed"
                              : undefined
                        }
                        key={lineIndex}
                      >
                        {line}
                        {"\n"}
                      </span>
                    ))}
                  </pre>
                ) : (
                  <p className="request-description">
                    变更详情尚未提供。请确认文件内容后再批准。
                  </p>
                )}
              </details>
            ))}
          </div>
        )}
        {approval && presentation.missingFileChanges && (
          <p className="request-description" role="status">
            变更详情尚未提供。请确认文件内容后再批准。
          </p>
        )}
        {approval && presentation.detailQuery && !loadedFileItem && (
          <div className="request-detail-load">
            <button
              type="button"
              className="request-deny"
              disabled={detailLoading}
              onClick={() => void loadFileDetails()}
            >
              {detailLoading && (
                <LoaderCircle size={15} className="request-spinner" />
              )}
              {detailLoading ? "正在加载变更详情…" : "加载变更详情"}
            </button>
            {detailError && (
              <p className="request-error" role="alert">
                {detailError}
              </p>
            )}
          </div>
        )}
        {approval &&
          !actions.primary &&
          !actions.scoped &&
          !actions.leading &&
          !actions.deny && (
            <p className="request-description" role="status">
              此请求未提供可用的审批操作。
            </p>
          )}
      </div>
      {approval ? (
        <form
          className="request-actions"
          onKeyDownCapture={(e) => {
            if (
              e.key === "Enter" &&
              (e.nativeEvent.isComposing ||
                e.nativeEvent.keyCode === 229 ||
                composing.current ||
                performance.now() - compositionEndedAt.current < 100 ||
                hasOpenOverlay() ||
                document.querySelectorAll(pendingSelector).length !== 1 ||
                e.repeat ||
                e.altKey ||
                e.ctrlKey ||
                e.metaKey ||
                e.shiftKey)
            )
              e.preventDefault();
          }}
          onSubmit={(e) => {
            e.preventDefault();
            choose(actions.primary);
          }}
        >
          <span className="request-scope">
            {(busy || submitted) &&
            ["session", "execpolicy"].includes(selectedAction)
              ? "此对话有效"
              : (busy || submitted) && selectedAction === "network"
                ? "按网络规则生效"
                : presentation.scopeLabel}
          </span>
          {actions.leading && (
            <button
              type="button"
              className="request-deny request-leading"
              disabled={disabled}
              onClick={() => choose(actions.leading)}
            >
              {busy && selectedAction === actions.leading.id && (
                <LoaderCircle size={15} className="request-spinner" />
              )}
              {actions.leading.label}
            </button>
          )}
          <div className="request-action-group">
            {actions.deny && (
              <button
                type="button"
                className="request-deny"
                disabled={disabled}
                onClick={() => choose(actions.deny)}
              >
                <span>{actions.deny.label}</span>
                <kbd className="request-key" aria-hidden="true">
                  Esc
                </kbd>
              </button>
            )}
            {(actions.primary || actions.scoped) && (
              <div
                className={`request-approve-group${actions.scoped ? " request-split" : ""}`}
              >
                <button
                  type="submit"
                  ref={approveButton}
                  className="request-approve"
                  disabled={disabled || !actions.primary}
                >
                  {busy && (
                    <LoaderCircle size={15} className="request-spinner" />
                  )}
                  {submitted && <Check size={15} />}
                  <span>
                    {submitted
                      ? "已提交"
                      : actions.primary?.label || presentation.approveLabel}
                  </span>
                  {!submitted && actions.primary && (
                    <kbd className="request-key" aria-hidden="true">
                      ↵
                    </kbd>
                  )}
                </button>
                {actions.scoped && (
                  <button
                    type="button"
                    ref={optionsButton}
                    className="request-approve request-options-trigger"
                    aria-label="审批选项"
                    aria-haspopup="menu"
                    aria-expanded={optionsOpen}
                    disabled={disabled}
                    onClick={() => {
                      setOptionIndex(0);
                      setOptionsOpen((open) => !open);
                    }}
                    onKeyDown={(key) => {
                      if (["ArrowUp", "ArrowDown"].includes(key.key)) {
                        key.preventDefault();
                        key.stopPropagation();
                        setOptionIndex(
                          key.key === "ArrowUp" ? menuActions.length - 1 : 0,
                        );
                        setOptionsOpen(true);
                      }
                    }}
                  >
                    <ChevronDown size={15} />
                  </button>
                )}
              </div>
            )}
          </div>
        </form>
      ) : questions.length ? (
        <form
          className="request-question-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canAnswer)
              void reply({ result: questionResponse(questions, answers) });
          }}
        >
          <div className="request-questions">
            {questions.map((q, index) => (
              <fieldset key={q.id} disabled={disabled}>
                <legend>
                  {q.header || `问题 ${index + 1}`}
                  {questions.length > 1 && (
                    <span>
                      {index + 1} / {questions.length}
                    </span>
                  )}
                </legend>
                <p>{q.question}</p>
                {q.multiple && <small>可选择多个选项</small>}
                <div className="request-options" aria-label={q.question}>
                  {q.options.map((option, optionIndex) => {
                    const selected = answers[q.id]?.includes(option.label);
                    return (
                      <button
                        type="button"
                        className={`answer${selected ? " selected" : ""}`}
                        aria-pressed={!!selected}
                        aria-label={`${option.label} ${option.description}`.trim()}
                        key={option.label}
                        onClick={() =>
                          setAnswers((old) => ({
                            ...old,
                            [q.id]: q.multiple
                              ? selected
                                ? (old[q.id] || []).filter(
                                    (v) => v !== option.label,
                                  )
                                : [...(old[q.id] || []), option.label]
                              : [option.label],
                          }))
                        }
                      >
                        <span className="request-option-number">
                          {selected ? <Check size={12} /> : optionIndex + 1}
                        </span>
                        <span>
                          <strong>{option.label}</strong>
                          {option.description && (
                            <small>{option.description}</small>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <input
                  aria-label={q.question}
                  type={q.secret ? "password" : "text"}
                  autoComplete="off"
                  required={!answers[q.id]?.some((answer) => answer.trim())}
                  value={
                    (answers[q.id] || []).filter(
                      (answer) => !q.options.some((o) => o.label === answer),
                    )[0] || ""
                  }
                  onChange={(e) =>
                    setAnswers((old) => ({ ...old, [q.id]: [e.target.value] }))
                  }
                  placeholder={
                    q.options.length ? "或输入其他回答…" : "输入回答…"
                  }
                />
              </fieldset>
            ))}
          </div>
          <div className="request-actions">
            <div className="request-action-group">
              <button
                type="submit"
                className="request-approve"
                disabled={disabled || !canAnswer}
              >
                {busy && <LoaderCircle size={15} className="request-spinner" />}
                {submitted ? "已提交" : "提交回答"}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              void reply({ result: JSON.parse(json) });
            } catch {
              setError("响应格式有误，请输入有效的 JSON。");
            }
          }}
        >
          <div className="request-custom">
            <details className="request-raw">
              <summary>查看请求详情</summary>
              <pre>{JSON.stringify(event.params, null, 2)}</pre>
            </details>
            <label>
              响应 JSON
              <textarea
                value={json}
                disabled={disabled}
                onChange={(e) => setJson(e.target.value)}
                spellCheck={false}
              />
            </label>
          </div>
          <div className="request-actions">
            <div className="request-action-group">
              <button className="request-approve" disabled={disabled}>
                {submitted ? "已提交" : "提交响应"}
              </button>
            </div>
          </div>
        </form>
      )}
      {optionsOpen &&
        createPortal(
          <div
            ref={optionsMenu}
            className="request-approval-menu"
            style={optionPosition}
            role="menu"
            aria-label="审批选项"
            onKeyDown={(key) => {
              if (
                key.nativeEvent.isComposing ||
                key.nativeEvent.keyCode === 229
              )
                return;
              if (key.key === "Escape") {
                key.preventDefault();
                key.stopPropagation();
                closeOptions(true);
              } else if (key.key === "Tab") closeOptions();
              else if (
                ["ArrowDown", "ArrowUp", "Home", "End"].includes(key.key)
              ) {
                key.preventDefault();
                key.stopPropagation();
                setOptionIndex((old) =>
                  key.key === "Home"
                    ? 0
                    : key.key === "End"
                      ? menuActions.length - 1
                      : (old +
                          (key.key === "ArrowDown" ? 1 : -1) +
                          menuActions.length) %
                        menuActions.length,
                );
              }
            }}
          >
            {menuActions.map((action, index) => (
              <button
                type="button"
                role="menuitem"
                aria-label={action.label}
                aria-description={action.description}
                key={action.id}
                tabIndex={index === optionIndex ? 0 : -1}
                disabled={disabled}
                onClick={() => choose(action)}
                title={action.description}
              >
                <span>{action.label}</span>
                {action.description && <small>{action.description}</small>}
              </button>
            ))}
          </div>,
          document.body,
        )}
      {error && (
        <p className="request-error" role="alert">
          {error}。请重试。
        </p>
      )}
      {submitted && (
        <p className="request-submitted" role="status">
          已发送回应，等待 Agent 继续…
        </p>
      )}
    </section>
  );
}
