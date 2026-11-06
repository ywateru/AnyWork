import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  KeyRound,
  Link,
  LoaderCircle,
  Monitor,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Smartphone,
  Unplug,
  Wifi,
  X,
} from "lucide-react";
import "./style.css";
import { version as appVersion } from "../package.json";
import { UpdateNotice, UpdatePage, useDesktopUpdates } from "./updates";
import { anyworkLogo } from "./brand";
type Kind = "quick" | "named" | "relay";
type Phase =
  | "off"
  | "checking"
  | "starting"
  | "validating"
  | "running"
  | "reconnecting"
  | "stopping"
  | "error";
type Config = {
  workspace: string;
  dataDirectory: string;
  port: number;
  allowLAN: boolean;
  serverBinary: string;
  cloudflaredBinary: string;
  tunwgBinary: string;
  publicURL: string;
  relayDomain: string;
  forceRelay: boolean;
  welcomed: boolean;
};
type Route = {
  phase: Phase;
  url: string;
  error: string;
  restart_attempts?: number;
  retry_in_seconds?: number;
  address_changed?: boolean;
};
type Client = {
  id: string;
  address: string;
  user_agent: string;
  last_seen: number;
};
type Snapshot = {
  config: Config;
  token: string;
  secrets: string[];
  secrets_loaded: boolean;
  service: Phase;
  owned: boolean;
  external: boolean;
  authorized: boolean;
  clients: Client[];
  routes: Route[];
  error: string;
  notice: string;
};
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
    [expanded, setExpanded] = useState<Kind[]>([]),
    [pairing, setPairing] = useState<Pairing | null>(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [installRequest, setInstallRequest] = useState<InstallRequest | null>(null),
    [installing, setInstalling] = useState(false),
    [installError, setInstallError] = useState(""),
    [lan, setLan] = useState("");
  const installDialog = useRef<HTMLDialogElement>(null);
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
      setExpanded((old) => (old.includes(kind) ? old : [...old, kind]));
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
                className={page === "service" ? "selected" : ""}
                onClick={() => setPage("service")}
              >
                <Network size={18} />
                服务与连接
              </button>
              <button
                className={page === "devices" ? "selected" : ""}
                onClick={() => setPage("devices")}
              >
                <Smartphone size={18} />
                在线设备
                {state.clients.length > 0 && <b>{state.clients.length}</b>}
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
                onClick={() => setPage("updates")}
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
                open={() => setPage("updates")}
              />
            )}
            {page === "updates" ? (
              <UpdatePage controller={updates} />
            ) : page === "service" ? (
              <>
                <header>
                  <div>
                    <h1>服务与连接</h1>
                    <p>让这台电脑上的工作，随时继续。</p>
                  </div>
                  <button
                    disabled={!state.authorized}
                    onClick={() => void call("desktop_open", { kind: null })}
                  >
                    打开工作台
                    <ExternalLink size={14} />
                  </button>
                </header>
                <section className="local-service">
                  <div className="section-top">
                    <div>
                      <Server size={19} />
                      <h2>本地服务</h2>
                      <Status
                        phase={state.authorized ? "running" : state.service}
                        text={status}
                      />
                    </div>
                    {state.owned ? (
                      <button
                        disabled={
                          pending.includes("stop_server") ||
                          state.service === "stopping"
                        }
                        onClick={() => void action("stop_server")}
                      >
                        关闭服务
                      </button>
                    ) : (
                      !state.external && (
                        <button
                          className="primary"
                          disabled={
                            busy(state.service) ||
                            pending.includes("start_server")
                          }
                          onClick={() =>
                            void action("start_server", { config, token })
                          }
                        >
                          启动服务
                        </button>
                      )
                    )}
                  </div>
                  <Address
                    label="本机地址"
                    url={`http://127.0.0.1:${state.config.port}`}
                    copy={copy}
                  />
                  {lan && <Address label="局域网地址" url={lan} copy={copy} />}{" "}
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
                          title="选择服务数据目录里的 access-token"
                          onClick={async () => {
                            const v = await call<string | null>(
                              "desktop_read_key",
                            );
                            if (v) setToken(v);
                          }}
                        >
                          读取密钥文件
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="service-hint">
                      启动后即可在网页中继续工作。首次启动会自动生成访问密钥。
                    </p>
                  )}
                </section>
                <details className="local-config">
                  <summary>
                    <Settings2 size={15} />
                    服务配置
                  </summary>
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
                          onChange={(e) =>
                            update("port", Number(e.target.value))
                          }
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
                            const value = await call<string>(
                              "desktop_generate_token",
                            );
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
                        onClick={() =>
                          void action("save_service", { config, token })
                        }
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
                </details>
                {uiError && (
                  <div role="alert" className="error">
                    {uiError}
                  </div>
                )}
                {state.notice && !uiError && (
                  <div className="notice">{state.notice}</div>
                )}
                <div className="connections-heading">
                  <h2>远程连接</h2>
                  <span>可同时开启多种方式</span>
                </div>
                <section className="routes">
                  {kinds.map((kind, i) => {
                    const r = state.routes[i],
                      on = active(r.phase),
                      isPending = pending.includes(kind),
                      open = expanded.includes(kind);
                    const Icon = [Globe, Link, ShieldCheck][i];
                    return (
                      <article className="route" key={kind}>
                        <div className="route-top">
                          <div className="route-symbol">
                            <Icon size={21} />
                          </div>
                          <div className="route-info">
                            <h3>{titles[i]}</h3>
                            <p>{descriptions[i]}</p>
                          </div>
                          <div className="route-actions">
                            {kind !== "quick" && (
                              <button
                                className="text-button"
                                aria-expanded={open}
                                onClick={() =>
                                  setExpanded((old) =>
                                    open
                                      ? old.filter((v) => v !== kind)
                                      : [...old, kind],
                                  )
                                }
                              >
                                {open ? "收起" : "配置"}
                                <ChevronDown
                                  className={open ? "rotated" : ""}
                                  size={13}
                                />
                              </button>
                            )}
                            <Status
                              phase={isPending && !on ? "starting" : r.phase}
                            />
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
                          </div>
                        </div>
                        {open && (
                          <div className="route-config">
                            <fieldset disabled={on || isPending}>
                              {kind === "named" ? (
                                <>
                                  <label>
                                    公开 HTTPS 地址
                                    <input
                                      value={config.publicURL}
                                      placeholder="https://work.example.com"
                                      onChange={(e) =>
                                        update("publicURL", e.target.value)
                                      }
                                    />
                                  </label>
                                  <label>
                                    连接器令牌
                                    <input
                                      type="password"
                                      value={secrets[i]}
                                      placeholder="Cloudflare Tunnel Token"
                                      onChange={(e) =>
                                        secret(i, e.target.value)
                                      }
                                    />
                                  </label>
                                  <p className="hint">
                                    在 Cloudflare 中将公开域名的源站配置为
                                    http://127.0.0.1:{state.config.port}。
                                  </p>
                                </>
                              ) : (
                                <>
                                  <label>
                                    中继域名
                                    <input
                                      value={config.relayDomain}
                                      placeholder="relay.example.com"
                                      onChange={(e) =>
                                        update("relayDomain", e.target.value)
                                      }
                                    />
                                  </label>
                                  <label>
                                    授权密钥
                                    <input
                                      type="password"
                                      value={secrets[i]}
                                      placeholder="中继服务提供的授权密钥"
                                      onChange={(e) =>
                                        secret(i, e.target.value)
                                      }
                                    />
                                  </label>
                                  <label className="check">
                                    <input
                                      type="checkbox"
                                      checked={config.forceRelay}
                                      onChange={(e) =>
                                        update("forceRelay", e.target.checked)
                                      }
                                    />
                                    始终通过中继转发
                                  </label>
                                  <p className="hint">
                                    需要已部署的 tunwg 中继。Android 经
                                    HTTPS/TLS 访问中继，再通过 WireGuard
                                    到达这台电脑。
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
                              <p className="hint">
                                关闭这一路后可修改配置，其他连接继续运行。
                              </p>
                            )}
                          </div>
                        )}
                        {kind === "quick" && r.phase === "reconnecting" && (
                          <p className="hint" role="status">
                            {r.retry_in_seconds
                              ? `${r.retry_in_seconds} 秒后重试启动（第 ${r.restart_attempts ?? 1} 次）；等待本地服务可用。`
                              : "正在自动恢复；优先保留现有进程和匿名地址。"}
                          </p>
                        )}
                        {kind === "quick" && r.address_changed && (
                          <p className="hint" role="status">
                            匿名地址已变更，请使用下方新地址重新连接远程设备。
                          </p>
                        )}
                        {r.url && (
                          <div className="route-address">
                            <Address
                              label={
                                r.phase === "running"
                                  ? "远程地址"
                                  : "上次连接地址 · 正在恢复"
                              }
                              url={r.url}
                              copy={copy}
                            />
                            <div>
                              <button
                                disabled={r.phase !== "running"}
                                onClick={() =>
                                  void call("desktop_open", { kind })
                                }
                              >
                                打开网页
                                <ExternalLink size={13} />
                              </button>
                              <button
                                disabled={r.phase !== "running"}
                                onClick={async () => {
                                  const value = await call<Pairing>(
                                    "desktop_pairing",
                                    { kind },
                                  );
                                  if (value) setPairing(value);
                                }}
                              >
                                连接 Android
                              </button>
                            </div>
                          </div>
                        )}
                        {r.error && (
                          <div
                            role={
                              r.phase === "reconnecting" ? "status" : "alert"
                            }
                            className={
                              r.phase === "reconnecting"
                                ? "hint route-error"
                                : "error route-error"
                            }
                          >
                            {r.error}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </section>
                <details className="advanced">
                  <summary>
                    <Settings2 size={15} />
                    高级选项 · 程序位置
                  </summary>
                  <p className="hint">
                    默认使用桌面包内置程序，留空即可自动查找。
                  </p>
                  <fieldset disabled={locked}>
                    {(
                      [
                        "serverBinary",
                        "cloudflaredBinary",
                        "tunwgBinary",
                      ] as const
                    ).map((key, i) => (
                      <PathField
                        key={key}
                        label={["AnyWork Server", "cloudflared", "tunwg"][i]}
                        value={config[key]}
                        set={(v) => update(key, v)}
                        choose={() => void choose(key)}
                      />
                    ))}
                    <button
                      onClick={() => void action("save_programs", { config })}
                    >
                      保存程序位置
                    </button>
                  </fieldset>
                </details>
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
                    <button onClick={() => setPage("service")}>
                      前往服务与连接
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
