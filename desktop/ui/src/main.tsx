import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Cloud,
  Code2,
  Home,
  Power,
  QrCode,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  LoaderCircle,
  Monitor,
  Settings2,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import "./style.css";
import { AccountPage } from "./accounts";
import { version as appVersion } from "../package.json";
import { UpdateNotice, UpdatePage, useDesktopUpdates } from "./updates";
import { anyworkLogo } from "./brand";
import type { Kind, Phase, Config, Snapshot } from "./types";
import { ConnectionPopover } from "./ConnectionPopover";
import { NetworkLines } from "./NetworkLines";
type Pairing = { link: string; svg: string; url: string };
type CloudflaredStatus = {
  available: boolean;
  reason: string;
  canDownload: boolean;
};
type InstallRequest = {
  status: CloudflaredStatus;
  values: Record<string, unknown>;
  key: string;
};
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
const kinds: Kind[] = ["quick", "named", "relay"];
const titles = ["匿名隧道", "固定隧道", "WireGuard + TLS 中继"];
const descriptions = [
  "Cloudflare 自动分配临时地址",
  "使用自己的固定域名",
  "通过自有中继连接 Android 与桌面",
];
const names: Record<Phase, string> = {
  off: "未开启",
  checking: "正在检查",
  starting: "正在启动",
  validating: "正在验证连接",
  running: "已连接",
  reconnecting: "正在恢复连接",
  stopping: "正在关闭",
  error: "连接失败",
};
const active = (p: Phase) =>
  [
    "checking",
    "starting",
    "validating",
    "running",
    "stopping",
    "reconnecting",
  ].includes(p);
const busy = (p: Phase) =>
  ["starting", "checking", "validating", "stopping", "reconnecting"].includes(
    p,
  );
const invoke = <T,>(command: string, args?: Record<string, unknown>) =>
  window.__TAURI__
    ? window.__TAURI__.core.invoke<T>(command, args)
    : Promise.reject(new Error("请从 AnyWork 桌面应用打开此页面。"));
