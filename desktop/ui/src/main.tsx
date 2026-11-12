import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ExternalLink,
  FolderOpen,
  Settings,
  RefreshCw,
  Copy,
  PanelTop,
  Radio,
  CircleUserRound,
  ChevronRight,
  PanelLeft,
} from "lucide-react";
import {
  AccountPage,
  AccountEntry,
  AccountActions,
  AccountError,
  accountStatusText,
  accountDisplayName,
  remoteStatusText,
  useAccountController,
} from "./accounts";
import { Introduction, Stepper, RemoteClients } from "./onboarding";
import { useWorkspacePreparation } from "./startup";
import { UpdateNotice, UpdatePage, useDesktopUpdates } from "./updates";
import { ConfirmDialog } from "./confirm";
import { DeviceNameEditor } from "./device-name";
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
type Page = "workspace" | "remote" | "settings" | "updates" | "account";
type Confirmation =
  { kind: "discard"; page: Page } | { kind: "stop" | "logout" };
const editableKeys = [
  "workspace",
  "dataDirectory",
  "port",
  "serverBinary",
] as const;

function App() {
  const account = useAccountController(),
    updates = useDesktopUpdates();
  const [state, setState] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [savedConfig, setSavedConfig] = useState<Config | null>(null);
  const [page, setPage] = useState<Page>("workspace");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [introduced, setIntroduced] = useState(false);
  const [snapshotAvailable, setSnapshotAvailable] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{
    address: string;
    message: string;
  } | null>(null);
  const [saveFeedback, setSaveFeedback] = useState("");
  const [deviceNameDirty, setDeviceNameDirty] = useState(false);
  const [nativeChrome, setNativeChrome] = useState<
    "macos-overlay" | "standard" | null
  >(null);
  const startup = useWorkspacePreparation(account, introduced);
  const initialized = useRef(false);
  useEffect(() => {
    let live = true;
    void invoke<string>("desktop_chrome")
      .then((chrome) => {
        if (live && ["macos-overlay", "standard"].includes(chrome))
          setNativeChrome(chrome as "macos-overlay" | "standard");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const formState = useRef({ dirty: false });
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
          setSavedConfig(next.config);
        } else if (!formState.current.dirty) {
          setConfig(next.config);
          setSavedConfig(next.config);
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
  const dirty = Boolean(
    config &&
    savedConfig &&
    editableKeys.some((key) => config[key] !== savedConfig[key]),
  );
  formState.current = { dirty };
  const localReady = Boolean(
    snapshotAvailable && state?.authorized && state.service === "running",
  );
  const installing = updates.state?.phase === "installing";
  const settingsLocked =
    !snapshotAvailable ||
    !state ||
    state.owned ||
    ["starting", "stopping"].includes(state.service) ||
    saving ||
    installing;
  // Once prepared, retain the local page while observations are unavailable.
  // Cached readiness never permits a new operation.
  const stage = !introduced
    ? "intro"
    : !startup.active
      ? "account"
      : startup.phase === "prepared"
        ? "console"
        : "prepare";
  const businessNavigation = stage === "console";
  const lastActive = useRef(startup.active);
  useEffect(() => {
    if (lastActive.current && !startup.active) {
      setPage("workspace");
      setConfirmation(null);
      setDeviceNameDirty(false);
      setError("");
    }
    lastActive.current = startup.active;
  }, [startup.active]);
  const port = state?.config.port;
  const localAddress =
    typeof port === "number" &&
    Number.isInteger(port) &&
    port >= 1024 &&
    port <= 65535
      ? `http://127.0.0.1:${port}/`
      : null;
  const canOpen =
    startup.canSubmit &&
    startup.phase === "prepared" &&
    localReady &&
    !installing;
  const status = !snapshotAvailable
    ? "本机状态暂不可用"
    : !account.available
      ? "账号状态暂不可用"
      : localReady
        ? state?.external
          ? "已就绪 · 复用已有服务"
          : "已就绪"
        : ["starting", "checking", "validating"].includes(state?.service ?? "")
          ? "正在准备"
          : state?.service === "error"
            ? "需要检查"
            : "未启动";

  function navigate(next: Page) {
    if (next === page) return;
    if (
      (page === "settings" && dirty) ||
      (page === "workspace" && deviceNameDirty)
    ) {
      setConfirmation({ kind: "discard", page: next });
      return;
    }
    setPage(next);
    setNavOpen(false);
    setError("");
  }
  async function openWorkspace() {
    if (opening || !canOpen) return;
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
  async function action(
    type: "save_service" | "save_programs" | "stop_server",
  ) {
    if (!config || saving || !snapshotAvailable || installing) return;
    if (type === "stop_server" ? !state?.owned : settingsLocked) return;
    const submitted = { ...config };
    setSaving(true);
    setError("");
    setSaveFeedback("");
    try {
      await invoke("desktop_action", { action: { type, config: submitted } });
      if (type !== "stop_server") {
        const keys =
          type === "save_service"
            ? (["workspace", "dataDirectory", "port"] as const)
            : (["serverBinary"] as const);
        setSavedConfig((previous) => {
          if (!previous) return previous;
          const next = { ...previous };
          for (const key of keys)
            Object.assign(next, { [key]: submitted[key] });
          return next;
        });
        setSaveFeedback(
          type === "save_service" ? "本机设置已保存" : "程序位置已保存",
        );
      }
      const next = await invoke<Snapshot>("desktop_snapshot");
      setState(next);
      setSnapshotAvailable(true);
      setConfirmation(null);
    } catch (e) {
      setError(
        typeof e === "string" ? e : "操作未完成，请核对服务状态后重试。",
      );
      // A native refusal remains visible on the settings page.
      setConfirmation(null);
    } finally {
      setSaving(false);
    }
  }
  async function choose(key: "workspace" | "dataDirectory" | "serverBinary") {
    if (settingsLocked) return;
    try {
      const path = await invoke<string | null>("desktop_pick", {
        folder: key !== "serverBinary",
      });
      if (path)
        setConfig((current) =>
          current ? { ...current, [key]: path } : current,
        );
    } catch {
      setError("无法打开文件选择器，请重试。");
    }
  }
  async function copyLocalAddress() {
    if (!canOpen || !localAddress) return;
    const address = localAddress;
    try {
      await navigator.clipboard.writeText(address);
      setCopyFeedback({ address, message: "本地地址已复制" });
    } catch {
      setCopyFeedback({
        address,
        message: "未能复制，请选中上方地址手动复制。",
      });
    }
  }
  function requestLogout() {
    setConfirmation({ kind: "logout" });
  }
  async function confirm() {
    if (confirmation?.kind === "discard") {
      const currentSaved = state?.config ?? savedConfig;
      setConfig(currentSaved ? { ...currentSaved } : null);
      setSavedConfig(currentSaved ? { ...currentSaved } : null);
      setConfirmation(null);
      setDeviceNameDirty(false);
      setPage(confirmation.page);
      setNavOpen(false);
      setError("");
    } else if (confirmation?.kind === "stop") {
      await action("stop_server");
    } else if (confirmation?.kind === "logout") {
      if (!account.available || account.pending || installing) return;
      await account.logout();
      setConfirmation(null);
    }
  }
  const titles: Record<Page, string> = {
    workspace: businessNavigation ? "这台电脑" : "开始使用",
    remote: "远程访问",
    settings: "本机设置",
    updates: "软件更新",
    account: "账号",
  };
  const navigation = (target: Page, label: string, symbol: React.ReactNode) => (
    <button
      key={target}
      className="sidebar-link"
      aria-current={page === target ? "page" : undefined}
      onClick={() => navigate(target)}
    >
      {symbol}
      <span>{label}</span>
    </button>
  );
  return (
    <div
      className={`desktop-shell${navOpen ? " navigation-open" : ""}${nativeChrome === "macos-overlay" ? " macos-overlay" : ""}`}
    >
      {nativeChrome === "macos-overlay" && (
        <div
          className="native-window-drag-region"
          aria-hidden="true"
          onMouseDown={(event) => {
            if (event.button === 0) {
              event.preventDefault();
              event.stopPropagation();
              void invoke("desktop_drag").catch(() => {});
            }
          }}
        />
      )}
      <aside className="desktop-sidebar" aria-label="应用侧栏">
        <button
          className="brand"
          onClick={() => navigate("workspace")}
          aria-label="AnyWork 首页"
        >
          <img src={anyworkLogo} width="28" height="28" alt="" />
          <span>AnyWork</span>
        </button>
        <button
          className="mobile-navigation quiet"
          aria-label="展开或收起导航"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(!navOpen)}
        >
          <PanelLeft size={17} />
        </button>
        <nav className="sidebar-navigation" aria-label="主导航">
          <div className="sidebar-primary">
            {businessNavigation ? (
              <>
                {navigation("workspace", "工作区", <PanelTop size={16} />)}
                {navigation("remote", "远程访问", <Radio size={16} />)}
              </>
            ) : (
              <Stepper stage={stage} />
            )}
          </div>
          <div className="sidebar-secondary">
            {navigation("settings", "设置", <Settings size={16} />)}
            {navigation("updates", "更新", <RefreshCw size={16} />)}
            {businessNavigation && (
              <div className="sidebar-account">
                {navigation(
                  "account",
                  account.available
                    ? accountDisplayName(account.state)
                    : "账号状态暂不可用",
                  <CircleUserRound size={16} />,
                )}
              </div>
            )}
          </div>
        </nav>
      </aside>
      <div className="desktop-content">
        <header
          className="desktop-titlebar"
          onMouseDown={(event) => {
            if (
              nativeChrome === "macos-overlay" &&
              event.button === 0 &&
              !(event.target as HTMLElement).closest("button, a, input")
            ) {
              event.preventDefault();
              event.stopPropagation();
              void invoke("desktop_drag").catch(() => {});
            }
          }}
        >
          <h1>{titles[page]}</h1>
          {page !== "workspace" && (
            <button
              className="quiet back"
              onClick={() => navigate("workspace")}
            >
              <ArrowLeft size={15} />
              返回
            </button>
          )}
        </header>
        <main className="workspace-surface">
          {page !== "updates" && (
            <UpdateNotice
              controller={updates}
              open={() => navigate("updates")}
            />
          )}
          {page === "workspace" && stage === "intro" && (
            <Introduction next={() => setIntroduced(true)} />
          )}
          {page === "workspace" && stage === "account" && (
            <section className="account-stage">
              <h2>登录，让其他设备找到这台电脑</h2>
              <AccountEntry controller={account} />
            </section>
          )}
          {page === "workspace" && stage === "prepare" && (
            <section className="preparation-stage" aria-label="准备工作区">
              <h2>
                {startup.phase === "failed" || state?.service === "error"
                  ? "工作区还没有就绪"
                  : "正在准备你的工作区"}
              </h2>
              <p className="hint" role="status">
                {!account.available
                  ? "账号状态暂不可用，正在核验。"
                  : startup.phase === "failed"
                    ? "服务准备未完成，请检查后手动重试。"
                    : "正在启动或核验本地服务，就绪后将准备远程访问。"}
              </p>
              {account.state && (
                <p className="preparation-account">
                  {accountStatusText(account.state)}
                </p>
              )}
              {(startup.error || state?.service === "error") && (
                <details className="error-details">
                  <summary>诊断详情</summary>
                  <p className="error" role="alert">
                    {startup.error || "本地服务需要检查，请调整设置后重试。"}
                  </p>
                </details>
              )}
              {startup.phase === "failed" && (
                <div className="stage-actions">
                  <button
                    className="primary"
                    disabled={!startup.canSubmit}
                    onClick={() => void startup.retry()}
                  >
                    重试准备
                  </button>
                  <button onClick={() => navigate("settings")}>打开设置</button>
                </div>
              )}
              {!snapshotAvailable && (
                <p className="hint" role="status">
                  本机状态暂不可用。恢复读取后会核验服务，不会重复自动提交启动。
                </p>
              )}
              <div className="preparation-account-actions">
                <AccountActions controller={account} onLogout={requestLogout} />
              </div>
            </section>
          )}
          {page === "workspace" && stage === "console" && (
            <>
              <DeviceNameEditor
                name={
                  typeof account.state?.deviceName === "string" &&
                  account.state.deviceName
                    ? account.state.deviceName
                    : null
                }
                synced={
                  account.available &&
                  typeof account.state?.deviceNameSynced === "boolean"
                    ? account.state.deviceNameSynced
                    : null
                }
                disabled={
                  !account.available ||
                  !snapshotAvailable ||
                  account.pending ||
                  account.remotePending ||
                  Boolean(account.state?.busy) ||
                  installing
                }
                onSave={account.renameDevice}
                onDirtyChange={setDeviceNameDirty}
              />
              <section className="local-panel" aria-label="本地工作区">
                <div className="panel-heading">
                  <h2>本地工作区</h2>
                  <p className="service-status" role="status">
                    <span
                      className={canOpen ? "status-dot ready" : "status-dot"}
                    />
                    {status}
                  </p>
                </div>
                <button
                  className="primary open-workspace"
                  disabled={opening || !canOpen}
                  onClick={() => void openWorkspace()}
                >
                  <ExternalLink size={16} />
                  {opening ? "正在打开…" : "打开本地工作区"}
                </button>
                {!localReady && snapshotAvailable && (
                  <button
                    className="retry-local"
                    disabled={!startup.canSubmit || installing}
                    onClick={() => void startup.retry()}
                  >
                    重新准备工作区
                  </button>
                )}
                <div className="local-address-block">
                  <span className="address-heading">本地地址</span>
                  <code data-testid="local-address">
                    {localAddress ?? "地址暂不可用"}
                  </code>
                  <button
                    className="copy-address quiet"
                    aria-label="复制本地地址"
                    disabled={!canOpen || !localAddress}
                    onClick={() => void copyLocalAddress()}
                  >
                    <Copy size={15} />
                    复制
                  </button>
                </div>
                <p className="hint local-session-help">
                  首次使用、切换浏览器或会话过期时，请用上方按钮进入。
                </p>
                {!localReady && localAddress && (
                  <p className="hint address-state">
                    已配置，服务就绪后可使用。
                  </p>
                )}
                <p className="copy-feedback" role="status" aria-live="polite">
                  {canOpen && copyFeedback?.address === localAddress
                    ? copyFeedback.message
                    : ""}
                </p>
                <div className="workspace-path">
                  <FolderOpen size={15} />
                  <span>工作目录</span>
                  <strong>
                    {state?.info?.workspace ||
                      state?.config.workspace ||
                      "正在读取"}
                  </strong>
                </div>
              </section>
              <button
                className="remote-summary quiet"
                aria-label="管理远程访问"
                onClick={() => navigate("remote")}
              >
                <Radio size={16} />
                <span>远程访问</span>
                <span className="remote-summary-status" role="status">
                  {remoteStatusText(account)}
                </span>
                <ChevronRight size={16} />
              </button>
            </>
          )}
          {page === "remote" && businessNavigation && (
            <>
              <AccountPage
                localReady={Boolean(
                  localReady && startup.canSubmit && !installing,
                )}
                controller={account}
              />
              <RemoteClients controller={account} />
            </>
          )}
          {page === "account" && businessNavigation && (
            <section className="account-page" aria-label="账号管理">
              <div className="account-identity">
                <div>
                  <h2>
                    {account.available
                      ? accountDisplayName(account.state)
                      : "账号状态暂不可用"}
                  </h2>
                  <p className="hint" role="status">
                    {account.available && account.state
                      ? accountStatusText(account.state)
                      : "正在核验账号状态"}
                  </p>
                </div>
                <AccountActions controller={account} onLogout={requestLogout} />
              </div>
              <p className="hint">
                退出账号会关闭远程访问，保留已运行的本地工作。再次从桌面打开工作区需重新登录。
              </p>
              <AccountError controller={account} />
            </section>
          )}
          {page === "settings" && config && (
            <>
              <p className="page-description">工作目录、服务位置与连接说明。</p>
              {state?.external && (
                <p className="notice">
                  已核验并复用外部服务。保存连接配置后会重新核验，不停止或替换外部服务。
                </p>
              )}
              {!snapshotAvailable && (
                <p className="notice" role="status">
                  本机状态暂不可用，恢复后才能修改设置或停止服务。
                </p>
              )}
              <section className="settings-panel" aria-label="本地服务设置">
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
                        disabled={settingsLocked}
                        value={config[key]}
                        onChange={(event) =>
                          setConfig({ ...config, [key]: event.target.value })
                        }
                      />
                      <button
                        aria-label={`选择${label}`}
                        disabled={settingsLocked}
                        onClick={() => void choose(key)}
                      >
                        <FolderOpen size={16} />
                      </button>
                    </div>
                  </label>
                ))}
                <label>
                  本机端口
                  <input
                    aria-label="本机端口"
                    type="number"
                    min={1024}
                    max={65535}
                    disabled={settingsLocked}
                    value={config.port}
                    onChange={(event) =>
                      setConfig({ ...config, port: Number(event.target.value) })
                    }
                  />
                </label>
                <button
                  disabled={
                    settingsLocked ||
                    !Number.isInteger(config.port) ||
                    config.port < 1024 ||
                    config.port > 65535
                  }
                  onClick={() => void action("save_service")}
                >
                  保存本机设置
                </button>
                {snapshotAvailable &&
                  (state?.owned ||
                    state?.service === "starting" ||
                    state?.service === "stopping") && (
                    <p className="hint locked-reason">
                      本应用的服务运行或准备时不能修改目录和端口。
                    </p>
                  )}
              </section>
              <details className="settings-panel">
                <summary>服务程序</summary>
                <label>
                  服务程序路径
                  <div className="input-actions">
                    <input
                      aria-label="服务程序路径"
                      disabled={settingsLocked}
                      value={config.serverBinary}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          serverBinary: event.target.value,
                        })
                      }
                    />
                    <button
                      aria-label="选择服务程序路径"
                      disabled={settingsLocked}
                      onClick={() => void choose("serverBinary")}
                    >
                      <FolderOpen size={16} />
                    </button>
                  </div>
                </label>
                <button
                  disabled={settingsLocked}
                  onClick={() => void action("save_programs")}
                >
                  保存程序位置
                </button>
              </details>
              <section className="open-source-settings" aria-label="开源与隐私">
                <h2>开源与隐私</h2>
                <p>
                  AnyWork 服务端与客户端均开源，数据安全与隐私实现可公开审查。
                </p>
                <a
                  href="https://github.com/ywateru/AnyWork"
                  onClick={(event) => {
                    event.preventDefault();
                    void invoke("desktop_open_source").catch((error) =>
                      setError(String(error)),
                    );
                  }}
                >
                  在 GitHub 查看源码 <ExternalLink size={14} />
                </a>
              </section>
              <details className="privacy-settings">
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
              {state?.owned && (
                <section className="service-controls">
                  <div>
                    <h2>本应用启动的服务</h2>
                    <p className="hint">
                      停止会中断本地工作区和远程访问。任务忙碌或状态未知时会拒绝停止。
                    </p>
                  </div>
                  <button
                    className="danger"
                    disabled={saving || !snapshotAvailable || installing}
                    onClick={() => setConfirmation({ kind: "stop" })}
                  >
                    停止本地服务
                  </button>
                </section>
              )}
              {saveFeedback && (
                <p className="save-feedback" role="status">
                  {saveFeedback}
                </p>
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
      {confirmation && (
        <ConfirmDialog
          title={
            confirmation.kind === "discard"
              ? "放弃未保存的更改？"
              : confirmation.kind === "stop"
                ? "停止本地服务？"
                : "退出这台电脑的账号？"
          }
          cancelLabel={confirmation.kind === "discard" ? "继续编辑" : "取消"}
          confirmLabel={
            confirmation.kind === "discard"
              ? "放弃更改"
              : confirmation.kind === "stop"
                ? "确认停止"
                : "确认退出账号"
          }
          pending={saving || account.pending}
          disabled={
            confirmation.kind === "stop"
              ? !snapshotAvailable || !state?.owned || installing
              : confirmation.kind === "logout"
                ? !account.available || installing
                : false
          }
          onClose={() => setConfirmation(null)}
          onConfirm={() => void confirm()}
        >
          <p>
            {confirmation.kind === "discard"
              ? "当前更改尚未保存，工作区仍使用已保存配置。"
              : confirmation.kind === "stop"
                ? "这会中断本地工作区和当前远程连接。仅停止本应用启动的服务；任务执行、等待确认或无法核验任务状态时不会停止。"
                : "关闭远程访问并结束活动远程连接，保留已运行的本地工作和数据。再次从桌面打开工作区需重新登录。"}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
