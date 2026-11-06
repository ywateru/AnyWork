import { useEffect, useId, useRef, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";
import type { Api } from "../../api";
import type { FileTarget } from "../../fileLinks";
import ImagePreview from "../ImagePreview";
import PromptEditor, { type PromptEditorHandle } from "./PromptEditor";
import "./UserMessageEditor.css";

export default function UserMessageEditor({
  initialText,
  attachments = [],
  api,
  sessionId,
  onOpenFile,
  onCancel,
  onSubmit,
  disabled = false,
  readOnly = false,
  submitLabel = "发送",
  onDraftChange,
  externalError,
}: {
  initialText: string;
  attachments?: string[];
  api: Api;
  sessionId: string;
  onOpenFile: (target: FileTarget) => void;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void>;
  disabled?: boolean;
  readOnly?: boolean;
  submitLabel?: string;
  onDraftChange?: (text: string) => void;
  externalError?: string;
}) {
  const [draft, setDraft] = useState(initialText);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<PromptEditorHandle>(null);
  const lifetime = useRef(0);
  const inFlight = useRef(false);
  const composing = useRef(false);
  const compositionEndedAt = useRef(-Infinity);
  const errorId = useId();
  const busy = disabled || submitting;
  const displayedError = externalError || error;
  const canSubmit = !!draft.trim() || attachments.length > 0;

  useEffect(() => {
    lifetime.current++;
    return () => {
      lifetime.current++;
    };
  }, []);

  async function submit() {
    if (
      busy ||
      inFlight.current ||
      !canSubmit ||
      composing.current ||
      input.current?.isComposing() ||
      performance.now() - compositionEndedAt.current < 100
    )
      return;
    inFlight.current = true;
    setSubmitting(true);
    setError("");
    const version = lifetime.current;
    try {
      // An uncertain retry must reuse the already submitted bytes exactly.
      await onSubmit(
        readOnly ? draft : (input.current?.getText() ?? draft).trim(),
      );
    } catch {
      if (version === lifetime.current) setError("无法编辑消息");
    } finally {
      if (version === lifetime.current) {
        inFlight.current = false;
        setSubmitting(false);
      }
    }
  }

  return (
    <form
      className="user-message-editor"
      aria-label="编辑消息"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDownCapture={(event) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          event.repeat ||
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229 ||
          composing.current ||
          performance.now() - compositionEndedAt.current < 100 ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          busy ||
          inFlight.current
        )
          return;
        // An image dialog or another active overlay owns its own Escape.
        if (
          Array.from(
            document.querySelectorAll<HTMLElement>(
              '[role="dialog"], [role="menu"], dialog[open]',
            ),
          ).some(
            (element) =>
              element.getClientRects().length > 0 &&
              getComputedStyle(element).visibility !== "hidden",
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <div className="user-message-editor-body">
        {attachments.length > 0 && (
          <div
            className="user-message-editor-attachments"
            aria-label="原有附件"
          >
            <p>原有附件将保留</p>
            <div>
              {attachments.map((path, index) =>
                /\.(png|jpe?g|webp|gif)$/iu.test(path) ||
                path.startsWith("data:image/") ? (
                  <ImagePreview
                    key={`${index}/${path}`}
                    api={api}
                    sessionId={sessionId}
                    path={path}
                    compact
                  />
                ) : (
                  <button
                    type="button"
                    className="user-message-editor-file"
                    key={`${index}/${path}`}
                    title={path}
                    onClick={() => onOpenFile({ path })}
                  >
                    <FileText size={15} aria-hidden="true" />
                    <span>{path.split("/").pop()}</span>
                  </button>
                ),
              )}
            </div>
          </div>
        )}
        <PromptEditor
          ref={input}
          label="编辑消息"
          placeholder="编辑消息"
          value={draft}
          autoFocus
          disabled={busy}
          readOnly={readOnly}
          invalid={!!displayedError}
          describedBy={displayedError ? errorId : undefined}
          onSubmit={() => void submit()}
          onChange={(text) => {
            if (readOnly) return;
            setDraft(text);
            onDraftChange?.(text);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            compositionEndedAt.current = performance.now();
          }}
        />
        {displayedError && (
          <p className="user-message-editor-error" id={errorId} role="alert">
            {displayedError}
          </p>
        )}
      </div>
      <div className="user-message-editor-actions">
        <button
          type="button"
          className="user-message-editor-cancel"
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="submit"
          className="user-message-editor-submit"
          disabled={busy || !canSubmit}
        >
          {busy && (
            <LoaderCircle
              size={14}
              className="user-message-editor-spinner"
              aria-hidden="true"
            />
          )}
          <span>{submitLabel}</span>
        </button>
      </div>
    </form>
  );
}