function App() {
  const updates = useDesktopUpdates();
  const [state, setState] = useState<Snapshot | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [token, setToken] = useState(""),
    [secrets, setSecrets] = useState(["", "", ""]);
  const [page, setPage] = useState("service"),
    [welcome, setWelcome] = useState(false),
    [preview, setPreview] = useState<string | null>(null),
    [showKey, setShowKey] = useState(false),
    [detail, setDetail] = useState<Kind | "local" | null>(null),
    [configuring, setConfiguring] = useState(false),
    [pairing, setPairing] = useState<Pairing | null>(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [installRequest, setInstallRequest] = useState<InstallRequest | null>(null),
    [installing, setInstalling] = useState(false),
    [installError, setInstallError] = useState(""),
    [lan, setLan] = useState("");
  const installDialog = useRef<HTMLDialogElement>(null);
  const detailTriggers = useRef<Record<string, HTMLButtonElement | null>>({});
  function openDetail(value: Kind | "local", edit = false) {
    setDetail(value);
    setConfiguring(edit);
  }
  function navigate(value: string) {
    setPage(value);
    setDetail(null);
  }
  const initialized = useRef(false),
    secretsLoaded = useRef(false),
    touched = useRef(new Set<number>()),
    pendingRef = useRef(new Set<string>());
  const [pending, setPending] = useState<string[]>([]);
  useEffect(() => {
    if (installRequest && !installDialog.current?.open)
      installDialog.current?.showModal();
  }, [installRequest]);
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await invoke<Snapshot>("desktop_snapshot");
        if (!live) return;
        setState(next);
        if (!initialized.current) {
          initialized.current = true;
          setConfig(next.config);
          setToken(next.token);
          const p = await invoke<string | null>("desktop_preview");
          if (!live) return;
          setPreview(p);
          setWelcome(p === "welcome" || (!p && !next.config.welcomed));
          if (p === "devices") setPage("devices");
        }
        if (next.secrets_loaded && !secretsLoaded.current) {
          secretsLoaded.current = true;
          setSecrets((old) =>
            old.map((v, i) =>
              touched.current.has(i) ? v : next.secrets[i] || "",
            ),
          );
        }
      } catch (e) {
        if (live) setError(String(e));
      }
      if (live) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    let live = true;
    if (state?.authorized && state.config.allowLAN)
      invoke<string | null>("desktop_lan", { port: state.config.port })
        .then((v) => {
          if (live) setLan(v || "");
        })
        .catch(() => {});
    else setLan("");
    return () => {
      live = false;
    };
  }, [state?.authorized, state?.config.port, state?.config.allowLAN]);
  useEffect(() => {
    if (!pairing) return;
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") setPairing(null);
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [pairing]);
  useEffect(() => {
    if (
      pairing &&
      state &&
      !state.routes.some(
        (route) => route.phase === "running" && route.url === pairing.url,
      )
    )
      setPairing(null);
  }, [state, pairing]);
  async function action(
    type: string,
    values: Record<string, unknown> = {},
    key = type,
  ) {
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    setPending([...pendingRef.current]);
    setError("");
    try {
      if (type === "start_route" && values.kind !== "relay") {
        const status = await invoke<CloudflaredStatus>(
          "desktop_cloudflared_status",
        );
        if (!status.available) {
          setInstallError("");
          setDetail(null);
          setInstallRequest({ status, values, key });
          return;
        }
      }
      await invoke("desktop_action", { action: { type, ...values } });
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      setError(String(e));
    } finally {
      pendingRef.current.delete(key);
      setPending([...pendingRef.current]);
    }
  }
  async function installCloudflared() {
    if (!installRequest || installing) return;
    setInstalling(true);
    setInstallError("");
    try {
      const path = await invoke<string>("desktop_install_cloudflared");
      update("cloudflaredBinary", path);
      const request = installRequest;
      setInstallRequest(null);
      await action(
        "start_route",
        {
          ...request.values,
          config: {
            ...(request.values.config as Config),
            cloudflaredBinary: path,
          },
        },
        request.key,
      );
    } catch (e) {
      setInstallError(String(e));
    } finally {
      setInstalling(false);
    }
  }
  async function call<T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T | undefined> {
    try {
      setError("");
      return await invoke<T>(command, args);
    } catch (e) {
      setError(String(e));
    }
  }
  async function copy(value: string) {
    if ((await call<null>("desktop_copy", { value })) !== undefined)
      setToast("已复制");
  }
  function update<K extends keyof Config>(key: K, value: Config[K]) {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  }
  async function choose(
    key:
      | "workspace"
      | "dataDirectory"
      | "serverBinary"
      | "cloudflaredBinary"
      | "tunwgBinary",
  ) {
    const path = await call<string | null>("desktop_pick", {
      folder: key === "workspace" || key === "dataDirectory",
    });
    if (path) update(key, path);
  }
  function secret(i: number, value: string) {
    touched.current.add(i);
    setSecrets((old) => old.map((v, j) => (i === j ? value : v)));
  }
  function toggle(kind: Kind, on: boolean) {
    const i = kinds.indexOf(kind);
    if (
      on &&
      ((kind === "named" && (!config?.publicURL || !secrets[i])) ||
        (kind === "relay" && (!config?.relayDomain || !secrets[i])))
    ) {
      openDetail(kind, true);
      setToast("请先填写这一路连接的配置");
      return;
    }
    void action(
      on ? "start_route" : "stop_route",
      on ? { kind, config, secret: secrets[i] } : { kind },
      kind,
    );
  }
  const locked =
    !!state &&
    (state.owned ||
      busy(state.service) ||
      state.routes.some((r) => active(r.phase)));
  const status = state
    ? state.service === "running"
      ? state.external
        ? state.authorized
          ? "命令行服务正在运行"
          : "发现已有服务 · 需要密钥"
        : "服务正在运行"
      : state.service === "off"
        ? "服务已关闭"
        : state.service === "error"
          ? "服务需要检查"
          : `${names[state.service]}本地服务`
    : "正在加载";
  const uiError = error || state?.error;
  if (!state || !config)
    return (
      <div className="boot">
        <LoaderCircle className="spin" size={24} />
        <span>{error || "正在加载 AnyWork…"}</span>
      </div>
    );
  const keyRow = (
    <div className="key-row">
      <span className="muted">访问密钥</span>
      <code>{showKey ? state.token : "••••••••••••••••••••"}</code>
      <button
        className="icon"
        aria-label={showKey ? "隐藏密钥" : "显示密钥"}
        onClick={() => setShowKey(!showKey)}
      >
        {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
      <button
        className="icon"
        aria-label="复制访问密钥"
        onClick={() => void copy(state.token)}
      >
        <Copy size={15} />
      </button>
    </div>
  );
  const serviceConfiguration = (
    <>
      <fieldset disabled={locked}>
        <div className="two-columns">
          <PathField
            label="工作目录"
            value={config.workspace}
            set={(v) => update("workspace", v)}
            choose={() => void choose("workspace")}
          />
          <PathField
            label="数据目录"
            value={config.dataDirectory}
            set={(v) => update("dataDirectory", v)}
            choose={() => void choose("dataDirectory")}
          />
        </div>
        <div className="config-line">
          <label className="port-field">
            服务端口
            <input
              type="number"
              min={1024}
              max={65535}
              value={config.port}
              onChange={(e) => update("port", Number(e.target.value))}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={config.allowLAN}
              onChange={(e) => update("allowLAN", e.target.checked)}
            />
            允许局域网连接
          </label>
        </div>
        <label>
          访问密钥
          <div className="input-actions">
            <input
              type={showKey ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="留空时自动生成"
            />
            <button
              onClick={async () => {
                const value = await call<string>("desktop_generate_token");
                if (value) setToken(value);
              }}
            >
              重新生成
            </button>
          </div>
        </label>
        <div className="form-footer">
          <p>已有服务的密钥文件不会被此处覆盖。</p>
          <button
            disabled={pending.includes("save_service")}
            onClick={() => void action("save_service", { config, token })}
          >
            保存服务配置
          </button>
        </div>
      </fieldset>
      {locked && (
        <p className="hint">
          关闭本应用启动的服务和远程连接后，可修改本地配置。
        </p>
      )}
    </>
  );
  const programConfiguration = (
    <>
      <details className="advanced">
        <summary>
          <Settings2 size={15} />
          高级选项 · 程序位置
        </summary>
        <p className="hint">默认使用桌面包内置程序，留空即可自动查找。</p>
        <fieldset disabled={locked}>
          {(["serverBinary", "cloudflaredBinary", "tunwgBinary"] as const).map(
            (key, i) => (
              <PathField
                key={key}
                label={["AnyWork Server", "cloudflared", "tunwg"][i]}
                value={config[key]}
                set={(v) => update(key, v)}
                choose={() => void choose(key)}
              />
            ),
          )}
          <button onClick={() => void action("save_programs", { config })}>
            保存程序位置
          </button>
        </fieldset>
      </details>
    </>
  );
  function routeConfiguration(kind: Kind) {
    if (!state || !config) return null;
    const i = kinds.indexOf(kind),
      on = active(state.routes[i].phase),
      isPending = pending.includes(kind);
    if (kind === "quick")
      return (
        <>
          <p className="hint">
            Cloudflare 自动分配临时 HTTPS
            地址，无需配置域名。网络恢复时优先保留原地址；进程重启后地址可能变化。
          </p>
          <p className="hint">
            程序位置：
            {config.cloudflaredBinary ||
              "自动查找 cloudflared，缺失时提示下载安装"}
          </p>
        </>
      );
    return (
      <>
        <fieldset disabled={on || isPending}>
          {kind === "named" ? (
            <>
              <label>
                公开 HTTPS 地址
                <input
                  value={config.publicURL}
                  placeholder="https://work.example.com"
                  onChange={(e) => update("publicURL", e.target.value)}
                />
              </label>
              <label>
                连接器令牌
                <input
                  type="password"
                  value={secrets[i]}
                  placeholder="Cloudflare Tunnel Token"
                  onChange={(e) => secret(i, e.target.value)}
                />
              </label>
              <p className="hint">
                在 Cloudflare 中将公开域名的源站配置为 http://127.0.0.1:
                {state.config.port}。
              </p>
            </>
          ) : (
            <>
              <label>
                中继域名
                <input
                  value={config.relayDomain}
                  placeholder="relay.example.com"
                  onChange={(e) => update("relayDomain", e.target.value)}
                />
              </label>
              <label>
                授权密钥
                <input
                  type="password"
                  value={secrets[i]}
                  placeholder="中继服务提供的授权密钥"
                  onChange={(e) => secret(i, e.target.value)}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={config.forceRelay}
                  onChange={(e) => update("forceRelay", e.target.checked)}
                />
                始终通过中继转发
              </label>
              <p className="hint">
                需要已部署的 tunwg 中继。Android 经 HTTPS/TLS 访问中继，再通过
                WireGuard 到达这台电脑。
              </p>
            </>
          )}
          <div className="form-buttons">
            <button
              onClick={() =>
                void action(
                  "save_route",
                  { kind, config, secret: secrets[i] },
                  kind,
                )
              }
            >
              保存配置
            </button>
            <button
              className="primary"
              disabled={!state.authorized}
              onClick={() =>
                void action(
                  "start_route",
                  { kind, config, secret: secrets[i] },
                  kind,
                )
              }
            >
              保存并开启
            </button>
          </div>
        </fieldset>
        {on && (
          <p className="hint">关闭这一路后可修改配置，其他连接继续运行。</p>
        )}
      </>
    );
  }
  return (
    <>
      {welcome ? (
        <main className="welcome">
          <Brand />
          <div className="welcome-content">
            <h1>
              工作在这里运行，
              <br />
              从任何地方继续。
            </h1>
            <p className="intro">
              把这台电脑上的 Codex 会话，连接到你的网页和 Android 应用。
              <br />
              桌面与远程共享工作进度，随时切换。
            </p>
            <div className="connection-map">
              <div>
                <Monitor size={30} />
                <span>
                  这台电脑<small>Agent 与文件留在本地</small>
                </span>
              </div>
              <div className="connection-line" />
              <div>
                <Smartphone size={29} />
                <span>
                  你的远程设备<small>使用密钥安全连接</small>
                </span>
              </div>
            </div>
            <div className="welcome-steps">
              {[
                ["启动本地服务", "选择工作目录，启动服务并保存访问密钥。"],
                [
                  "开启连接方式",
                  "匿名隧道、固定域名和 WireGuard + TLS 中继可以同时开启。",
                ],
                [
                  "在另一台设备继续",
                  "打开远程地址，或在 Android 应用中导入配对链接。",
                ],
              ].map(([title, body]) => (
                <div key={title}>
                  <Check size={18} />
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <footer>
            <span>外网连接按需开启，执行环境保留在这台电脑。</span>
            <button
              className="primary"
              onClick={() => {
                setWelcome(false);
                if (!preview) void action("welcome");
              }}
            >
              开始使用
              <ArrowRight size={17} />
            </button>
          </footer>
        </main>
      ) : (
        <div className="shell">
          <aside>
            <Brand />
            <nav>
              <button
                className={page === "account" ? "selected" : ""}
                onClick={() => navigate("account")}
              >
                <ShieldCheck size={18} />
                账号与远程访问
              </button>
              <button
                className={page === "service" ? "selected" : ""}
                onClick={() => navigate("service")}
              >
                <Home size={18} />
                总览
              </button>
              <button
                className={page === "devices" ? "selected" : ""}
                onClick={() => navigate("devices")}
              >
                <Smartphone size={18} />
                在线设备
                {state.clients.length > 0 && <b>{state.clients.length}</b>}
              </button>
              <button
                className={page === "settings" ? "selected" : ""}
                onClick={() => navigate("settings")}
              >
                <Settings2 size={18} />
                设置
              </button>
            </nav>
            <div className="aside-footer">
              <Status
                text={state.authorized ? "本地服务已连接" : "本地服务未连接"}
                phase={state.authorized ? "running" : "off"}
              />
              <button onClick={() => setWelcome(true)}>使用说明</button>
              <button
                className="version-button"
                onClick={() => navigate("updates")}
                aria-label="软件更新"
              >
                AnyWork · {appVersion}
                {updates.state?.showNotice && <span className="update-dot" />}
              </button>
            </div>
          </aside>
          <main className="workspace">
            {page !== "updates" && (
              <UpdateNotice
                controller={updates}
                open={() => navigate("updates")}
              />
            )}
            {page !== "service" && page !== "updates" && uiError && (
              <div role="alert" className="error">
                {uiError}
              </div>
            )}
            {page !== "service" &&
              page !== "updates" &&
              state.notice &&
              !uiError && (
                <div className="notice" role="status">
                  {state.notice}
                </div>
              )}
            {page === "account" ? (
              <AccountPage
                localReady={state.authorized && state.service === "running"}
              />
            ) : page === "updates" ? (
              <UpdatePage controller={updates} />
            ) : page === "service" ? (
              <>
                <header className="overview-heading">
                  <div
                    className={`service-beacon ${state.authorized ? "running" : ""}`}
                  >
                    <span />
                  </div>
                  <div>
                    <h1>
                      {state.authorized
                        ? "AnyWork 正在运行"
                        : state.service === "off"
                          ? "从这里，连接你的工作。"
                          : status}
                    </h1>
                    <p>为这台电脑上的 Codex 提供安全的远程访问。</p>
                  </div>
                </header>
                {uiError && !detail && (
                  <div role="alert" className="error">
                    {uiError}
                  </div>
                )}
                {state.notice && !uiError && (
                  <div className="notice">{state.notice}</div>
                )}
                <section
                  className="network-map"
                  aria-label="Codex 与远程设备的连接关系"
                >
                  <NetworkLines />
                  <button
                    className="agent-node"
                    aria-label="Codex 设置"
                    title={`工作目录：${state.config.workspace || "待配置"}`}
                    onClick={() => navigate("settings")}
                  >
                    <span className="codex-symbol" data-node="agent">
                      <Code2 size={36} strokeWidth={1.5} />
                    </span>
                    <span className="agent-name">Codex</span>
                  </button>
                  <div className="host-column">
                    <div className="host-node">
                      <button
                        className="host-details"
                        ref={(element) => {
                          detailTriggers.current.local = element;
                        }}
                        aria-expanded={detail === "local"}
                        aria-controls={
                          detail === "local" ? "connection-details" : undefined
                        }
                        aria-label="本地服务详情"
                        onClick={() =>
                          detail === "local"
                            ? setDetail(null)
                            : openDetail("local")
                        }
                      >
                        <img
                          className="host-logo"
                          data-node="hub"
                          src={anyworkLogo}
                          width="72"
                          height="72"
                          alt=""
                        />
                        <span className="host-name">AnyWork</span>
                        <Status
                          phase={state.authorized ? "running" : state.service}
                          text={state.authorized ? "运行中" : status}
                        />
                        <span
                          className="host-address"
                          title={`http://127.0.0.1:${state.config.port}`}
                        >
                          127.0.0.1:{state.config.port}
                        </span>
                        <span className="host-settings">
                          <Settings2 size={12} />
                          服务设置
                        </span>
                      </button>
                      <div className="host-controls">
                        {state.owned || state.external ? (
                          <button
                            className="host-power"
                            title={
                              state.external &&
                              !state.info?.local_service_control
                                ? "请先将命令行服务升级到支持桌面启停的版本"
                                : undefined
                            }
                            disabled={
                              pending.includes("stop_server") ||
                              state.service === "stopping" ||
                              (!state.owned &&
                                (!state.authorized ||
                                  !state.info?.local_service_control))
                            }
                            onClick={() => void action("stop_server")}
                          >
                            <Power size={15} />
                            {state.service === "stopping"
                              ? "正在停止…"
                              : "停止服务"}
                          </button>
                        ) : (
                          <button
                            className="primary host-power"
                            disabled={
                              busy(state.service) ||
                              pending.includes("start_server")
                            }
                            onClick={() =>
                              void action("start_server", { config, token })
                            }
                          >
                            <Power size={15} />
                            {pending.includes("start_server") ||
                            busy(state.service)
                              ? "正在启动…"
                              : "启动服务"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="route-nodes" aria-label="独立远程连接">
                    {kinds.map((kind, i) => {
                      const r = state.routes[i],
                        on = active(r.phase),
                        isPending = pending.includes(kind),
                        address =
                          r.url ||
                          (kind === "named" ? state.config.publicURL : "");
                      const Icon = kind === "relay" ? ShieldCheck : Cloud;
                      return (
                        <article
                          className={`route-node ${detail === kind ? "selected" : ""}`}
                          key={kind}
                          data-node={kind}
                        >
                          <button
                            className="route-trigger"
                            ref={(element) => {
                              detailTriggers.current[kind] = element;
                            }}
                            aria-label={`${titles[i]}详情`}
                            aria-expanded={detail === kind}
                            aria-controls={
                              detail === kind ? "connection-details" : undefined
                            }
                            onClick={() =>
                              detail === kind
                                ? setDetail(null)
                                : openDetail(kind)
                            }
                          >
                            <span className="route-symbol">
                              <Icon size={22} strokeWidth={1.5} />
                            </span>
                            <span className="route-info">
                              <strong>
                                {kind === "quick"
                                  ? "Cloudflare 匿名隧道"
                                  : kind === "named"
                                    ? "Cloudflare 固定域名"
                                    : "WireGuard + TLS 中继"}
                              </strong>
                              {address ? (
                                <small
                                  className="route-address"
                                  title={address}
                                  aria-label={`${r.phase === "reconnecting" ? "上次连接地址" : r.url ? "连接地址" : "配置地址"}：${address}`}
                                >
                                  {address.replace(/^https?:\/\//, "")}
                                </small>
                              ) : (
                                <small>{descriptions[i]}</small>
                              )}
                              <Status
                                phase={isPending && !on ? "starting" : r.phase}
                                text={
                                  r.phase === "running" ? "已启用" : undefined
                                }
                              />
                            </span>
                            <ChevronRight className="route-chevron" size={16} />
                          </button>
                          <button
                            className={`switch${on || isPending ? " on" : ""}`}
                            role="switch"
                            aria-label={`${titles[i]}开关`}
                            aria-checked={on || isPending}
                            disabled={
                              isPending ||
                              r.phase === "stopping" ||
                              (!state.authorized && !on)
                            }
                            onClick={() => toggle(kind, !on)}
                          >
                            <span />
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </section>
              </>
            ) : page === "settings" ? (
              <>
                <header>
                  <div>
                    <h1>设置</h1>
                    <p>配置本地服务与连接程序。</p>
                  </div>
                </header>
                <section className="settings-section">
                  <h2>本地服务</h2>
                  {serviceConfiguration}
                </section>
                <section className="settings-section">
                  {programConfiguration}
                </section>
                <section className="settings-section settings-update">
                  <div>
                    <h2>软件更新</h2>
                    <p className="hint">
                      当前版本 {appVersion}，在后台下载，确认后安装。
                    </p>
                  </div>
                  <button onClick={() => navigate("updates")}>
                    检查更新
                    <ChevronRight size={14} />
                  </button>
                </section>
              </>
            ) : (
              <>
                <header>
                  <div>
                    <h1>在线设备</h1>
                    <p>最近 90 秒内活动的已认证设备，列表自动更新。</p>
                  </div>
                  <span className="device-count">
                    {state.clients.length} 台
                  </span>
                </header>
                {state.clients.length === 0 ? (
                  <div className="empty">
                    <Monitor size={42} />
                    <h2>
                      {state.authorized ? "还没有设备连接" : "先连接本地服务"}
                    </h2>
                    <p>
                      {state.authorized
                        ? "开启一种远程连接，再从网页或 Android 应用访问。"
                        : "连接服务后，可以在这里查看远程设备。"}
                    </p>
                    <button onClick={() => navigate("service")}>
                      前往总览
                    </button>
                  </div>
                ) : (
                  <div className="client-list">
                    {state.clients.map((c) => (
                      <article key={c.id}>
                        <Smartphone size={27} />
                        <div>
                          <h3>
                            {c.user_agent.includes("AnyWork-Android")
                              ? "AnyWork Android"
                              : c.user_agent.includes("Android")
                                ? "Android 设备"
                                : c.user_agent.includes("Macintosh")
                                  ? "Mac 浏览器"
                                  : "远程客户端"}
                          </h3>
                          <p>{c.address}</p>
                          <small>{c.user_agent}</small>
                        </div>
                        <Status phase="running" text="最近在线" />
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      )}
      {detail && !welcome && page === "service" && (
        <ConnectionPopover
          key={detail}
          anchor={detailTriggers.current[detail]}
          title={
            detail === "local" ? "本地服务" : titles[kinds.indexOf(detail)]
          }
          onClose={() => setDetail(null)}
        >
          {configuring && (
            <button
              className="popover-back"
              onClick={() => setConfiguring(false)}
            >
              <ArrowLeft size={14} />
              连接详情
            </button>
          )}
          {detail === "local" ? (
            <>
              <Status
                phase={state.authorized ? "running" : state.service}
                text={status}
              />
              {configuring ? (
                serviceConfiguration
              ) : (
                <>
                  <Address
                    label="本机地址"
                    url={`http://127.0.0.1:${state.config.port}`}
                    copy={copy}
                  />
                  {lan && <Address label="局域网地址" url={lan} copy={copy} />}
                  {state.authorized ? (
                    keyRow
                  ) : state.external ? (
                    <div className="external-auth">
                      <p>
                        填入已有服务的访问密钥，连接后即可开启隧道和查看设备。
                      </p>
                      <div>
                        <input
                          aria-label="已有服务访问密钥"
                          type="password"
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                          placeholder="访问密钥"
                        />
                        <button
                          onClick={() => void action("authenticate", { token })}
                        >
                          连接
                        </button>
                        <button
                          onClick={async () => {
                            const value = await call<string | null>(
                              "desktop_read_key",
                            );
                            if (value) setToken(value);
                          }}
                        >
                          读取密钥文件
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="hint">
                      启动本地服务后，即可从网页或 Android 应用继续 Codex 会话。
                    </p>
                  )}
                  <div className="detail-options">
                    <button
                      disabled={!state.authorized}
                      onClick={() => void call("desktop_open", { kind: null })}
                    >
                      <ExternalLink size={17} />
                      打开工作台
                      <ChevronRight size={15} />
                    </button>
                    <button onClick={() => setConfiguring(true)}>
                      <Settings2 size={17} />
                      查看服务配置
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            (() => {
              const i = kinds.indexOf(detail),
                r = state.routes[i],
                on = active(r.phase),
                isPending = pending.includes(detail);
              return (
                <>
                  <div className="detail-status">
                    <span>{descriptions[i]}</span>
                    <Status
                      phase={r.phase}
                      text={r.phase === "running" ? "已启用" : undefined}
                    />
                  </div>
                  {configuring ? (
                    routeConfiguration(detail)
                  ) : (
                    <>
                      {detail === "quick" && r.phase === "reconnecting" && (
                        <p className="hint" role="status">
                          {r.retry_in_seconds
                            ? `${r.retry_in_seconds} 秒后重试启动（第 ${r.restart_attempts ?? 1} 次）；等待本地服务可用。`
                            : "正在自动恢复；优先保留现有进程和匿名地址。"}
                        </p>
                      )}
                      {detail === "quick" && r.address_changed && (
                        <p className="hint" role="status">
                          匿名地址已变更，请使用下方新地址重新连接远程设备。
                        </p>
                      )}
                      {r.url ? (
                        <>
                          <Address
                            label={
                              r.phase === "running"
                                ? "访问地址"
                                : "上次连接地址 · 正在恢复"
                            }
                            url={r.url}
                            copy={copy}
                          />
                          <button
                            className="open-connection"
                            disabled={r.phase !== "running"}
                            onClick={() =>
                              void call("desktop_open", { kind: detail })
                            }
                          >
                            打开网页
                            <ExternalLink size={14} />
                          </button>
                        </>
                      ) : (
                        <p className="detail-empty">
                          {busy(r.phase)
                            ? "连接验证成功后，将在这里显示访问地址。"
                            : "开启此连接后，将在这里显示访问地址。"}
                        </p>
                      )}
                      <div className="detail-options">
                        <span className="detail-label">远程访问</span>
                        <button
                          disabled={r.phase !== "running"}
                          onClick={async () => {
                            const value = await call<Pairing>(
                              "desktop_pairing",
                              { kind: detail },
                            );
                            if (value) {
                              setPairing(value);
                              setDetail(null);
                            }
                          }}
                        >
                          <QrCode size={18} />
                          生成二维码
                          <ChevronRight size={15} />
                        </button>
                        <span className="detail-label">配置</span>
                        <button onClick={() => setConfiguring(true)}>
                          <Settings2 size={17} />
                          查看配置
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </>
                  )}
                  {r.error && (
                    <p
                      role={r.phase === "reconnecting" ? "status" : "alert"}
                      className={r.phase === "reconnecting" ? "hint" : "error"}
                    >
                      {r.error}
                    </p>
                  )}
                  {!configuring && (
                    <button
                      className={`connection-power ${on ? "" : "primary"}`}
                      disabled={
                        isPending ||
                        r.phase === "stopping" ||
                        (!state.authorized && !on)
                      }
                      onClick={() => toggle(detail, !on)}
                    >
                      <Power size={15} />
                      {on ? "关闭此连接" : "开启此连接"}
                    </button>
                  )}
                </>
              );
            })()
          )}
          {uiError && (
            <div role="alert" className="error">
              {uiError}
            </div>
          )}
        </ConnectionPopover>
      )}
      {toast && (
        <div role="status" className="toast">
          <Check size={16} />
          {toast}
        </div>
      )}
      {installRequest && (
        <dialog
          ref={installDialog}
          className="install-dialog"
          aria-labelledby="install-title"
          aria-describedby="install-description"
          onCancel={(e) => {
            if (installing) e.preventDefault();
            else setInstallRequest(null);
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !installing) {
              const rect = e.currentTarget.getBoundingClientRect();
              if (
                e.clientX < rect.left ||
                e.clientX > rect.right ||
                e.clientY < rect.top ||
                e.clientY > rect.bottom
              )
                setInstallRequest(null);
            }
          }}
        >
          <div className="install-symbol">
            <Download size={25} />
          </div>
          <h2 id="install-title">需要安装 cloudflared</h2>
          <p id="install-description">
            {installRequest.values.kind === "named" ? "固定隧道" : "匿名隧道"}
            需要 cloudflared 才能连接。 AnyWork 可以从 Cloudflare
            官方发布下载适合这台电脑的版本，安装完成后继续开启隧道。
          </p>
          <p className="hint">
            安装到 AnyWork 的用户数据目录，无需管理员权限。
          </p>
          <details className="install-detail">
            <summary>查看检测结果</summary>
            <p>{installRequest.status.reason}</p>
          </details>
          {!installRequest.status.canDownload && (
            <p className="error">
              此系统架构暂不支持自动下载，请取消后在高级选项中选择 cloudflared。
            </p>
          )}
          {installing && (
            <p role="status" className="install-progress">
              <LoaderCircle size={16} className="spin" />
              正在下载、校验并安装，请稍候…
            </p>
          )}
          {installError && (
            <p role="alert" className="error">
              {installError}
            </p>
          )}
          <div className="install-actions">
            <button
              disabled={installing}
              onClick={() => setInstallRequest(null)}
              autoFocus
            >
              取消
            </button>
            <button
              className="primary"
              disabled={installing || !installRequest.status.canDownload}
              onClick={() => void installCloudflared()}
            >
              {installing
                ? "正在安装…"
                : installError
                  ? "重试下载"
                  : "下载并开启"}
            </button>
          </div>
        </dialog>
      )}
      {pairing && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) setPairing(null);
          }}
        >
          <div
            className="pairing"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pair-title"
          >
            <button
              className="icon modal-close"
              autoFocus
              aria-label="关闭配对窗口"
              onClick={() => setPairing(null)}
            >
              <X size={19} />
            </button>
            <h2 id="pair-title">连接 AnyWork Android</h2>
            <p>导入配对链接，在手机上继续工作。</p>
            <img
              alt="AnyWork Android 配对二维码"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pairing.svg)}`}
            />
            <code>{pairing.url}</code>
            <p className="hint">配对链接包含访问密钥，请仅发送给自己的设备。</p>
            <button className="primary" onClick={() => void copy(pairing.link)}>
              复制配对链接
            </button>
          </div>
        </div>
      )}
    </>
  );
}
function Brand() {
  return (
    <div className="brand">
      <img
        src={anyworkLogo}
        className="brand-mark"
        width="34"
        height="34"
        alt=""
      />
      AnyWork
    </div>
  );
}
function Status({ phase, text }: { phase: Phase; text?: string }) {
  return (
    <span className={`status ${phase}`}>
      {busy(phase) ? <LoaderCircle size={13} className="spin" /> : <i />}
      {text || names[phase]}
    </span>
  );
}
function Address({
  label,
  url,
  copy,
}: {
  label: string;
  url: string;
  copy: (v: string) => Promise<void>;
}) {
  return (
    <div className="address">
      <span>{label}</span>
      <code>{url}</code>
      <button
        className="icon"
        aria-label={`复制${label}`}
        onClick={() => void copy(url)}
      >
        <Copy size={15} />
      </button>
    </div>
  );
}
function PathField({
  label,
  value,
  set,
  choose,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  choose: () => void;
}) {
  return (
    <label>
      {label}
      <div className="input-actions">
        <input
          aria-label={label}
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder="使用内置程序或自动查找"
        />
        <button className="icon" aria-label={`选择${label}`} onClick={choose}>
          <FolderOpen size={17} />
        </button>
      </div>
    </label>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
