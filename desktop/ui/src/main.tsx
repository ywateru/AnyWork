import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ExternalLink,
  FolderOpen,
  Settings,
  RefreshCw,
} from "lucide-react";
import { AccountPage, useAccountController } from "./accounts";
import { UpdateNotice, UpdatePage, useDesktopUpdates } from "./updates";
import { anyworkLogo } from "./brand";
import type { Config, Snapshot } from "./types";
import "./style.css";
declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke: <T>(
          command: string,
          args?: Record<string, unknown>,
        ) => Promise<T>;
      };
    };
  }
}
const invoke = <T,>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> =>
  window.__TAURI__
    ? window.__TAURI__.core.invoke<T>(command, args)
    : Promise.reject(new Error("请从 AnyWork 桌面应用打开此页面。"));
function App() {
  const account = useAccountController(),
    updates = useDesktopUpdates();
  const [state, setState] = useState<Snapshot | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [page, setPage] = useState("workspace"),
    [error, setError] = useState(""),
    [opening, setOpening] = useState(false),
    [saving, setSaving] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await invoke<Snapshot>("desktop_snapshot");
        if (!live) return;
        setState(next);
        if (!initialized.current) {
          initialized.current = true;
          setConfig(next.config);
        }
      } catch {
        if (live) setError("无法读取本机状态，请稍后重试。");
      }
      if (live) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  async function openWorkspace() {
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      await invoke("desktop_open");
    } catch (e) {
      setError(
        typeof e === "string"
          ? e
          : "无法打开本地工作区，请检查服务设置后重试。",
      );
    } finally {
      setOpening(false);
    }
  }
  async function action(type: string) {
    if (!config || saving) return;
    setSaving(true);
    setError("");
    try {
      await invoke("desktop_action", { action: { type, config } });
    } catch (e) {
      setError(typeof e === "string" ? e : "设置未保存，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }
  async function choose(key: "workspace" | "dataDirectory" | "serverBinary") {
    const path = await invoke<string | null>("desktop_pick", {
      folder: key !== "serverBinary",
    });
    if (path) setConfig((c) => (c ? { ...c, [key]: path } : c));
  }
  const ready = state?.authorized && state.service === "running";
  const status = opening
    ? "正在准备工作区"
    : ready
      ? state.external
        ? "已就绪 · 复用已有服务"
        : "已就绪"
      : state?.service === "starting" || state?.service === "checking"
        ? "正在准备"
        : state?.service === "error"
          ? "需要检查"
          : "未启动";
  return (
    <div className="desktop-shell">
      <nav className="app-bar" aria-label="主导航">
        <button className="brand" onClick={() => setPage("workspace")}>
          <img src={anyworkLogo} width="28" height="28" alt="" />
          AnyWork
        </button>
        <div className="actions">
          <button
            aria-pressed={page === "settings"}
            onClick={() => setPage("settings")}
          >
            <Settings size={16} />
            设置
          </button>
          <button
            aria-pressed={page === "updates"}
            onClick={() => setPage("updates")}
          >
            <RefreshCw size={16} />
            更新
          </button>
        </div>
      </nav>
      <main className="workspace-surface">
        <UpdateNotice controller={updates} open={() => setPage("updates")} />
        {page !== "workspace" && (
          <button className="back" onClick={() => setPage("workspace")}>
            <ArrowLeft size={16} />
            返回工作区
          </button>
        )}
        {page === "workspace" && (
          <>
            <header>
              <div>
                <h1>这台电脑</h1>
                <p>在本机工作，或从其他设备继续。</p>
              </div>
            </header>
            <section className="workspace-panel" aria-label="本地工作区">
              <div className="section-heading">
                <div>
                  <h2>本地工作区</h2>
                  <p role="status">
                    <span
                      className={ready ? "status-dot ready" : "status-dot"}
                    />
                    {status}
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={
                    opening || !state || updates.state?.phase === "installing"
                  }
                  onClick={() => void openWorkspace()}
                >
                  <ExternalLink size={17} />
                  {opening ? "正在打开…" : "打开工作区"}
                </button>
              </div>
              <p className="workspace-path">
                <span>工作目录</span>
                <strong>
                  {state?.info?.workspace ||
                    state?.config.workspace ||
                    "正在读取"}
                </strong>
              </p>
              <p className="hint">
                无需云账号即可使用本地工作区。浏览器会话只在这台电脑有效。
              </p>
              {state?.external && !ready && (
                <p className="hint">
                  已有服务由其他进程管理。请在设置中选择它的数据目录，本应用会验证并复用。
                </p>
              )}
            </section>
            <AccountPage localReady={Boolean(ready)} controller={account} />
          </>
        )}
        {page === "settings" && config && (
          <>
            <header>
              <div>
                <h1>本机设置</h1>
                <p>选择工作目录和已有服务的数据目录。</p>
              </div>
            </header>
            <section className="workspace-panel">
              <h2>本地服务</h2>
              <p className="hint">
                本机访问自动建立安全会话，无需输入或复制访问密钥。已有服务和数据不会被替换。
              </p>
              {(
                [
                  ["workspace", "工作目录"],
                  ["dataDirectory", "服务数据目录"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <div className="input-actions">
                    <input
                      aria-label={label}
                      value={config[key]}
                      onChange={(e) =>
                        setConfig({ ...config, [key]: e.target.value })
                      }
                    />
                    <button
                      aria-label={`选择${label}`}
                      onClick={() => void choose(key)}
                    >
                      <FolderOpen size={17} />
                    </button>
                  </div>
                </label>
              ))}
              <label>
                本机端口
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={config.port}
                  onChange={(e) =>
                    setConfig({ ...config, port: Number(e.target.value) })
                  }
                />
              </label>
              <button
                disabled={saving || state?.owned}
                onClick={() => void action("save_service")}
              >
                保存本机设置
              </button>
              {state?.owned && (
                <p className="hint">本应用的服务运行时不能修改目录和端口。</p>
              )}
            </section>
            <details className="workspace-panel">
              <summary>服务程序</summary>
              <label>
                服务程序路径
                <div className="input-actions">
                  <input
                    aria-label="服务程序路径"
                    value={config.serverBinary}
                    onChange={(e) =>
                      setConfig({ ...config, serverBinary: e.target.value })
                    }
                  />
                  <button
                    aria-label="选择服务程序"
                    onClick={() => void choose("serverBinary")}
                  >
                    <FolderOpen size={17} />
                  </button>
                </div>
              </label>
              <button
                disabled={saving || state?.owned}
                onClick={() => void action("save_programs")}
              >
                保存程序位置
              </button>
            </details>
            {state?.owned && (
              <section className="workspace-panel">
                <h2>本应用启动的服务</h2>
                <p className="hint">
                  停止本地服务会中断当前工作区和账号远程访问。任务执行时会拒绝停止。
                </p>
                <button
                  disabled={saving}
                  onClick={() => void action("stop_server")}
                >
                  停止本地服务
                </button>
              </section>
            )}
          </>
        )}
        {page === "updates" && <UpdatePage controller={updates} />}
        {(error || state?.error) && (
          <p className="error" role="alert">
            {error || state?.error}
          </p>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
