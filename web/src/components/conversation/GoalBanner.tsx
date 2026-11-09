import type { GoalCapabilities } from "../../goalCapabilities";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  LoaderCircle,
  Expand,
  CirclePause,
  CirclePlay,
  Goal,
  Trash2,
  X,
  Undo2,
} from "lucide-react";
import type { Api } from "../../api";
import { goalProgressText, type GoalProgress } from "../../goalProgress";
import PromptEditor, { type PromptEditorHandle } from "./PromptEditor";
import "./GoalBanner.css";

// The rail and goal tab share a save lock across tab closes, scoped to their chat.
const goalSaveTokens = new Map<string, symbol>();
const goalSaveListeners = new Set<() => void>();
function subscribeGoalSave(listener: () => void) {
  goalSaveListeners.add(listener);
  return () => {
    goalSaveListeners.delete(listener);
  };
}
function publishGoalSave(scope: string, token: symbol | null) {
  if (token) goalSaveTokens.set(scope, token);
  else goalSaveTokens.delete(scope);
  for (const listener of goalSaveListeners) listener();
}
function useGoalSaving(scope: string) {
  return useSyncExternalStore(
    subscribeGoalSave,
    () => goalSaveTokens.has(scope),
    () => false,
  );
}

export interface ConversationGoal extends GoalProgress {
  objective: string;
  status: string;
}

interface GoalEditorProps {
  api: Api;
  sessionId: string;
  onGoalChange?: (goal: ConversationGoal | null) => void;
  onError: (error: unknown) => void;
  disabled?: boolean;
}

interface GoalEditorResponse {
  goal: ConversationGoal | null;
  goal_error?: string | null;
  goal_capabilities?: GoalCapabilities;
  goal_objective?: string | null;
  goal_objective_error?: string | null;
}

