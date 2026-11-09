import { memo, useEffect, useRef, useState } from "react";
import { TerminalSquare, FileText } from "lucide-react";
import type { Api } from "../../api";
import type { Message } from "../../types";
import type { FileTarget } from "../../fileLinks";
import { toolPresentation } from "../../toolPresentation";
import Markdown from "../Markdown";
import ImageActivity from "../ImageActivity";
import ImagePreview from "../ImagePreview";
import MessageActions from "./MessageActions";
import UserMessageActions from "./UserMessageActions";
import UserMessageText from "./UserMessageText";
import UserMessageEditor from "./UserMessageEditor";
import ToolResult from "./ToolResult";
import { ReasoningRow } from "../harness/ReasoningRow";
import { ToolIcon } from "../harness/ToolIcon";
import { ToolRow } from "../harness/ToolRow";
import { toolRowModel } from "../harness/toolRowModel";
import {
  UserContent,
  assistantBodyClass,
  assistantMarkdownClass,
  assistantActionsClass,
} from "../harness/MessageContent";
export default memo(function ConversationMessage({
  message,
  api,
  sessionId,
  cwd,
  onOpenFile,
  imageGallery,
  canEditMessage = false,
  onEditMessage,
  editBusy = false,
  editing,
  editorInitialText,
  editorError,
  editorReadOnly,
  editorSubmitLabel,
  showReasoning = false,
  onEditingChange,
  onEditDraftChange,
}: {
  message: Message;
  api: Api;
  sessionId: string;
  cwd: string;
  imageGallery?: string[];
  onOpenFile: (target: FileTarget) => void;
  canEditMessage?: boolean;
  onEditMessage?: (message: Message, text: string) => Promise<void>;
  editBusy?: boolean;
  editing?: boolean;
  editorInitialText?: string;
  editorError?: string;
  editorReadOnly?: boolean;
  editorSubmitLabel?: string;
  showReasoning?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onEditDraftChange?: (text: string) => void;
}) {
  const markdownContent = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);
  const identity = JSON.stringify([
    api.connection.scope ?? api.connection.url,
    api.connection.token,
    sessionId,
    message.id,
  ]);
  const liveIdentity = useRef(identity);
  liveIdentity.current = identity;
  const identityVersion = useRef({ identity, version: 0 });
  if (identityVersion.current.identity !== identity)
    identityVersion.current = {
      identity,
      version: identityVersion.current.version + 1,
    };
  const mounted = useRef(false);
  const [editingIdentity, setEditingIdentity] = useState<string | null>(null);
  const isEditing =
    message.role === "user" && (editing ?? editingIdentity === identity);
  const canEdit =
    message.role === "user" && canEditMessage && !!onEditMessage && !editBusy;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function changeEditing(value: boolean) {
    const version = identityVersion.current.version;
    setEditingIdentity(value ? identity : null);
    onEditingChange?.(value);
    if (!value)
      requestAnimationFrame(() => {
        if (
          mounted.current &&
          liveIdentity.current === identity &&
          identityVersion.current.version === version
        )
          article.current
            ?.querySelector<HTMLButtonElement>('button[aria-label="编辑消息"]')
            ?.focus({ preventScroll: true });
      });
  }
  async function submitEdit(text: string) {
    if (!onEditMessage) throw new Error("无法编辑消息");
    const submissionIdentity = identity;
    const version = identityVersion.current.version;
    await onEditMessage(message, text);
    if (
      mounted.current &&
      liveIdentity.current === submissionIdentity &&
      identityVersion.current.version === version
    )
      changeEditing(false);
  }
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<Record<string, any> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [retryDetail, setRetryDetail] = useState(0);
  const detailQuery = message.item?.history_detail
    ? new URLSearchParams(message.item.history_detail).toString()
    : "";
  useEffect(() => {
    if (!expanded || !detailQuery || detail) return;
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError("");
    api
      .request(`/sessions/${sessionId}/history/item?${detailQuery}`, {
        signal: controller.signal,
      })
      .then((data) => {
        if (!controller.signal.aborted) setDetail(data.item);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setDetailError(e instanceof Error ? e.message : "工具结果加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [expanded, detailQuery, detail, api, sessionId, retryDetail]);

  const tool = toolPresentation(message.item);
  if (message.item?.type === "imageView" && (message.item.path || detail?.path))
    return (
      <ImageActivity
        api={api}
        sessionId={sessionId}
        path={message.item.path || detail?.path}
        messageId={message.id}
        gallery={imageGallery}
        paths={message.item.paths}
      />
    );
  if (message.role === "tool")
    return (
      <ToolRow
        id={message.id}
        icon={<ToolIcon item={message.item} />}
        {...toolRowModel(message.item)}
        open={expanded}
        onOpenChange={setExpanded}
      >
        {expanded &&
          (detailLoading ? (
            <div className="tool-loading" role="status">
              正在加载工具结果…
            </div>
          ) : detailError ? (
            <div className="tool-loading" role="alert">
              {detailError}
              <button onClick={() => setRetryDetail((n) => n + 1)}>重试</button>
            </div>
          ) : (
            <div className="tool-result">
              {message.item?.command && (
                <div className="tool-command">
                  <TerminalSquare size={12} />
                  <code>{message.item.command}</code>
                </div>
              )}
              <ToolResult
                item={{ ...message.item, ...detail }}
                output={detail?.aggregatedOutput ?? message.text}
                api={api}
                sessionId={sessionId}
                cwd={cwd}
                onOpenFile={onOpenFile}
              />
            </div>
          ))}
      </ToolRow>
    );
  if (message.role === "reasoning")
    return showReasoning ? (
      <div data-message-id={message.id}>
        <ReasoningRow key={identity} text={message.text} running={tool.running}>
          <Markdown
            text={message.text}
            api={api}
            sessionId={sessionId}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        </ReasoningRow>
      </div>
    ) : null;
  if (message.role === "error")
    return (
      <div className="message-error" role="alert">
        {message.text}
      </div>
    );
  if (isEditing)
    return (
      <article
        ref={article}
        className="message user user-message-editing"
        data-message-id={message.id}
      >
        <UserMessageEditor
          key={identity}
          initialText={editorInitialText ?? message.text}
          attachments={message.attachments}
          api={api}
          sessionId={sessionId}
          onOpenFile={onOpenFile}
          onCancel={() => changeEditing(false)}
          onSubmit={submitEdit}
          disabled={editBusy}
          onDraftChange={onEditDraftChange}
          externalError={editorError}
          readOnly={editorReadOnly}
          submitLabel={editorSubmitLabel}
        />
      </article>
    );
  const attachments = message.attachments?.length ? (
    <>
      {message.attachments?.length ? (
        <div className="message-images">
          {message.attachments
            .filter(
              (path) =>
                /\.(png|jpe?g|webp|gif)$/i.test(path) ||
                path.startsWith("data:image/"),
            )
            .map((path) => (
              <ImagePreview
                key={path}
                api={api}
                sessionId={sessionId}
                path={path}
              />
            ))}
        </div>
      ) : null}
      {message.attachments
        ?.filter(
          (path) =>
            !/\.(png|jpe?g|webp|gif)$/i.test(path) &&
            !path.startsWith("data:image/"),
        )
        .map((path) => (
          <button
            className="message-file-attachment"
            key={path}
            onClick={() => onOpenFile({ path })}
          >
            <FileText size={15} />
            {path.split("/").pop()}
          </button>
        ))}
    </>
  ) : undefined;
  return (
    <article
      ref={article}
      className={`message ${message.role}`}
      data-message-id={message.id}
    >
      {message.role === "user" ? (
        <>
          <UserContent attachments={attachments}>
            <UserMessageText
              key={`${sessionId}/${message.id}`}
              text={message.text}
              api={api}
              sessionId={sessionId}
              cwd={cwd}
              onOpenFile={onOpenFile}
              contentRef={markdownContent}
            />
          </UserContent>
          <UserMessageActions
            key={`${sessionId}/${message.id}`}
            sessionId={sessionId}
            messageId={message.id}
            text={message.text}
            createdAtMs={message.createdAtMs}
            content={markdownContent}
            onEdit={canEdit ? () => changeEditing(true) : undefined}
          />
        </>
      ) : (
        <div className={`message-body ${assistantBodyClass}`}>
          {attachments}
          <div
            className={`markdown ${assistantMarkdownClass}`}
            ref={markdownContent}
          >
            <Markdown
              text={message.text}
              api={api}
              sessionId={sessionId}
              cwd={cwd}
              onOpenFile={onOpenFile}
            />
          </div>
          <div className={assistantActionsClass}>
            <MessageActions
              api={api}
              sessionId={sessionId}
              messageId={message.id}
              markdown={message.text}
              content={markdownContent}
            />
          </div>
        </div>
      )}
    </article>
  );
});
