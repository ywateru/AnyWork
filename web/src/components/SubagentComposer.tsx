import { useEffect, useRef, useState } from "react";
import type { Api } from "../api";
import type { Session } from "../types";
import type { ComposerSubmission } from "../composerSubmission";
import { useSessionDraft } from "../hooks/useSessionDraft";
import Composer from "./conversation/Composer";
import MessageQueue, { type QueuedMessage } from "./conversation/MessageQueue";
import type { PromptEditorHandle } from "./conversation/PromptEditor";

import type { ComposerAttachment as Attachment } from "../imageAnnotations";
type Queue = {
  items: QueuedMessage[];
  paused: boolean;
  editing?: QueuedMessage | null;
};
const emptyQueue: Queue = { items: [], paused: false };

/** Reuses the full conversation composer and targets the existing child session. */
export default function SubagentComposer({
  api,
  session,
  name,
  onChanged,
}: {
  api: Api;
  session: Session;
  name: string;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useSessionDraft(api.connection.url, session.id);
  const [attachments, setAttachments] = useState<Attachment[]>([]),
    [uploading, setUploading] = useState(0),
    [sending, setSending] = useState(false),
    [error, setError] = useState("");
  const [goalMode, setGoalMode] = useState(false),
    [queue, setQueue] = useState<Queue>(emptyQueue),
    [queueing, setQueueing] = useState(false),
    [focus, setFocus] = useState(0);
  const [editing, setEditing] = useState<{
    item: QueuedMessage;
    draft: string;
    attachments: Attachment[];
    goal: boolean;
  } | null>(null);
  const [controlsRevision, setControlsRevision] = useState(0);
  const input = useRef<PromptEditorHandle>(null),
    working = useRef(false),
    uploads = useRef(new Set<AbortController>()),
    urls = useRef(new Set<string>()),
    alive = useRef(true),
    revision = useRef(0);
  const current = useRef({ draft, attachments, goalMode });
  current.current = { draft, attachments, goalMode };
  const busy = ["running", "waiting", "starting"].includes(session.status);
  const fail = (e: unknown) => {
    if (alive.current) setError(e instanceof Error ? e.message : String(e));
  };
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const before = revision.current;
      try {
        const data = await api.request<Queue>(`/sessions/${session.id}/queue`, {
          signal: controller.signal,
        });
        if (
          !controller.signal.aborted &&
          !working.current &&
          before === revision.current
        )
          setQueue(data);
      } catch {
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 1500);
      }
    }
    void load();
    return () => {
      alive.current = false;
      controller.abort();
      clearTimeout(timer);
      for (const c of uploads.current) c.abort();
      for (const url of urls.current) URL.revokeObjectURL(url);
    };
  }, [api, session.id]);
  async function action(data: object): Promise<boolean> {
    if (working.current) return false;
    working.current = true;
    revision.current++;
    setSending(true);
    setError("");
    try {
      const next = await api.post<Queue>(`/sessions/${session.id}/queue`, data);
      if (alive.current) {
        setQueue(next);
        onChanged();
      }
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      working.current = false;
      if (alive.current) setSending(false);
    }
  }
  async function edit(item: QueuedMessage) {
    if (editing || uploading || working.current || item.status !== "pending")
      return;
    const old = current.current;
    working.current = true;
    revision.current++;
    setSending(true);
    try {
      const next = await api.post<Queue>(`/sessions/${session.id}/queue`, {
        action: "take",
        id: item.id,
      });
      const fresh = current.current;
      if (
        !alive.current ||
        fresh.draft !== old.draft ||
        fresh.attachments !== old.attachments ||
        fresh.goalMode !== old.goalMode
      ) {
        await api.post(`/sessions/${session.id}/queue`, {
          action: "restore",
          id: item.id,
        });
        return;
      }
      if (!next.editing) throw new Error("排队消息未能移入编辑器，请重试。");
      setEditing({
        item: next.editing,
        draft: old.draft,
        attachments: old.attachments,
        goal: old.goalMode,
      });
      setQueue(next);
      setDraft(next.editing.text);
      setAttachments(
        next.editing.attachments.map((path) => ({
          path,
          name: path.split("/").at(-1) || path,
        })),
      );
      setGoalMode(!!next.editing.goal);
      setFocus((v) => v + 1);
    } catch (e) {
      fail(e);
    } finally {
      working.current = false;
      if (alive.current) setSending(false);
    }
  }
  async function undo() {
    if (!editing) return;
    if (await action({ action: "restore", id: editing.item.id })) {
      setDraft(editing.draft);
      setAttachments(editing.attachments);
      setGoalMode(editing.goal);
      setEditing(null);
    }
  }
  async function send(
    mode?: "steer" | "queue",
    submission?: ComposerSubmission,
  ) {
    if (working.current || uploading || attachments.some((a) => a.pending))
      return;
    const text = submission?.text ?? draft;
    if (!text.trim() && !attachments.length) {
      if (busy && queue.items[0])
        await action({ action: "steer", id: queue.items[0].id });
      return;
    }
    working.current = true;
    revision.current++;
    setSending(true);
    setError("");
    try {
      const body = {
        text,
        composer: submission?.composer,
        attachments: attachments.map((a) => a.path),
        goal: (submission?.goal ?? goalMode) || undefined,
      };
      const next = editing
        ? await api.post<Queue>(`/sessions/${session.id}/queue`, {
            action: "replace",
            id: editing.item.id,
            ...body,
          })
        : await api.post<Queue>(`/sessions/${session.id}/messages`, {
            ...body,
            mode: mode ?? (busy && queueing ? "queue" : "steer"),
            queue_if_busy: mode == null && queueing,
          });
      if (!alive.current) return;
      if (Array.isArray(next.items)) setQueue(next);
      setDraft("");
      setAttachments([]);
      setGoalMode(false);
      setEditing(null);
      setControlsRevision((v) => v + 1);
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      working.current = false;
      if (alive.current) setSending(false);
    }
  }
  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    const controller = new AbortController(),
      entries = Array.from(files).map((file) => {
        const preview = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;
        if (preview) urls.current.add(preview);
        const uploadKey = crypto.randomUUID();
        return {
          name: file.name,
          path: uploadKey,
          uploadKey,
          preview,
          pending: true,
        };
      });
    setAttachments((old) => [...old, ...entries]);
    uploads.current.add(controller);
    setUploading((v) => v + 1);
    try {
      const body = new FormData();
      for (const file of Array.from(files)) body.append("files", file);
      const data = await api.request<{ files: Attachment[] }>(
        `/sessions/${session.id}/uploads`,
        { method: "POST", body, signal: controller.signal },
      );
      if (!controller.signal.aborted)
        setAttachments((old) =>
          old.map((a) => {
            const i = entries.findIndex((e) => e.uploadKey === a.uploadKey);
            return i < 0 ? a : { ...a, ...data.files[i], pending: false };
          }),
        );
    } catch (e) {
      if (!controller.signal.aborted) {
        setAttachments((old) =>
          old.filter((a) => !entries.some((e) => e.uploadKey === a.uploadKey)),
        );
        fail(e);
      }
    } finally {
      uploads.current.delete(controller);
      if (alive.current) setUploading((v) => v - 1);
    }
  }
  return (
    <div
      className="subagent-composer-area composer-area"
      aria-label={`子 Agent 输入：${name}`}
    >
      {error && (
        <div className="history-error" role="alert">
          {error}
        </div>
      )}
      <Composer
        api={api}
        session={session}
        inputLabel={`给 ${name} 发送消息`}
        models={[]}
        busy={busy}
        sending={sending}
        uploading={uploading}
        draft={draft}
        setDraft={setDraft}
        attachments={attachments}
        setAttachments={setAttachments}
        goalMode={goalMode}
        setGoalMode={setGoalMode}
        goalRevision={controlsRevision}
        controlsRevision={controlsRevision}
        queueingEnabled={queueing}
        focusRequest={focus}
        editingQueue={!!editing}
        undoQueueEdit={() => void undo()}
        recallQueuedMessage={() => {
          if (draft || attachments.length || !queue.items.length || editing)
            return false;
          void edit(queue.items.at(-1)!);
          return true;
        }}
        queueWorking={sending}
        inputRef={input}
        initialDocument={editing?.item.composer?.document}
        send={send}
        upload={upload}
        patch={async (data) => {
          await api.request(`/sessions/${session.id}`, {
            method: "PATCH",
            body: JSON.stringify(data),
          });
          onChanged();
        }}
        interrupt={() => {
          void api
            .post(`/sessions/${session.id}/interrupt`)
            .then(onChanged)
            .catch(fail);
        }}
        fail={fail}
        queuedMessages={
          queue.items.length > 0 ? (
            <MessageQueue
              api={api}
              sessionId={session.id}
              items={queue.items}
              paused={queue.paused}
              working={sending || uploading > 0}
              onAction={action}
              onEdit={(item) => void edit(item)}
              canEdit={!editing}
              queueingEnabled={queueing}
              onToggleQueueing={() => setQueueing((v) => !v)}
            />
          ) : null
        }
      />
    </div>
  );
}