/** The native goal tab uses the rich prompt controller and stays open on save. */
export function GoalEditor({
  api,
  sessionId,
  onGoalChange,
  onError,
  disabled = false,
}: GoalEditorProps) {
  const saveScope = JSON.stringify([api.connection.url, sessionId]);
  const goalSaving = useGoalSaving(saveScope);
  const [capabilities, setCapabilities] = useState<
    GoalCapabilities | undefined
  >();
  const [draft, setDraft] = useState("");
  const [semantic, setSemantic] = useState("");
  const [saved, setSaved] = useState("");
  const [savedAt, setSavedAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadedSession, setLoadedSession] = useState("");
  const [retry, setRetry] = useState(0);
  const [hasGoal, setHasGoal] = useState(false);
  const editor = useRef<PromptEditorHandle>(null);
  const identity = useRef(sessionId);
  const operation = useRef(0);
  const inFlight = useRef(false);
  const callbacks = useRef({ onGoalChange, onError });
  const errorId = useId();
  identity.current = sessionId;
  callbacks.current = { onGoalChange, onError };

  useEffect(() => {
    const controller = new AbortController();
    const version = ++operation.current;
    inFlight.current = false;
    setLoading(true);
    setSaving(false);
    setError("");
    void api
      .request<GoalEditorResponse>(
        `/sessions/${sessionId}/composer?goal_editor=true`,
        { signal: controller.signal },
      )
      .then((result) => {
        if (controller.signal.aborted || operation.current !== version) return;
        setCapabilities(result.goal_capabilities);
        if (result.goal_error) throw new Error(result.goal_error);
        const objective = result.goal_objective ?? result.goal?.objective ?? "";
        setDraft(objective);
        setSemantic(objective);
        setSaved(objective);
        setSavedAt(
          typeof result.goal?.updatedAt === "number" &&
            Number.isFinite(result.goal.updatedAt)
            ? result.goal.updatedAt * 1000
            : Date.now(),
        );
        setHasGoal(!!result.goal && result.goal.status !== "complete");
        setLoadedSession(sessionId);
        if (result.goal_objective_error) {
          setError(result.goal_objective_error);
          callbacks.current.onError(new Error(result.goal_objective_error));
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || operation.current !== version) return;
        setError(reason instanceof Error ? reason.message : "无法读取目标正文");
        callbacks.current.onError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted && operation.current === version)
          setLoading(false);
      });
    return () => {
      controller.abort();
      operation.current++;
    };
  }, [api, sessionId, retry]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const unavailable =
    disabled || loading || saving || goalSaving || loadedSession !== sessionId;
  const dirty = draft !== saved;
  const canSave =
    capabilities?.edit !== false &&
    !unavailable &&
    semantic.trim().length > 0 &&
    draft.trim().length > 0 &&
    draft.trim() !== saved;

  async function save() {
    if (
      unavailable ||
      capabilities?.edit === false ||
      goalSaveTokens.has(saveScope) ||
      inFlight.current ||
      editor.current?.isComposing()
    )
      return;
    const objective = (
      editor.current?.getSubmission().composer.markdown ?? draft
    ).trim();
    if (
      !(editor.current?.getText() ?? semantic).trim() ||
      !objective ||
      objective === saved
    )
      return;
    const activeSession = sessionId;
    const version = ++operation.current;
    const saveToken = Symbol("goal-save");
    publishGoalSave(saveScope, saveToken);
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const updated = await api.post<{ goal?: ConversationGoal | null }>(
        `/sessions/${sessionId}/composer`,
        { action: "goal", objective },
      );
      if (identity.current !== activeSession || operation.current !== version)
        return;
      // The mutation returns the accepted native goal. A later refresh failure
      // must never turn an accepted save back into an unsaved draft.
      const goal = updated.goal;
      if (!goal) throw new Error("Agent 未返回已保存的目标");
      setDraft(objective);
      setSaved(objective);
      setSavedAt(Date.now());
      setNow(Date.now());
      callbacks.current.onGoalChange?.(goal);
    } catch (reason) {
      if (identity.current !== activeSession || operation.current !== version)
        return;
      setError(reason instanceof Error ? reason.message : "目标未保存，请重试");
      callbacks.current.onError(reason);
    } finally {
      if (goalSaveTokens.get(saveScope) === saveToken)
        publishGoalSave(saveScope, null);
      if (identity.current === activeSession && operation.current === version) {
        inFlight.current = false;
        setSaving(false);
      }
    }
  }

  const minutes = Math.max(0, Math.floor((now - savedAt) / 60000));
  return (
    <section
      className="goal-editor-panel"
      aria-label="编辑目标"
      aria-busy={loading || saving}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          editor.current?.isComposing()
        )
          return;
        if (
          event.key.toLowerCase() === "s" &&
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat && canSave) void save();
        }
      }}
    >
      <div className="goal-editor-toolbar">
        <span className="goal-editor-updated" aria-live="polite">
          {minutes === 0 ? "刚刚更新" : `${minutes} 分钟前更新`}
        </span>
        <div className="goal-editor-actions">
          <button
            type="button"
            className="goal-editor-revert"
            aria-label="还原"
            title="还原"
            disabled={unavailable || !dirty}
            onClick={() => {
              setDraft(saved);
              setError("");
              editor.current?.focus();
            }}
          >
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="goal-editor-save"
            disabled={!canSave || capabilities?.edit === false}
            onClick={() => void save()}
          >
            {saving && (
              <LoaderCircle
                size={14}
                className="goal-banner-spinner"
                aria-hidden="true"
              />
            )}
            保存
          </button>
        </div>
      </div>
      {error && (
        <p className="goal-editor-error" role="alert" id={errorId}>
          {error}
          {loadedSession !== sessionId && !loading && (
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              重试
            </button>
          )}
        </p>
      )}
      {loading || loadedSession !== sessionId ? (
        <div className="goal-editor-state" role="status">
          {loading ? "加载目标…" : "目标未能加载"}
        </div>
      ) : !hasGoal ? (
        <div className="goal-editor-state">当前会话没有持续目标</div>
      ) : (
        <div className="goal-editor-scroll">
          {capabilities?.edit === false && (
            <p className="goal-banner-error" role="status">
              {capabilities.reason}
            </p>
          )}
          <PromptEditor
            key={sessionId}
            ref={editor}
            value={draft}
            onChange={setDraft}
            onPlainTextChange={setSemantic}
            label="目标"
            placeholder="目标"
            richText
            enterBehavior="newline"
            restorePathLinksAsFileMentions={false}
            onSubmit={() => void save()}
            onAlternateSubmit={() => void save()}
            disabled={disabled || saving || goalSaving}
            autoFocus
            describedBy={error ? errorId : undefined}
          />
        </div>
      )}
    </section>
  );
}

interface GoalBannerProps {
  api: Api;
  sessionId: string;
  goal: ConversationGoal | null;
  onChanged: (goal: ConversationGoal | null) => void;
  onError: (error: unknown) => void;
  disabled?: boolean;
  onEdit?: () => void;
  capabilities?: GoalCapabilities;
}

const goalStatus = (status: string): string =>
  ({
    active: "进行中的目标",
    paused: "目标已暂停",
    complete: "目标已完成",
    blocked: "目标受阻",
    budgetLimited: "目标预算已用尽",
    usageLimited: "目标用量受限",
  })[status] || "持续目标";

