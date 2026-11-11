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
  LockKeyhole,
  LoaderCircle,
  ArrowRight,
} from "lucide-react";
import {
  AccountPage,
  AccountEntry,
  AccountActions,
  accountStatusText,
  useAccountController,
} from "./accounts";
import { Introduction, Stepper, RemoteClients } from "./onboarding";
import { useWorkspacePreparation } from "./startup";
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
    [introduced, setIntroduced] = useState(false),
    [snapshotAvailable, setSnapshotAvailable] = useState(false),
    [copyFeedback, setCopyFeedback] = useState<{
      address: string;
      message: string;
    } | null>(null);
  const startup = useWorkspacePreparation(account, introduced);
  const initialized = useRef(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await invoke<Snapshot>("desktop_snapshot");
        if (!live) return;
        setState(next);
        setSnapshotAvailable(true);
        if (!initialized.current) {
          initialized.current = true;
          setConfig(next.config);
        }
      } catch {
        if (live) setSnapshotAvailable(false);
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
    if (
      opening ||
      !startup.canSubmit ||
      startup.phase !== "prepared" ||
      !snapshotAvailable ||
      state?.service !== "running" ||
      !state.authorized
    )
      return;
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
  const ready =
    snapshotAvailable && state?.authorized && state.service === "running";
  const stage = !introduced
    ? "intro"
    : !startup.active
      ? "account"
      : startup.phase === "prepared" && ready
        ? "console"
        : "prepare";
  const port = state?.config.port;
  const localAddress =
    typeof port === "number" &&
    Number.isInteger(port) &&
    port >= 1024 &&
    port <= 65535
      ? `http://127.0.0.1:${port}/`
      : null;
  async function copyLocalAddress() {
    if (!ready || !startup.canSubmit || !localAddress) return;
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
            返回
          </button>
        )}
        {page === "workspace" && stage === "intro" && (
          <>
            <Stepper stage="intro" />
            <Introduction next={() => setIntroduced(true)} />
          </>
        )}
        {page === "workspace" && stage === "account" && (
          <>
            <Stepper stage="account" />
            <div className="account-stage">
              <div className="stage-symbol">
                <LockKeyhole size={28} aria-hidden="true" />
              </div>
              <header>
                <div>
                  <h1>登录，让其他设备找到这台电脑</h1>
                  <p>一个账号，连接你自己的工作设备。</p>
                </div>
              </header>
              <AccountEntry controller={account} />
            </div>
          </>
        )}
        {page === "workspace" && stage === "prepare" && (
          <>
            <Stepper stage="prepare" />
            <section className="preparation-stage" aria-label="准备工作区">
              <div className="stage-symbol">
                {startup.phase === "failed" || state?.service === "error" ? (
                  <Settings size={28} aria-hidden="true" />
                ) : (
                  <LoaderCircle size={28} className="spin" aria-hidden="true" />
                )}
              </div>
              <header>
                <div>
                  <h1>
                    {startup.phase === "failed" || state?.service === "error"
                      ? "工作区还没有就绪"
                      : "正在准备你的工作区"}
                  </h1>
                  <p role="status">
                    {!account.available
                      ? "账号状态暂不可用，正在核验。"
                      : startup.phase === "failed"
                        ? "服务准备未完成，请检查后手动重试。"
                        : "正在启动或核验本地服务，就绪后将准备远程访问。"}
                  </p>
                </div>
              </header>
              {account.state && (
                <p className="preparation-account">
                  {accountStatusText(account.state)}
                </p>
              )}
              {(startup.error || state?.service === "error") && (
                <p role="alert" className="error">
                  {startup.error || "本地服务需要检查，请调整设置后重试。"}
                </p>
              )}
              {(startup.phase === "failed" ||
                (startup.phase === "prepared" && !ready)) && (
                <div className="stage-actions">
                  <button
                    className="primary"
                    disabled={!startup.canSubmit}
                    onClick={() => void startup.retry()}
                  >
                    重试准备
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                  <button onClick={() => setPage("settings")}>打开设置</button>
                </div>
              )}
              {!snapshotAvailable && (
                <p className="hint" role="status">
                  本机状态暂不可用。恢复读取后会核验服务，不会重复自动提交启动。
                </p>
              )}
              <div className="preparation-account-actions">
                <AccountActions controller={account} />
              </div>
            </section>
          </>
        )}
        {page === "workspace" && stage === "console" && (
          <>
            <header className="console-heading">
              <div>
                <h1>这台电脑的工作区</h1>
                <p>在本机浏览器工作，也能从其他设备继续。</p>
              </div>
              <div className="console-account">
                <p role="status">
                  {account.state
                    ? accountStatusText(account.state)
                    : "正在核验账号状态"}
                </p>
                <AccountActions controller={account} />
              </div>
            </header>
            {!account.available && (
              <p className="notice" role="status">
                账号状态暂不可用，正在核验。恢复前无法提交新的访问操作。
              </p>
            )}
            <div className="console-access-layout">
              <section className="local-panel" aria-label="本地工作区">
                <div className="panel-heading">
                  <Monitor size={20} aria-hidden="true" />
                  <h2>本地使用</h2>
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
                      disabled={!ready || !startup.canSubmit || !localAddress}
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
                    opening ||
                    !startup.canSubmit ||
                    !ready ||
                    updates.state?.phase === "installing"
                  }
                  onClick={() => void openWorkspace()}
                >
                  <ExternalLink size={17} aria-hidden="true" />
                  {opening ? "正在打开…" : "打开本地工作区"}
                </button>
                <p className="hint local-session-help">
                  首次使用、切换浏览器或会话过期时，请用上方按钮进入。
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
              <AccountPage
                localReady={Boolean(ready && startup.canSubmit)}
                controller={account}
              />
            </div>
            <RemoteClients controller={account} />
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
            <details className="workspace-panel privacy-settings">
              <summary>连接与隐私说明</summary>
              <p>
                工作内容留在设备，远程连接端到端加密。云端处理账号与必要连接元数据。
              </p>
              <p>
                登录并准备本地工作区后默认开启远程，可以随时关闭。远程需要这台电脑开机联网；关闭远程不停止本地服务。
              </p>
              <p>
                本客户端的账号凭据和设备私钥只留在内存；退出客户端后需要重新登录。新登录会再次采用默认开启远程的策略。
              </p>
              <p>
                首次使用、切换浏览器或本机会话过期时，请点击“打开本地工作区”建立访问会话。
              </p>
            </details>
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
        {(error || (page === "settings" && state?.error)) && (
          <p className="error" role="alert">
            {error || state?.error}
          </p>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
