import { useEffect, useRef, useState } from "react";
import type { Api } from "../api";
import type { ConversationTurn, Message, Session } from "../types";

interface Capability {
  editable: boolean;
  message_id: string;
  turn_id: string;
  fingerprint: string;
  text: string;
}
interface Operation {
  id: string;
  phase: string;
  message_id: string;
  text: string;
  expected_fingerprint: string;
  error?: string | null;
  retryable?: boolean;
  attachment_count?: number;
  attachments?: string[];
}
interface Editing {
  message: Message;
  text: string;
  fingerprint: string;
  operationId: string;
  attempted: boolean;
  phase: string;
  error: string;
}

/** Retains the draft when a real revert removes its original message from history. */
export function useMessageEditing({
  api,
  session,
  turns,
  enabled,
  busy,
  resetHistory,
}: {
  api: Api | null;
  session?: Session;
  turns: ConversationTurn[];
  enabled: boolean;
  busy: boolean;
  resetHistory: () => void;
}) {
  const [capability, setCapability] = useState<Capability | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const scope = useRef(0),
    inFlight = useRef(false);
  const interaction = useRef(0);
  const currentEditing = useRef(editing);
  currentEditing.current = editing;
  const userTurn = [...turns]
    .reverse()
    .find((turn) => turn.messages.some((m) => m.role === "user"));
  const users = userTurn?.messages.filter((m) => m.role === "user") || [];
  const candidate = users.length === 1 ? users[0] : undefined;
  const candidateId = candidate?.id;

  useEffect(() => {
    const version = ++scope.current;
    const initialInteraction = ++interaction.current;
    inFlight.current = false;
    setSubmitting(false);
    setEditing(null);
    setCapability(null);
    if (!enabled || !api || !session) return;
    const controller = new AbortController();
    api
      .request<{ operation: Operation | null }>(
        `/sessions/${session.id}/edit`,
        { signal: controller.signal },
      )
      .then(({ operation }) => {
        if (
          controller.signal.aborted ||
          scope.current !== version ||
          interaction.current !== initialInteraction ||
          !operation ||
          ["completed", "cancelled"].includes(operation.phase)
        )
          return;
        setEditing(
          (old) =>
            old || {
              message: {
                id: operation.message_id,
                role: "user",
                text: operation.text,
                attachments: operation.attachments,
              },
              text: operation.text,
              fingerprint: operation.expected_fingerprint,
              operationId: operation.id,
              attempted: true,
              phase: operation.phase,
              error:
                operation.error || "上次编辑尚未完成，请检查会话状态后重试。",
            },
        );
      })
      .catch(() => {});
    return () => {
      controller.abort();
      scope.current++;
    };
  }, [api, session?.id, enabled]);

  useEffect(() => {
    setCapability(null);
    if (
      !enabled ||
      !api ||
      !session ||
      session.archived ||
      busy ||
      !candidateId
    )
      return;
    const controller = new AbortController();
    api
      .request<Capability>(
        `/sessions/${session.id}/edit?message_id=${encodeURIComponent(candidateId)}`,
        { signal: controller.signal },
      )
      .then((value) => {
        if (
          !controller.signal.aborted &&
          value.editable === true &&
          value.message_id === candidateId
        )
          setCapability(value);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [
    api,
    session?.id,
    session?.archived,
    enabled,
    busy,
    candidateId,
    userTurn?.id,
    userTurn?.status,
  ]);

  async function submit(message: Message, text: string) {
    const context = currentEditing.current;
    if (
      !api ||
      !session ||
      !context ||
      context.message.id !== message.id ||
      inFlight.current
    )
      throw new Error("无法编辑消息");
    const version = scope.current;
    inFlight.current = true;
    setSubmitting(true);
    let received = false;
    setEditing(
      (old) =>
        old && { ...old, text, attempted: true, phase: "starting", error: "" },
    );
    try {
      const result = await api.post<{
        operation: Operation;
        history_changed: boolean;
      }>(`/sessions/${session.id}/edit`, {
        message_id: message.id,
        text,
        expected_fingerprint: context.fingerprint,
        operation_id: context.operationId,
        retry: context.attempted,
      });
      if (scope.current !== version) return;
      received = true;
      setEditing((old) => old && { ...old, phase: result.operation.phase });
      if (result.history_changed) resetHistory();
      if (result.operation.text !== text)
        throw new Error(
          "服务端已保存的提交与当前草稿不同，已保留草稿。请先取消编辑，再从最新消息继续。",
        );
      if (result.operation.phase !== "completed")
        throw new Error(
          result.operation.error ||
            (result.operation.phase === "uncertain"
              ? "发送结果尚未确认，请检查真实会话后重试。"
              : "编辑尚未完成，请重试。"),
        );
      setEditing(null);
      resetHistory();
    } catch (error) {
      if (scope.current === version)
        setEditing((old) =>
          old?.operationId === context.operationId
            ? {
                ...old,
                phase: received ? old.phase : "uncertain",
                error: `无法编辑消息：${error instanceof Error ? error.message : "请重试"}`,
              }
            : old,
        );
      throw error;
    } finally {
      if (scope.current === version) {
        inFlight.current = false;
        setSubmitting(false);
      }
    }
  }

  function props(message: Message) {
    const selected = editing?.message.id === message.id;
    return {
      canEditMessage: enabled && capability?.message_id === message.id,
      editBusy: busy || submitting,
      editing: selected,
      editorInitialText: selected ? editing.text : undefined,
      editorError: selected ? editing.error : undefined,
      editorReadOnly:
        selected &&
        ["uncertain", "starting", "reverting"].includes(editing.phase),
      editorSubmitLabel:
        selected &&
        ["uncertain", "starting", "reverting"].includes(editing.phase)
          ? "核对发送结果"
          : undefined,
      onEditMessage: submit,
      onEditingChange: (value: boolean) => {
        if (!value) {
          const context = currentEditing.current;
          if (inFlight.current || !context || context.message.id !== message.id)
            return;
          interaction.current++;
          if (!context.attempted || !api || !session) {
            setEditing(null);
            return;
          }
          const version = scope.current;
          inFlight.current = true;
          setSubmitting(true);
          void api
            .request(`/sessions/${session.id}/edit/${context.operationId}`, {
              method: "DELETE",
            })
            .then(() => {
              if (scope.current === version) setEditing(null);
            })
            .catch((error) => {
              if (scope.current === version)
                setEditing(
                  (old) =>
                    old && {
                      ...old,
                      error:
                        error instanceof Error
                          ? error.message
                          : "无法取消编辑，请重试。",
                    },
                );
            })
            .finally(() => {
              if (scope.current === version) {
                inFlight.current = false;
                setSubmitting(false);
              }
            });
        } else if (capability?.message_id === message.id) {
          interaction.current++;
          setEditing({
            message: { ...message, text: capability.text },
            text: capability.text,
            fingerprint: capability.fingerprint,
            operationId: crypto.randomUUID(),
            attempted: false,
            phase: "draft",
            error: "",
          });
        }
      },
      onEditDraftChange: (text: string) =>
        setEditing((old) =>
          old?.message.id === message.id ? { ...old, text, error: "" } : old,
        ),
    };
  }
  const detached =
    editing &&
    !turns.some((turn) =>
      turn.messages.some((message) => message.id === editing.message.id),
    )
      ? editing.message
      : null;
  return { props, detached, submitting };
}
