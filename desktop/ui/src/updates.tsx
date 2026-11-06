import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { version as appVersion } from "../package.json";

export type UpdateSnapshot = {
  currentVersion: string;
  version: string;
  notes: string;
  phase:
    | "idle"
    | "checking"
    | "downloading"
    | "ready"
    | "installing"
    | "error"
    | "unsupported";
  downloaded: number;
  total: number | null;
  lastChecked: number | null;
  error: string;
  enabled: boolean;
  showNotice: boolean;
  supported: boolean;
};
const invoke = <T,>(command: string, args?: Record<string, unknown>) =>
  window.__TAURI__!.core.invoke<T>(command, args);

export function useDesktopUpdates() {
  const [state, setState] = useState<UpdateSnapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await invoke<UpdateSnapshot>("desktop_update_snapshot");
        if (live) setState(next);
      } catch {
        /* The manager and its controls remain usable if updater IPC fails. */
      }
      if (live) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  async function action(command: string, args?: Record<string, unknown>) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const next = await invoke<UpdateSnapshot | null>(command, args);
      if (next) setState(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  return { state, error, pending, action };
}
type Controller = ReturnType<typeof useDesktopUpdates>;
export function UpdateNotice({
  controller,
  open,
}: {
  controller: Controller;
  open: () => void;
}) {
  if (!controller.state?.showNotice) return null;
  return (
    <div className="update-notice" role="status">
      <Download size={17} />
      <span>新版本 {controller.state.version} 已准备好</span>
      <button onClick={open}>查看更新</button>
      <button
        className="update-later"
        disabled={controller.pending}
        onClick={() =>
          void controller.action("desktop_update_defer", {
            version: controller.state?.version,
          })
        }
      >
        稍后提醒
      </button>
    </div>
  );
}
export function UpdatePage({ controller }: { controller: Controller }) {
  const { state, error, pending, action } = controller;
  const [confirm, setConfirm] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const installing = state?.phase === "installing";
  const busy =
    pending ||
    installing ||
    state?.phase === "checking" ||
    state?.phase === "downloading";
  useEffect(() => {
    if (confirm) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [confirm]);
  function close() {
    if (installing || pending) return;
    setConfirm(null);
    confirmButton.current?.focus();
  }
  const title =
    state?.phase === "ready"
      ? `版本 ${state.version} 已准备好`
      : state?.phase === "downloading"
        ? `正在后台下载 ${state.version}`
        : state?.phase === "checking"
          ? "正在检查更新"
          : installing
            ? "正在更新 AnyWork"
            : state?.phase === "unsupported"
              ? "此运行方式需要手动更新"
              : state?.phase === "error"
                ? "暂时无法完成更新检查"
                : state?.lastChecked
                  ? "你正在使用最新版本"
                  : "让 AnyWork 保持更新";
  return (
    <>
      <header>
        <div>
          <h1>软件更新</h1>
          <p>下载在后台完成，由你决定何时安装。</p>
        </div>
      </header>
      <section className="update-overview" aria-label="更新状态">
        <div className="update-product">
          <span className="update-mark">W</span>
          <div>
            <h2>AnyWork</h2>
            <p>当前版本 {state?.currentVersion || appVersion}</p>
          </div>
        </div>
        <div className="update-state">
          {busy ? (
            <LoaderCircle size={20} className="spin" />
          ) : state?.phase === "ready" ? (
            <Check size={20} />
          ) : (
            <ShieldCheck size={20} />
          )}
          <div>
            <h3>{title}</h3>
            <p>
              {state?.phase === "ready"
                ? "更新包已下载并通过签名校验。稍后安装也可以继续工作。"
                : state?.phase === "downloading"
                  ? "你可以继续使用 AnyWork，下载完成后会显示轻量提醒。"
                  : installing
                    ? "正在安装并重新启动，请稍候。"
                    : state?.phase === "unsupported"
                      ? "请使用 macOS 应用、Windows 安装版或 Linux AppImage。开发构建和便携目录不自动替换文件。"
                      : state?.phase === "error"
                        ? "当前版本可以继续使用。启用自动更新时会在后台重试。"
                        : "自动检查正式发行版。安装前会请你确认，不会自行重启。"}
            </p>
          </div>
        </div>
        {state?.phase === "downloading" && (
          <div className="update-download">
            <progress
              aria-label="更新下载进度"
              value={
                state.total
                  ? Math.min(state.downloaded, state.total)
                  : undefined
              }
              max={state.total || undefined}
            />
            <span>
              {(state.downloaded / 1048576).toFixed(1)} MB
              {state.total ? ` / ${(state.total / 1048576).toFixed(1)} MB` : ""}
            </span>
          </div>
        )}
        {(error || state?.error) && (
          <p className="update-error" role="alert">
            {error || state?.error}
          </p>
        )}
        <div className="update-actions">
          {state?.phase === "ready" ? (
            <>
              <button
                ref={confirmButton}
                className="primary"
                disabled={busy}
                onClick={() => setConfirm(state.version)}
              >
                <RefreshCw size={15} />
                更新并重启
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action("desktop_update_defer", {
                    version: state.version,
                  })
                }
              >
                稍后提醒
              </button>
            </>
          ) : state?.supported ? (
            <button
              disabled={busy}
              onClick={() => void action("desktop_update_check")}
            >
              <RefreshCw size={15} />
              {busy ? "正在处理…" : "检查更新"}
            </button>
          ) : null}
          <button onClick={() => void action("desktop_update_open_releases")}>
            <ExternalLink size={14} />
            发行说明
          </button>
        </div>
        {state?.lastChecked && (
          <p className="update-last-check">
            上次检查：{new Date(state.lastChecked * 1000).toLocaleString()}
          </p>
        )}
      </section>
      <section className="update-preference">
        <div>
          <h3>自动检查并后台下载</h3>
          <p>启动后及每 6 小时检查一次。下载失败会重试，安装始终需要确认。</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="自动检查并后台下载"
          aria-checked={state?.enabled ?? true}
          className={`switch ${state?.enabled ? "on" : ""}`}
          disabled={pending || !state?.supported || installing}
          onClick={() =>
            void action("desktop_update_preferences", {
              enabled: !state?.enabled,
            })
          }
        >
          <span />
        </button>
      </section>
      {state?.notes && (
        <details className="update-release-notes">
          <summary>版本 {state.version} 更新内容</summary>
          <pre>{state.notes}</pre>
        </details>
      )}
      <dialog
        ref={dialog}
        className="install-dialog update-confirm"
        aria-labelledby="update-confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const rect = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < rect.left ||
              e.clientX > rect.right ||
              e.clientY < rect.top ||
              e.clientY > rect.bottom
            )
              close();
          }
        }}
      >
        <div className="install-symbol">
          <RefreshCw size={24} />
        </div>
        <h2 id="update-confirm-title">更新到 {confirm}？</h2>
        <p>
          AnyWork
          将安装已下载的更新并重启。本应用开启的服务与远程连接会短暂断开，重启后自动恢复；匿名隧道地址可能变化。
        </p>
        <p className="hint">
          请在任务空闲时更新。仍有本应用管理的会话执行或等待确认时，会保留更新包，待任务结束后再试。工作目录、会话和访问密钥会保留。
        </p>
        {(error || state?.error) && (
          <p role="alert" className="error">
            {error || state?.error}
          </p>
        )}
        <div className="install-actions">
          <button autoFocus disabled={pending || installing} onClick={close}>
            稍后
          </button>
          <button
            className="primary"
            disabled={
              pending ||
              installing ||
              state?.phase !== "ready" ||
              state.version !== confirm
            }
            onClick={() =>
              void action("desktop_update_install", { version: confirm })
            }
          >
            {installing || pending ? "正在安装…" : "确认更新"}
          </button>
        </div>
      </dialog>
    </>
  );
}