export default function GoalBanner({
  api,
  sessionId,
  goal,
  onChanged,
  onError,
  disabled = false,
  onEdit,
  capabilities,
}: GoalBannerProps) {
  const saveScope = JSON.stringify([api.connection.url, sessionId]);
  const goalSaving = useGoalSaving(saveScope);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (goal?.status !== "active") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sessionId, goal]);
  const [expanded, setExpanded] = useState(false),
    [working, setWorking] = useState<"status" | "clear" | null>(null),
    [error, setError] = useState("");
  const details = useRef<HTMLDivElement>(null),
    expandButton = useRef<HTMLButtonElement>(null),
    inFlight = useRef(false),
    identity = useRef(sessionId),
    operation = useRef(0),
    titleId = useId();
  identity.current = sessionId;

  useEffect(() => {
    setExpanded(false);
    setError("");
    setWorking(null);
    inFlight.current = false;
    return () => {
      operation.current++;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!goal) setExpanded(false);
  }, [goal]);

  useEffect(() => {
    if (!expanded || !goal) return;
    const previous = document.activeElement as HTMLElement | null;
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !inFlight.current) {
        event.preventDefault();
        setExpanded(false);
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      else expandButton.current?.focus({ preventScroll: true });
    };
  }, [expanded, !!goal]);

  function edit() {
    if (disabled || inFlight.current) return;
    if (onEdit) onEdit();
    else setExpanded((open) => !open);
  }

  async function change(action: "status" | "clear") {
    if (!goal || disabled || goalSaveTokens.has(saveScope) || inFlight.current)
      return;
    inFlight.current = true;
    setWorking(action);
    setError("");
    const activeSession = sessionId,
      version = ++operation.current;
    try {
      await api.post(
        `/sessions/${sessionId}/composer`,
        action === "clear"
          ? { action: "clear_goal" }
          : {
              action: "goal_status",
              status: goal.status === "active" ? "paused" : "active",
            },
      );
      const result = await api.request<{
        goal: ConversationGoal | null;
        goal_error?: string | null;
      }>(`/sessions/${sessionId}/composer`);
      if (identity.current !== activeSession || operation.current !== version)
        return;
      if (result.goal_error) throw new Error(result.goal_error);
      onChanged(result.goal);
      if (!result.goal) setExpanded(false);
    } catch (e) {
      if (identity.current !== activeSession || operation.current !== version)
        return;
      setError(e instanceof Error ? e.message : "目标设置未保存，请重试");
      onError(e);
    } finally {
      if (identity.current === activeSession && operation.current === version) {
        inFlight.current = false;
        setWorking(null);
      }
    }
  }

  if (!goal || goal.status === "complete") return null;
  const paused = goal.status !== "active",
    toggleable = ["active", "paused", "blocked", "usageLimited"].includes(
      goal.status,
    ),
    progress = goalProgressText(goal, now),
    status = goalStatus(goal.status),
    editUnavailable = disabled || working !== null,
    unavailable = editUnavailable || goalSaving;

  return (
    <div className="goal-banner-area">
      <div
        className="goal-banner"
        aria-label="持续目标"
        aria-busy={working !== null}
      >
        <button
          type="button"
          className="goal-banner-body"
          aria-label="编辑目标正文"
          disabled={editUnavailable}
          onClick={edit}
        >
          <Goal size={16} aria-hidden="true" />
          <span className="goal-banner-status">{status}</span>
          <span className="goal-banner-objective" title={goal.objective}>
            {goal.objective}
          </span>
          {progress != null && (
            <span className="goal-banner-elapsed" aria-label="目标进度">
              {progress}
            </span>
          )}
        </button>
        <div className="goal-banner-actions">
          <button
            type="button"
            aria-label="清除目标"
            disabled={unavailable || capabilities?.clear === false}
            title={
              capabilities?.clear === false
                ? capabilities.reason || "当前连接不支持清除目标"
                : "清除目标"
            }
            onClick={() => void change("clear")}
          >
            {working === "clear" ? (
              <LoaderCircle size={14} className="goal-banner-spinner" />
            ) : (
              <Trash2 size={16} />
            )}
          </button>
          {toggleable && (
            <button
              type="button"
              aria-label={paused ? "恢复目标" : "暂停目标"}
              title={
                (
                  paused
                    ? capabilities?.resume === false
                    : capabilities?.pause === false
                )
                  ? capabilities?.reason || "当前连接不支持此操作"
                  : paused
                    ? "恢复目标"
                    : "暂停目标"
              }
              disabled={
                unavailable ||
                (paused
                  ? capabilities?.resume === false
                  : capabilities?.pause === false)
              }
              onClick={() => void change("status")}
            >
              {working === "status" ? (
                <LoaderCircle size={14} className="goal-banner-spinner" />
              ) : paused ? (
                <CirclePlay size={16} />
              ) : (
                <CirclePause size={16} />
              )}
            </button>
          )}
          <button
            ref={expandButton}
            type="button"
            aria-label="编辑目标"
            title="编辑目标"
            aria-expanded={expanded}
            disabled={editUnavailable}
            onClick={edit}
          >
            <Expand size={16} />
          </button>
        </div>
      </div>
      {error && !expanded && (
        <p className="goal-banner-error" role="alert">
          {error}
        </p>
      )}
      {expanded &&
        createPortal(
          <aside
            className="goal-editor-fallback"
            aria-label="目标面板"
            ref={details}
          >
            <header className="goal-editor-fallback-heading">
              <span id={titleId}>
                <Goal size={15} aria-hidden="true" /> 编辑目标
              </span>
              <button
                type="button"
                aria-label="关闭目标面板"
                onClick={() => setExpanded(false)}
              >
                <X size={16} />
              </button>
            </header>
            <GoalEditor
              api={api}
              sessionId={sessionId}
              disabled={disabled}
              onGoalChange={onChanged}
              onError={onError}
            />
          </aside>,
          document.body,
        )}
    </div>
  );
}
