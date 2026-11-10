import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ExternalLink,
  FolderOpen,
  Settings,
  RefreshCw,
  Copy,
  Monitor,
  Smartphone,
  LockKeyhole,
  Network,
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
    [saving, setSaving] = useState(false),
    [copyFeedback, setCopyFeedback] = useState<{
      address: string;
      message: string;
    } | null>(null);
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
  const port = state?.config.port;
  const localAddress =
    typeof port === "number" &&
    Number.isInteger(port) &&
    port >= 1024 &&
    port <= 65535
      ? `http://127.0.0.1:${port}/`
      : null;
  async function copyLocalAddress() {
    if (!ready || !localAddress) return;
    try {
      await navigator.clipboard.writeText(localAddress);
      setCopyFeedback({ address: localAddress, message: "本地地址已复制" });
    } catch {
      setCopyFeedback({
        address: localAddress,
        message: "未能复制，请选中上方地址手动复制。",
      });
    }
  }
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
            <header className="page-heading">
              <div>
                <h1>这台电脑</h1>
                <p>
                  这是工作区的控制台。在本机浏览器工作，也能从其他设备继续。
                </p>
              </div>
            </header>
            <div className="access-layout">
              <section
                className="workspace-panel local-panel"
                aria-label="本地工作区"
              >
                <div className="panel-heading">
                  <Monitor size={20} aria-hidden="true" />
                  <h2>本地工作区</h2>
                </div>
                <p className="service-status" role="status">
                  <span className={ready ? "status-dot ready" : "status-dot"} />
                  {status}
                </p>
                <div className="local-address-block">
                  <div className="address-heading">
                    <span>本地访问地址</span>
                    <span className="address-scope">仅这台电脑</span>
                  </div>
                  <div className="address-value">
                    <code data-testid="local-address">
                      {localAddress ?? "地址暂不可用"}
                    </code>
                    <button
                      className="copy-address"
                      aria-label="复制本地地址"
                      disabled={!ready || !localAddress}
                      onClick={() => void copyLocalAddress()}
                    >
                      <Copy size={16} aria-hidden="true" />
                      复制
                    </button>
                  </div>
                  {!ready && localAddress && (
                    <p className="hint address-state">
                      已配置，服务就绪后可使用。
                    </p>
                  )}
                  <p className="copy-feedback" role="status" aria-live="polite">
                    {ready && copyFeedback?.address === localAddress
                      ? copyFeedback.message
                      : ""}
                  </p>
                </div>
                <button
                  className="primary open-workspace"
                  disabled={
                    opening || !state || updates.state?.phase === "installing"
                  }
                  onClick={() => void openWorkspace()}
                >
                  <ExternalLink size={17} aria-hidden="true" />
                  {opening ? "正在打开…" : "打开工作区"}
                </button>
                <p className="hint local-session-help">
                  首次使用、切换浏览器或本机会话过期时，请用上方按钮建立访问会话。已授权的同一浏览器可通过本地地址再次进入。
                </p>
                <div className="workspace-path">
                  <span>当前工作目录</span>
                  <strong>
                    {state?.info?.workspace ||
                      state?.config.workspace ||
                      "正在读取"}
                  </strong>
                </div>
                {state?.external && !ready && (
                  <p className="hint">
                    已有服务由其他进程管理。请在设置中选择它的数据目录，本应用会验证并复用。
                  </p>
                )}
              </section>
              <AccountPage localReady={Boolean(ready)} controller={account} />
            </div>
            <section className="principles" aria-labelledby="principle-title">
              <div className="principle-heading">
                <Network size={19} aria-hidden="true" />
                <h2 id="principle-title">工作原理</h2>
              </div>
              <p className="principle-intro">
                这台电脑运行 Agent，处理会话、文件和终端内容。
              </p>
              <div className="connection-paths">
                <div className="connection-path">
                  <Monitor size={20} aria-hidden="true" />
                  <div>
                    <h3>
                      本地浏览器 <span aria-hidden="true">→</span> 这台电脑
                    </h3>
                    <p>
                      通过本机地址访问，无需云账号。地址只在这台电脑有效，不能用于手机访问。
                    </p>
                  </div>
                </div>
                <div className="connection-path">
                  <Smartphone size={20} aria-hidden="true" />
                  <div>
                    <h3>
                      手机或远程网页 <span aria-hidden="true">→</span> 这台电脑
                    </h3>
                    <p>
                      登录同一账号发现设备，首次连接或身份变更时核对设备身份，通过端到端加密通道继续工作。
                    </p>
                  </div>
                </div>
              </div>
              <div className="privacy-note">
                <LockKeyhole size={17} aria-hidden="true" />
                <div>
                  <p>
                    云端负责登录、设备发现和连接协调，会处理账号与必要连接元数据。会话、文件和终端内容留在你的设备，远程连接在设备两端解密。
                  </p>
                  <p>
                    远程需要这台电脑开机、联网且已开启远程访问。关闭远程不影响本地工作。
                  </p>
                  <p>
                    本客户端的账号凭据和设备私钥只留在内存；退出客户端后需要重新登录并开启远程访问。
                  </p>
                </div>
              </div>
            </section>
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
            <section className="workspace-panel settings-panel">
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
            <details className="workspace-panel settings-panel">
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
