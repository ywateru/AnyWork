import type { GoalCapabilities } from "../goalCapabilities";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  Upload,
  FolderOpen,
  Target,
  Lightbulb,
  X,
  ArrowLeft,
  File,
  Folder,
  Check,
} from "lucide-react";
import type { Api } from "../api";
import type { Session } from "../types";

type Goal = { objective: string; status: string };
type Controls = {
  goal: Goal | null;
  goal_error?: string;
  goal_capabilities?: GoalCapabilities;
  plan: boolean;
  plan_available: boolean;
};
type Entry = { name: string; path: string; directory: boolean };
export default function ComposerAdd({
  api,
  session,
  disabled,
  onUpload,
  onAttach,
  onGoalChange,
  onGoalCapabilities,
  goalRevision,
  goalMode,
  onGoalMode,
}: {
  api: Api;
  session: Session;
  disabled: boolean;
  onGoalChange?: (goal: Goal | null) => void;
  onGoalCapabilities?: (capabilities: GoalCapabilities | undefined) => void;
  goalRevision?: number;
  goalMode: boolean;
  onGoalMode: () => void;
  onUpload: () => void;
  onAttach: (files: { name: string; path: string }[]) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<"remote" | null>(null);
  const [controls, setControls] = useState<Controls | null>(null);
  const [controlError, setControlError] = useState("");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Record<string, Entry>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const goalCallback = useRef(onGoalChange);
  goalCallback.current = onGoalChange;
  const capabilityCallback = useRef(onGoalCapabilities);
  capabilityCallback.current = onGoalCapabilities;
  const host = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (session.archived || pending) return;
      pending = true;
      try {
        const data = await api.request<Controls>(
          `/sessions/${session.id}/composer`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setControls(data);
          capabilityCallback.current?.(data.goal_capabilities);
          goalCallback.current?.(data.goal);
          setControlError("");
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setControlError(
            e instanceof Error ? e.message : "无法读取 Agent 模式",
          );
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      mounted.current = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [api, session.id, session.archived, goalRevision]);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: Event) => {
      if (!host.current?.contains(e.target as Node)) setMenu(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        host.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.current?.querySelector<HTMLElement>("textarea, button")?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) setDialog(null);
      if (e.key === "Tab") {
        const nodes = modal.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),textarea,input",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.body.style.overflow = before;
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [dialog, saving]);
  useEffect(() => {
    if (dialog !== "remote") return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setEntries([]);
    api
      .request<{ entries: Entry[] }>(
        `/sessions/${session.id}/files?path=${encodeURIComponent(path)}`,
        { signal: controller.signal },
      )
      .then((data) => {
        if (!controller.signal.aborted) setEntries(data.entries);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, session.id, dialog, path]);
  async function change(data: unknown) {
    if (saving || disabled) return;
    setSaving(true);
    setError("");
    try {
      await api.post(`/sessions/${session.id}/composer`, data);
      if (!mounted.current) return;
      const fresh = await api.request<Controls>(
        `/sessions/${session.id}/composer`,
      );
      if (!mounted.current) return;
      setControls(fresh);
      goalCallback.current?.(fresh.goal);
      setDialog(null);
      setMenu(false);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "设置失败，请重试");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  const openGoal = () => {
    setError("");
    if (controls?.goal_capabilities?.create === false && !goalMode) {
      setError(
        controls.goal_capabilities.reason ||
          "当前连接不支持新建目标，输入内容已保留",
      );
      return;
    }
    setMenu(false);
    onGoalMode();
  };
  return (
    <div className="composer-add" ref={host}>
      <button
        className="icon-button composer-add-trigger"
        title="添加"
        aria-label="添加"
        aria-expanded={menu}
        aria-controls={`composer-add-${session.id}`}
        disabled={disabled || saving}
        onClick={() => {
          setMenu(!menu);
          setError("");
        }}
      >
        <Plus size={20} />
      </button>
      {menu && (
        <div
          className="composer-add-menu"
          id={`composer-add-${session.id}`}
          role="group"
          aria-label="添加内容与模式"
        >
          <button
            onClick={() => {
              setMenu(false);
              onUpload();
            }}
          >
            <Upload size={18} />
            <span>
              上传文件<small>从当前设备选择文件</small>
            </span>
          </button>
          <button
            onClick={() => {
              setMenu(false);
              setPath("");
              setSelected({});
              setError("");
              setDialog("remote");
            }}
          >
            <FolderOpen size={18} />
            <span>
              添加远程文件<small>从当前工作目录选择</small>
            </span>
          </button>
          <div className="composer-add-separator" />
          <button onClick={openGoal}>
            <Target size={18} />
            <span>
              目标
              <small>
                {controls?.goal_capabilities?.create === false
                  ? "当前连接暂不支持新建目标"
                  : "设置持续推进的目标"}
              </small>
            </span>
            {goalMode && <Check size={16} />}
          </button>
          <button
            disabled={!controls?.plan_available || saving}
            onClick={() =>
              void change({ action: "plan", enabled: !controls?.plan })
            }
          >
            <Lightbulb size={18} />
            <span>
              计划模式
              <small>
                {controls?.plan ? "已开启，点击关闭" : "后续轮次先规划，再实施"}
              </small>
            </span>
            {controls?.plan && <Check size={16} />}
          </button>
          {(error || controlError) && (
            <p className="composer-add-error" role="alert">
              {error || controlError}
            </p>
          )}
        </div>
      )}
      {controls?.plan && (
        <button
          className="composer-mode-chip"
          title="关闭计划模式"
          disabled={disabled || saving}
          onClick={() => void change({ action: "plan", enabled: false })}
        >
          <Lightbulb size={14} />
          计划模式
          <X size={12} />
        </button>
      )}
      {!menu && !dialog && error && (
        <span className="composer-add-error" role="alert">
          {error}
        </span>
      )}
      {dialog &&
        createPortal(
          <div
            className="modal-shade"
            onClick={() => {
              if (!saving) setDialog(null);
            }}
          >
            <div
              className="modal composer-add-dialog"
              ref={modal}
              role="dialog"
              aria-modal="true"
              aria-label="添加远程文件"
              onClick={(e) => e.stopPropagation()}
            >
              <header>
                <h2>添加远程文件</h2>
                <button
                  className="icon-button"
                  aria-label="关闭添加窗口"
                  disabled={saving}
                  onClick={() => setDialog(null)}
                >
                  <X size={18} />
                </button>
              </header>
              <>
                <p className="composer-dialog-hint">
                  选择远程机器当前工作目录中的文件，不会重新上传。
                </p>
                <div className="remote-file-path">
                  <button
                    aria-label="上一级目录"
                    disabled={!path || loading}
                    onClick={() =>
                      setPath(path.split("/").slice(0, -1).join("/"))
                    }
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <span title={session.cwd + "/" + path}>
                    {session.cwd}
                    {path ? "/" + path : ""}
                  </span>
                </div>
                <div className="remote-file-list" aria-busy={loading}>
                  {loading ? (
                    <p role="status">正在读取文件…</p>
                  ) : entries.length ? (
                    entries.map((entry) => (
                      <button
                        key={entry.path}
                        aria-pressed={
                          !entry.directory ? !!selected[entry.path] : undefined
                        }
                        onClick={() =>
                          entry.directory
                            ? setPath(entry.path)
                            : setSelected((old) => {
                                const next = { ...old };
                                if (next[entry.path]) delete next[entry.path];
                                else next[entry.path] = entry;
                                return next;
                              })
                        }
                      >
                        {entry.directory ? (
                          <Folder size={17} />
                        ) : (
                          <File size={17} />
                        )}
                        <span>{entry.name}</span>
                        {selected[entry.path] && <Check size={16} />}
                      </button>
                    ))
                  ) : (
                    !error && <p>目录为空</p>
                  )}
                </div>
                {error && (
                  <p role="alert" className="composer-add-error">
                    {error}
                  </p>
                )}
                <footer>
                  <span>已选择 {Object.keys(selected).length} 个文件</span>
                  <button
                    className="primary"
                    disabled={!Object.keys(selected).length || loading}
                    onClick={() => {
                      onAttach(
                        Object.values(selected).map((e) => ({
                          name: e.name,
                          path: session.cwd.replace(/\/$/, "") + "/" + e.path,
                        })),
                      );
                      setDialog(null);
                    }}
                  >
                    添加文件
                  </button>
                </footer>
              </>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
