import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

export function DeviceNameEditor({
  name,
  synced,
  disabled,
  onSave,
  onDirtyChange,
}: {
  name: string | null;
  synced: boolean | null;
  disabled: boolean;
  onSave: (name: string, expectedName: string) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const edit = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const wasEditing = useRef(false);
  const value = draft.trim();
  const invalid = !value || value.length > 80 || /\p{Cc}/u.test(value);
  const dirty = editing && draft !== name;
  const conflict = editing && name !== null && name !== originalName;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (wasEditing.current) edit.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  function cancel() {
    if (saving) return;
    setEditing(false);
    setDraft("");
    setError("");
  }
  return (
    <section className="device-name-panel" aria-label="设备名称">
      <div className="device-name-heading">
        <h2>设备名称</h2>
        {!editing && (
          <button
            ref={edit}
            className="quiet"
            disabled={disabled || !name}
            onClick={() => {
              setDraft(name ?? "");
              setOriginalName(name ?? "");
              setFeedback("");
              setEditing(true);
            }}
          >
            <Pencil size={14} />
            编辑设备名称
          </button>
        )}
      </div>
      {editing ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (invalid || disabled || saving || conflict) return;
            setSaving(true);
            setError("");
            try {
              await onSave(value, originalName);
              setEditing(false);
              setFeedback("设备名称已保存");
            } catch (error) {
              setError(
                error instanceof Error &&
                  error.message === "DEVICE_NAME_CONFLICT"
                  ? "设备目录中的名称已发生变化，尚未覆盖。输入的草稿已保留，请取消后重新编辑。"
                  : "设备名称未保存。请检查网络与账号状态后重试，输入的名称已保留。",
              );
            } finally {
              setSaving(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        >
          <label htmlFor="device-name">设备名称</label>
          <input
            ref={input}
            id="device-name"
            value={draft}
            maxLength={80}
            disabled={saving}
            aria-describedby="device-name-help"
            onChange={(event) => setDraft(event.target.value)}
          />
          <p id="device-name-help" className="hint">
            1–80 个字符，可使用中文。名称不会改变设备身份或中断现有连接。
          </p>
          {conflict && (
            <p className="notice" role="alert">
              设备名称已在其他位置更新为“{name}
              ”。输入的草稿已保留；请取消后重新编辑，避免覆盖刚刚更新的名称。
            </p>
          )}
          <div className="device-name-actions">
            <button type="button" disabled={saving} onClick={cancel}>
              取消
            </button>
            <button
              className="primary"
              disabled={invalid || disabled || saving || conflict}
            >
              {saving ? "正在保存…" : "保存设备名称"}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="device-name-value">{name || "设备名称暂不可用"}</p>
      )}
      <p className="hint" role="status">
        {synced === true
          ? "已同步到设备目录"
          : synced === false
            ? "名称保存在这台电脑，尚未确认与账号设备目录同步。"
            : "设备目录同步状态暂不可用。"}
      </p>
      {feedback && (
        <p className="save-feedback" role="status">
          {feedback}
        </p>
      )}
    </section>
  );
}
