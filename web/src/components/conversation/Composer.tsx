import type { GoalCapabilities } from "../../goalCapabilities";
import GoalBanner, { type ConversationGoal } from "./GoalBanner";
import ModelPicker from "./ModelPicker";
import {
  useLayoutEffect,
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Paperclip,
  X,
  ArrowUp,
  Square,
  FolderOpen,
  ChevronDown,
  ShieldCheck,
  Target,
  LoaderCircle,
} from "lucide-react";
import type { Api } from "../../api";
import type { Session } from "../../types";
import { agentName } from "../../sidebarAgents";
import ImagePreview from "../ImagePreview";
import ComposerAdd from "../ComposerAdd";
import PromptEditor, { type PromptEditorHandle } from "./PromptEditor";
import type { ComposerSubmission } from "../../composerSubmission";
import type { PromptDocument } from "../../promptText";
import ImageEditor from "../ImageEditor";
import type {
  ComposerAttachment as Attachment,
  ImageEdit,
} from "../../imageAnnotations";
interface ComposerProps {
  api: Api;
  session: Session;
  manualApprovalsOnly: boolean;
  models: { model: string; displayName?: string; isDefault?: boolean }[];
  busy: boolean;
  sending: boolean;
  uploading: number;
  draft: string;
  setDraft: (text: string) => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  queuedMessages?: ReactNode;
  queueingEnabled: boolean;
  focusRequest: number;
  editingQueue: boolean;
  undoQueueEdit: () => void;
  recallQueuedMessage: () => boolean;
  queueWorking: boolean;
  goalMode: boolean;
  setGoalMode: (enabled: boolean) => void;
  send: (
    mode?: "steer" | "queue",
    submission?: ComposerSubmission,
  ) => Promise<void>;
  initialDocument?: PromptDocument;
  inputRef?: RefObject<PromptEditorHandle | null>;
  onEditGoal?: () => void;
  goalRevision?: number;
  controlsRevision?: number;
  upload: (files: FileList | File[] | null) => Promise<void>;
  patch: (data: object) => Promise<void>;
  interrupt: () => void;
  fail: (error: unknown) => void;
  onModelChange?: (model: string) => void;
  inputLabel?: string;
}
export default function Composer({
  api,
  session,
  manualApprovalsOnly,
  models,
  busy,
  sending,
  uploading,
  draft,
  setDraft,
  attachments,
  setAttachments,
  queuedMessages,
  queueingEnabled,
  focusRequest,
  editingQueue,
  undoQueueEdit,
  recallQueuedMessage,
  queueWorking,
  goalMode,
  setGoalMode,
  send,
  upload,
  patch,
  interrupt,
  fail,
  onModelChange,
  initialDocument,
  inputRef,
  onEditGoal,
  goalRevision,
  controlsRevision,
  inputLabel = "消息",
}: ComposerProps) {
  const [goalCapabilities, setGoalCapabilities] = useState<
    GoalCapabilities | undefined
  >();
  const [editingImage, setEditingImage] = useState<{
    key: string;
    source: string;
  } | null>(null);
  const imageScope = JSON.stringify([
    api.connection.scope ?? api.connection.url,
    session.id,
  ]);
  const scope = useRef(imageScope);
  scope.current = imageScope;
  const imageUploads = useRef(new Set<AbortController>());
  useEffect(() => {
    setEditingImage(null);
    return () => {
      for (const controller of imageUploads.current) controller.abort();
      imageUploads.current.clear();
    };
  }, [imageScope]);
  const editTarget = attachments.find(
    (a) => (a.uploadKey || a.path) === editingImage?.key,
  );
  const saveImage = async (edit: ImageEdit, blob: Blob, preview: string) => {
    if (!editingImage || !editTarget)
      throw new Error("附件已移除，请重新选择图片");
    const key = editingImage.key;
    const savedScope = imageScope;
    const controller = new AbortController();
    imageUploads.current.add(controller);
    setAttachments((old) =>
      old.map((a) =>
        (a.uploadKey || a.path) === key ? { ...a, pending: true } : a,
      ),
    );
    try {
      const name = editTarget.name.replace(/\.[^.]+$/, "") + ".png";
      const body = new FormData();
      body.append("files", new File([blob], name, { type: "image/png" }));
      const data = await api.request(`/sessions/${session.id}/uploads`, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      if (controller.signal.aborted || scope.current !== savedScope) return;
      if (!data.files?.[0]?.path) throw new Error("保存图片失败，请重试");
      setAttachments((old) =>
        old.map((a) =>
          (a.uploadKey || a.path) === key
            ? {
                ...a,
                ...data.files[0],
                preview,
                imageEdit: edit,
                pending: false,
              }
            : a,
        ),
      );
    } finally {
      imageUploads.current.delete(controller);
      if (!controller.signal.aborted && scope.current === savedScope)
        setAttachments((old) =>
          old.map((a) =>
            (a.uploadKey || a.path) === key ? { ...a, pending: false } : a,
          ),
        );
    }
  };
  const [semanticDraft, setSemanticDraft] = useState(draft);
  const [goal, setGoal] = useState<ConversationGoal | null>(null);
  useEffect(() => {
    setGoal(null);
    setGoalCapabilities(undefined);
  }, [session.id]);
  const ownComposerInput = useRef<PromptEditorHandle>(null);
  const composerInput = inputRef ?? ownComposerInput;
  const fileInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (focusRequest > 0) composerInput.current?.focus();
  }, [focusRequest]);
  const isImage = (attachment: Attachment) =>
    !!attachment.preview || /\.(png|jpe?g|webp|gif)$/i.test(attachment.path);
  const invalidAutoPolicy = manualApprovalsOnly && session.policy === "auto";
  const submit = (mode?: "steer" | "queue") => {
    if (
      invalidAutoPolicy ||
      attachments.some((a) => a.pending) ||
      (goalMode && goalCapabilities?.create === false)
    )
      return Promise.resolve();
    const submission = composerInput.current?.getSubmission();
    return send(mode, submission && { ...submission, goal: goalMode });
  };

  return (
    <>
      {editingImage && editTarget && (
        <ImageEditor
          key={imageScope + editingImage.key}
          source={editingImage.source}
          name={editTarget.name}
          initial={editTarget.imageEdit}
          onSave={saveImage}
          onClose={() => setEditingImage(null)}
        />
      )}
      <div className="composer-context">
        {queuedMessages}
        <GoalBanner
          api={api}
          sessionId={session.id}
          goal={goal}
          capabilities={goalCapabilities}
          onChanged={setGoal}
          onError={fail}
          disabled={session.archived}
          onEdit={onEditGoal}
        />
      </div>
      <div className="composer">
        {sending && (
          <div className="upload-status" role="status">
            正在提交消息…
          </div>
        )}
        {editingQueue && (
          <div className="queue-edit-notice" role="status">
            <span>编辑排队消息</span>
            <button
              type="button"
              disabled={sending || queueWorking}
              onClick={undoQueueEdit}
            >
              撤销
            </button>
          </div>
        )}
        {uploading > 0 && (
          <div className="upload-status" role="status">
            正在上传附件…
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((a) => (
              <span
                key={a.uploadKey || a.path}
                className={isImage(a) ? "image-attachment" : "file-attachment"}
                aria-busy={a.pending || undefined}
                title={a.name}
              >
                {isImage(a) ? (
                  <ImagePreview
                    api={api}
                    sessionId={session.id}
                    path={a.uploadKey || a.path}
                    onEdit={
                      sending ||
                      uploading > 0 ||
                      attachments.some((f) => f.pending) ||
                      session.archived
                        ? undefined
                        : (key, source) => setEditingImage({ key, source })
                    }
                    thumbnail
                    autoLoad
                    localSources={Object.fromEntries(
                      attachments
                        .filter((f) => f.preview)
                        .map((f) => [f.uploadKey || f.path, f.preview!]),
                    )}
                    gallery={attachments
                      .filter(isImage)
                      .map((f) => f.uploadKey || f.path)}
                    displayName={a.name}
                    galleryNames={Object.fromEntries(
                      attachments.map((f) => [f.uploadKey || f.path, f.name]),
                    )}
                  />
                ) : (
                  <Paperclip size={12} />
                )}
                <span className="attachment-name">{a.name}</span>
                {a.pending && (
                  <span className="attachment-pending">上传中…</span>
                )}
                <button
                  title="移除附件"
                  onClick={() =>
                    setAttachments((old) =>
                      old.filter((x) => x.path !== a.path),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {goalMode && goalCapabilities?.create === false && (
          <p className="composer-add-error" role="status">
            {goalCapabilities.reason ||
              "当前连接不支持新建目标，输入内容已保留"}
          </p>
        )}
        {invalidAutoPolicy && (
          <p className="composer-add-error" role="status">
            当前 Agent
            不支持自动批准，请先将审批模式切回“沿用原生权限”。输入内容已保留。
          </p>
        )}
        <PromptEditor
          key={session.id}
          ref={composerInput}
          richText
          storageKey={JSON.stringify([
            api.connection.scope ?? api.connection.url,
            session.id,
          ])}
          promptHistory={{
            server: api.connection.scope ?? api.connection.url,
            scope: session.id,
          }}
          initialDocument={initialDocument}
          label={inputLabel}
          placeholder={
            session.archived
              ? "此会话已归档"
              : goalMode
                ? "描述要达成的目标"
                : `使用 ${agentName(session.agent)}`
          }
          value={draft}
          disabled={sending || session.archived}
          onChange={setDraft}
          onPlainTextChange={setSemanticDraft}
          onSubmit={() => void submit()}
          onAlternateSubmit={() =>
            void submit(
              busy ? (queueingEnabled ? "steer" : "queue") : undefined,
            )
          }
          onRecallQueuedMessage={goalMode ? undefined : recallQueuedMessage}
          onPasteFiles={(files) => void upload(files)}
        />
        <div className="composer-tools">
          <div className="composer-left">
            <ComposerAdd
              key={session.id}
              api={api}
              session={session}
              disabled={sending || queueWorking || session.archived}
              goalRevision={goalRevision}
              onGoalChange={setGoal}
              onGoalCapabilities={setGoalCapabilities}
              goalMode={goalMode}
              onGoalMode={() => {
                setGoalMode(!goalMode);
                composerInput.current?.focus();
              }}
              onUpload={() => fileInput.current?.click()}
              onAttach={(files) =>
                setAttachments((old) => [
                  ...old,
                  ...files.filter(
                    (file) => !old.some((entry) => entry.path === file.path),
                  ),
                ])
              }
            />
            <input
              hidden
              type="file"
              multiple
              ref={fileInput}
              onChange={(e) => {
                const files = Array.from(e.currentTarget.files || []);
                e.currentTarget.value = "";
                void upload(files);
              }}
            />
            <span className="composer-divider" />
            <span
              className="composer-permissions"
              title={
                manualApprovalsOnly
                  ? "AnyWork 不自动代答审批请求，原生权限模式由宿主管理"
                  : session.policy === "auto"
                    ? "自动批准"
                    : "逐次审批"
              }
            >
              <ShieldCheck size={15} />
              <select
                aria-label="审批模式"
                title="审批模式"
                disabled={
                  session.external ||
                  (manualApprovalsOnly && !invalidAutoPolicy)
                }
                value={session.policy}
                onChange={(e) => {
                  if (!manualApprovalsOnly || e.target.value === "manual")
                    void patch({ policy: e.target.value });
                }}
              >
                <option value="manual">
                  {manualApprovalsOnly
                    ? "沿用原生权限"
                    : session.external
                      ? "沿用原会话权限"
                      : "逐次审批"}
                </option>
                {(!manualApprovalsOnly || invalidAutoPolicy) && (
                  <option value="auto" disabled={manualApprovalsOnly}>
                    {invalidAutoPolicy ? "旧自动审批不可用" : "自动批准"}
                  </option>
                )}
              </select>
            </span>
            {manualApprovalsOnly && (
              <small
                className="muted"
                title="AnyWork 不自动代答审批请求，原生权限模式由宿主管理"
              >
                沿用原生权限
              </small>
            )}
            {goalMode && (
              <>
                <span className="composer-divider" />
                <button
                  type="button"
                  className="composer-goal-mode"
                  title="退出目标模式"
                  aria-label="退出目标模式"
                  disabled={sending || queueWorking || session.archived}
                  onClick={() => {
                    setGoalMode(false);
                    composerInput.current?.focus();
                  }}
                >
                  <Target className="goal-mode-icon" size={18} />
                  <X className="goal-mode-clear" size={18} />
                  <span>目标</span>
                </button>
              </>
            )}
          </div>
          <ModelPicker
            controlsRevision={controlsRevision}
            api={api}
            session={session}
            models={models}
            busy={busy}
            onError={fail}
            onModelChange={onModelChange}
          />
          {busy && !semanticDraft.trim() && !attachments.length && (
            <button
              className="send-button stop"
              title="中断"
              onClick={interrupt}
            >
              <Square size={15} />
            </button>
          )}
          {(!busy || semanticDraft.trim() || attachments.length > 0) && (
            <button
              className="send-button"
              title="发送"
              disabled={
                sending ||
                invalidAutoPolicy ||
                (goalMode && goalCapabilities?.create === false) ||
                uploading > 0 ||
                attachments.some((a) => a.pending) ||
                session.archived ||
                (!semanticDraft.trim() && !attachments.length)
              }
              onClick={() => void submit()}
            >
              {sending ? (
                <LoaderCircle className="spin" size={19} />
              ) : (
                <ArrowUp size={19} />
              )}
            </button>
          )}
        </div>
      </div>
      <div className="composer-footnote">
        <span title={session.cwd}>
          <FolderOpen size={12} />
          {session.cwd.split("/").filter(Boolean).pop() || session.cwd}
        </span>
        <span title={session.status}>
          <i className={`session-state-dot ${session.status}`} />
          {session.external ? "原会话" : "本地"}
          <ChevronDown size={10} />
        </span>
      </div>
    </>
  );
}
