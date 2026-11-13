import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Copy,
  Laptop,
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import App from "../App";
import { useAppearance } from "../appearance";
import { platformError } from "../platform";
import {
  accountCommand,
  friendlyError,
  errorCode,
  type AccountSnapshot,
  type Device,
} from "./account";
import { listen } from "./bridge";
import { NativeTransport } from "./NativeTransport";
import {
  backSetState,
  cancelExports,
  startSystem,
  type DialogRequest,
} from "./system";
import type { Connection } from "../types";

type Page = "devices" | "guide" | "account";
const initial: AccountSnapshot = {
  protocolVersion: 1,
  epoch: -1,
  phase: "signedOut",
  account: null,
  devices: [],
  directoryState: "idle",
  revision: 0,
  errorCode: null,
};
const logo = new URL("../../public/icon.svg", import.meta.url).href;
export default function MobileApp() {
  const [snapshot, setSnapshot] = useState(initial);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>("devices");
  const [verification, setVerification] = useState<Device | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [connection, setConnection] = useState<{
    value: Connection;
    transport: NativeTransport;
    device: Device;
  } | null>(null);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [dialogValue, setDialogValue] = useState("");
  const appearance = useAppearance();
  const state = useRef({ snapshot, page, verification, connection, dialog });
  state.current = { snapshot, page, verification, connection, dialog };
  const mounted = useRef(true);
  const operation = useRef(0);
  const connectAttempt = useRef(0);
  const closeConnection = useCallback(() => {
    connectAttempt.current++;
    const previous = state.current.connection;
    state.current.connection = null;
    previous?.transport.close();
    setConnection(null);
    // Session routes belong to one connected computer only.
    history.replaceState(null, "", location.pathname + location.search);
  }, []);
  const apply = useCallback(
    (next: AccountSnapshot) => {
      if (!mounted.current) return;
      if (next.protocolVersion !== 1)
        throw new Error("客户端与原生接口版本不匹配");
      const previous = state.current.snapshot;
      if (
        next.epoch < previous.epoch ||
        (next.epoch === previous.epoch && next.revision < previous.revision)
      )
        return;
      if (
        next.epoch !== previous.epoch ||
        next.account?.scopeId !== previous.account?.scopeId ||
        next.phase !== "signedIn"
      ) {
        closeConnection();
        state.current.dialog?.resolve(null);
        setDialog(null);
        setStatus("");
        setError("");
        setVerification(null);
        setChecked(false);
        void cancelExports();
      }
      state.current.snapshot = next;
      setSnapshot(next);
      setReady(true);
    },
    [closeConnection],
  );
  const showError = useCallback((value: unknown) => {
    if (mounted.current) setError(friendlyError(value));
  }, []);
  async function refresh() {
    const id = ++operation.current;
    setBusy("refresh");
    setError("");
    try {
      const next = await accountCommand("refresh");
      if (id === operation.current) apply(next);
    } catch (e) {
      if (id === operation.current) showError(e);
    } finally {
      if (id === operation.current) setBusy(null);
    }
  }
  async function login(signup = false) {
    const id = ++operation.current;
    setBusy("login");
    setError("");
    setStatus("");
    try {
      const next = await accountCommand("login", { signup });
      if (id === operation.current) apply(next);
    } catch (e) {
      if (id === operation.current && errorCode(e) !== "CANCELLED")
        showError(e);
    } finally {
      if (id === operation.current) setBusy(null);
    }
  }
  async function cancelLogin() {
    ++operation.current;
    setBusy(null);
    try {
      apply(await accountCommand("cancel"));
      setStatus("已取消登录");
    } catch (e) {
      showError(e);
    }
  }
  const ask = useCallback(
    (message: string, value?: string) =>
      new Promise<string | boolean | null>((resolve) => {
        state.current.dialog?.resolve(null);
        setDialogValue(value ?? "");
        setDialog({ message, value, resolve });
      }),
    [],
  );
  async function logout() {
    if (
      (await ask(
        "退出账号将断开此手机的连接和终端，电脑上的 Agent 任务继续执行。",
      )) !== true
    )
      return;
    ++operation.current;
    closeConnection();
    setBusy("logout");
    await cancelExports();
    try {
      apply(await accountCommand("logout"));
      setPage("devices");
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  }
  async function updateDevice(device: Device, remove: boolean) {
    const current = state.current.snapshot;
    const value = remove
      ? await ask(
          "移除账号中的设备显示？这不会关闭电脑的远程访问；撤销访问请在电脑端关闭。",
        )
      : await ask("修改电脑名称", device.label);
    if (remove ? value !== true : typeof value !== "string" || !value.trim())
      return;
    const id = ++operation.current;
    setBusy(device.deviceRef);
    setError("");
    try {
      const next = await accountCommand("device_update", {
        deviceRef: device.deviceRef,
        expectedEpoch: current.epoch,
        expectedRevision: current.revision,
        ...(remove ? { remove: true } : { label: String(value).trim() }),
      });
      if (id === operation.current) apply(next);
    } catch (e) {
      if (id === operation.current) showError(e);
    } finally {
      if (id === operation.current) setBusy(null);
    }
  }
  async function connect(device: Device, confirmed = false) {
    const current = state.current.snapshot;
    if (device.online !== true || current.phase !== "signedIn") return;
    if (device.trustedPublicKey !== device.publicKey && !confirmed) {
      setVerification(device);
      setChecked(false);
      return;
    }
    const id = ++connectAttempt.current;
    const epoch = current.epoch;
    setBusy("connect");
    setError("");
    try {
      const transport = await NativeTransport.connect({
        deviceRef: device.deviceRef,
        expectedEpoch: epoch,
        expectedRevision: current.revision,
        ...(confirmed ? { keyConfirmation: device.publicKey } : {}),
      });
      if (
        !mounted.current ||
        id !== connectAttempt.current ||
        epoch !== state.current.snapshot.epoch
      ) {
        transport.close();
        return;
      }
      setVerification(null);
      setChecked(false);
      history.replaceState(null, "", location.pathname + location.search);
      const linked = {
        transport,
        device,
        value: {
          url: "https://tauri.localhost",
          token: "",
          scope: transport.scopeId,
          transport,
        },
      };
      state.current.connection = linked;
      setConnection(linked);
      void transport.ended.then(({ code }) => {
        if (
          mounted.current &&
          state.current.connection?.transport === transport
        ) {
          closeConnection();
          setStatus("连接已结束；电脑上的任务可能仍在执行。");
          showError({ code });
        }
      });
    } catch (e) {
      if (id !== connectAttempt.current) return;
      if (errorCode(e) === "KEY_CONFIRMATION_REQUIRED") {
        setVerification(device);
        setChecked(false);
      } else showError(e);
    } finally {
      if (id === connectAttempt.current) setBusy(null);
    }
  }
  const back = useRef<() => Promise<boolean>>(async () => false);
  back.current = async () => {
    const current = state.current;
    if (current.dialog) {
      current.dialog.resolve(null);
      setDialog(null);
      return true;
    }
    if (current.verification) {
      connectAttempt.current++;
      setBusy(null);
      setVerification(null);
      return true;
    }
    if (busy === "login") {
      await cancelLogin();
      return true;
    }
    const details = [
      ...document.querySelectorAll<HTMLDetailsElement>("details[open]"),
    ]
      .filter((el) => el.getClientRects().length)
      .at(-1);
    if (details) {
      details.open = false;
      return true;
    }
    const overlay = [
      ...document.querySelectorAll<HTMLElement>('[role="dialog"],dialog[open]'),
    ]
      .filter((el) => el.getClientRects().length)
      .at(-1);
    const close = overlay?.querySelector<HTMLButtonElement>(
      'button[aria-label^="关闭"],button[title="关闭"]',
    );
    if (close) {
      close.click();
      return true;
    }
    if (document.querySelector('[data-native-unsaved="true"]')) {
      if ((await ask("文件修改尚未保存到电脑。保留手机草稿并离开？")) !== true)
        return true;
    }
    const event = new Event("anywork-mobile-back", { cancelable: true });
    window.dispatchEvent(event);
    if (event.defaultPrevented) return true;
    if (current.connection) {
      if (
        (await ask(
          "返回我的设备将断开连接和终端，电脑上的 Agent 任务继续执行。",
        )) === true
      )
        closeConnection();
      return true;
    }
    if (current.page !== "devices") {
      setPage("devices");
      return true;
    }
    return false;
  };
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    let receivedEvent = false;
    const message = (event: Event) =>
      setStatus((event as CustomEvent<string>).detail);
    const failure = (event: Event) =>
      setError((event as CustomEvent<string>).detail);
    window.addEventListener("anywork-platform-status", message);
    window.addEventListener("anywork-platform-error", failure);
    void (async () => {
      const unlisten = await listen<AccountSnapshot>(
        "mobile://account-state",
        (next) => {
          receivedEvent = true;
          try {
            apply(next);
          } catch (e) {
            showError(e);
          }
        },
      );
      if (disposed) {
        unlisten();
        return;
      }
      cleanups.push(unlisten);
      const stop = await startSystem({
        back: () => back.current(),
        foreground: async () => {
          const next = await accountCommand("snapshot");
          apply(next);
          if (next.phase === "signedIn") apply(await accountCommand("refresh"));
        },
        dialog: (request) => {
          state.current.dialog?.resolve(null);
          setDialogValue(request.value ?? "");
          setDialog(request);
        },
      });
      if (disposed) {
        stop();
        return;
      }
      cleanups.push(stop);
      const next = await accountCommand("snapshot");
      if (!receivedEvent) apply(next);
    })().catch(showError);
    return () => {
      disposed = true;
      mounted.current = false;
      ++operation.current;
      ++connectAttempt.current;
      state.current.dialog?.resolve(null);
      state.current.connection?.transport.close();
      for (const cleanup of cleanups.reverse()) cleanup();
      window.removeEventListener("anywork-platform-status", message);
      window.removeEventListener("anywork-platform-error", failure);
    };
  }, [apply, showError]);
  useEffect(() => {
    let frame = 0;
    const publish = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const current = state.current;
        const overlay = [
          ...document.querySelectorAll(
            'details[open],[role="dialog"],dialog[open]',
          ),
        ].some((el) => el.getClientRects().length);
        void backSetState(
          !!current.connection ||
            !!current.verification ||
            !!current.dialog ||
            current.page !== "devices" ||
            busy === "login" ||
            overlay,
          !!current.dialog,
        ).catch(showError);
      });
    };
    const observer = new MutationObserver(publish);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    publish();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [connection, verification, dialog, page, busy, showError]);
  // A directory revision invalidates the exact key the person was looking at.
  useEffect(() => {
    setVerification(null);
    setChecked(false);
  }, [snapshot.epoch, snapshot.revision]);
  function finishDialog(value: string | boolean | null) {
    dialog?.resolve(value);
    setDialog(null);
  }
  const signedIn = snapshot.phase === "signedIn" && snapshot.account;
  return (
    <div className="mobile-client">
      {error && (
        <div className="mobile-alert" role="alert">
          <span>{error}</span>
          <button aria-label="关闭错误" onClick={() => setError("")}>
            <X size={20} />
          </button>
        </div>
      )}
      {status && (
        <div className="mobile-status" role="status">
          <span>{status}</span>
          <button aria-label="关闭提示" onClick={() => setStatus("")}>
            <X size={18} />
          </button>
        </div>
      )}
      {connection ? (
        <App
          key={connection.value.scope}
          initial={connection.value}
          mobile
          deviceLabel={connection.device.label}
          accountLabel={snapshot.account?.label}
          onDevices={() => {
            void (async () => {
              if (
                document.querySelector('[data-native-unsaved="true"]') &&
                (await ask("文件修改尚未保存到电脑。保留手机草稿并离开？")) !==
                  true
              )
                return;
              if (
                (await ask(
                  "返回我的设备将断开连接和终端，电脑上的 Agent 任务继续执行。",
                )) === true
              )
                closeConnection();
            })();
          }}
          onDisconnect={closeConnection}
          onSignOut={() => void logout()}
          disconnectLabel="返回我的设备"
        />
      ) : verification ? (
        <section className="mobile-page mobile-key-page">
          <PageHeader
            title="核对电脑身份"
            back={() => {
              connectAttempt.current++;
              setBusy(null);
              setVerification(null);
            }}
          />
          <ShieldCheck size={36} />
          <h1>
            {verification.trustedPublicKey
              ? "这台电脑的公钥已改变"
              : "确认这是你的电脑"}
          </h1>
          <p>
            {verification.label} · {verification.platform}
          </p>
          <p className="mobile-secondary">
            在电脑端打开 AnyWork
            的远程访问设置，核对安全公钥。重新安装或设备更换可能改变公钥。
          </p>
          {verification.trustedPublicKey && (
            <KeyValue label="原公钥" value={verification.trustedPublicKey} />
          )}
          <KeyValue label="当前公钥" value={verification.publicKey} />
          <label className="mobile-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            我已在电脑端核对身份与完整公钥
          </label>
          <button
            className="mobile-primary"
            disabled={!checked || busy === "connect"}
            onClick={() => void connect(verification, true)}
          >
            {busy === "connect" ? "正在建立加密连接…" : "确认并连接"}
          </button>
        </section>
      ) : page === "guide" ? (
        <section className="mobile-page">
          <PageHeader title="添加工作电脑" back={() => setPage("devices")} />
          <h1>把电脑准备好</h1>
          <ol className="mobile-guide">
            <li>
              <strong>在电脑上安装 AnyWork</strong>
              <p>账号远程访问当前已验证 macOS。保持电脑开机联网。</p>
            </li>
            <li>
              <strong>登录同一个账号</strong>
              <p>电脑与手机的账号必须一致。</p>
            </li>
            <li>
              <strong>检查远程访问</strong>
              <p>
                打开电脑端远程访问，确认工作区已就绪。旧版电脑需要升级以接受移动客户端。
              </p>
            </li>
          </ol>
          <button
            className="mobile-primary"
            onClick={() => {
              setPage("devices");
              if (signedIn) void refresh();
            }}
          >
            我已准备好，检查设备
          </button>
          <a href="https://github.com/ywateru/AnyWork/blob/main/docs/getting-started.zh-CN.md">
            查看安装指南
          </a>
        </section>
      ) : page === "account" && signedIn ? (
        <section className="mobile-page">
          <PageHeader title="账户与设置" back={() => setPage("devices")} />
          <h1>{snapshot.account!.label}</h1>
          {snapshot.account!.email && <p>{snapshot.account!.email}</p>}
          <h2>外观</h2>
          <div className="mobile-segments" aria-label="外观">
            {(["system", "light", "dark"] as const).map((mode, i) => (
              <button
                key={mode}
                aria-pressed={appearance.appearance.mode === mode}
                onClick={() =>
                  appearance.setAppearance((value) => ({ ...value, mode }))
                }
              >
                {["跟随系统", "浅色", "深色"][i]}
              </button>
            ))}
          </div>
          <h2>已核验的电脑</h2>
          {snapshot.devices
            .filter((d) => d.trustedPublicKey)
            .map((device) => (
              <div className="mobile-trusted" key={device.deviceRef}>
                <strong>{device.label}</strong>
                <code>{device.trustedPublicKey}</code>
                {device.trustedPublicKey !== device.publicKey && (
                  <p className="mobile-danger">
                    公钥已改变，下次连接需要重新核验
                  </p>
                )}
              </div>
            ))}
          {!snapshot.devices.some((d) => d.trustedPublicKey) && (
            <p className="mobile-secondary">还没有核验过的电脑。</p>
          )}
          <p className="mobile-secondary">
            原生授权仅在当前应用进程内有效，进程结束后需重新登录。账号网页的登录
            Cookie 另由登录服务与 WebView 管理。
          </p>
          <a href="https://github.com/ywateru/AnyWork">AnyWork · 开源与许可</a>
          <button
            className="mobile-danger-button"
            disabled={!!busy}
            onClick={() => void logout()}
          >
            <LogOut size={18} />
            退出账号
          </button>
        </section>
      ) : !ready ? (
        <section className="mobile-page mobile-welcome">
          <Brand />
          <h1>正在准备工作空间</h1>
          <p role="status">检查应用与登录状态…</p>
          {error && (
            <button
              className="mobile-primary"
              onClick={() => location.reload()}
            >
              重新加载
            </button>
          )}
        </section>
      ) : !signedIn ? (
        <section className="mobile-page mobile-welcome">
          <Brand />
          <div className="mobile-welcome-copy">
            <h1>
              电脑上的工作，
              <br />
              从手机继续。
            </h1>
            <p>连接自己的工作电脑，处理会话、文件、终端和审批。</p>
          </div>
          {snapshot.phase === "reauthRequired" && (
            <p role="status">登录已失效。重新登录同一账号后可继续工作。</p>
          )}
          <button
            className="mobile-primary"
            disabled={busy === "login"}
            onClick={() => void login()}
          >
            {busy === "login" ? (
              <>
                <LoaderCircle className="mobile-spin" size={20} />
                正在登录…
              </>
            ) : (
              "登录账号"
            )}
          </button>
          {busy === "login" ? (
            <button
              className="mobile-secondary-button"
              onClick={() => void cancelLogin()}
            >
              取消登录
            </button>
          ) : (
            <button
              className="mobile-secondary-button"
              onClick={() => void login(true)}
            >
              注册账号
            </button>
          )}
          <button
            className="mobile-text-button"
            onClick={() => setPage("guide")}
          >
            如何添加工作电脑
          </button>
          <div className="mobile-security">
            <ShieldCheck size={18} />
            <p>登录在应用内账号页面完成。业务内容通过设备间加密连接传输。</p>
          </div>
        </section>
      ) : (
        <section className="mobile-page mobile-devices">
          <header className="mobile-brand-header">
            <Brand />
            <button aria-label="账户与设置" onClick={() => setPage("account")}>
              {snapshot.account!.label}
              <ChevronRight size={18} />
            </button>
          </header>
          <div className="mobile-heading">
            <div>
              <h1>我的设备</h1>
              <p>选择电脑，继续工作。</p>
            </div>
            <button
              aria-label="刷新设备"
              disabled={!!busy}
              onClick={() => void refresh()}
            >
              <RefreshCw
                size={21}
                className={busy === "refresh" ? "mobile-spin" : ""}
              />
            </button>
          </div>
          {snapshot.directoryState === "unknown" && (
            <div className="mobile-directory-error" role="status">
              <strong>暂时无法确认设备状态</strong>
              <p>下方可能是先前的资料。请刷新后再连接。</p>
              <button onClick={() => void refresh()} disabled={!!busy}>
                重新检查
              </button>
            </div>
          )}
          {snapshot.directoryState === "loading" && (
            <p role="status">正在读取设备…</p>
          )}
          <div className="mobile-device-list">
            {snapshot.devices.map((device) => (
              <article className="mobile-device" key={device.deviceRef}>
                <div className="mobile-device-main">
                  <span className="mobile-device-icon">
                    <Laptop size={25} />
                  </span>
                  <div>
                    <h2>{device.label}</h2>
                    <p>
                      <span
                        className={`mobile-dot ${device.online === true ? "online" : ""}`}
                      />
                      {device.online === true
                        ? "在线"
                        : device.online === false
                          ? "离线"
                          : "状态未知"}{" "}
                      · {device.platform}
                    </p>
                    <small>
                      {device.trustedPublicKey === device.publicKey
                        ? "身份已核验"
                        : device.trustedPublicKey
                          ? "公钥已改变，需重新核验"
                          : "首次连接需核验身份"}
                    </small>
                  </div>
                  <details className="mobile-device-menu">
                    <summary aria-label={`${device.label}的更多操作`}>
                      <MoreHorizontal size={22} />
                    </summary>
                    <div>
                      <button onClick={() => void updateDevice(device, false)}>
                        修改名称
                      </button>
                      <button onClick={() => void updateDevice(device, true)}>
                        移除显示
                      </button>
                    </div>
                  </details>
                </div>
                <button
                  className="mobile-connect"
                  disabled={
                    !!busy ||
                    device.online !== true ||
                    snapshot.directoryState !== "ready"
                  }
                  onClick={() => void connect(device)}
                >
                  {" "}
                  {busy === "connect"
                    ? "正在连接…"
                    : device.online === true
                      ? "打开工作区"
                      : device.online === false
                        ? "电脑离线"
                        : "等待状态确认"}
                  <ArrowRight size={18} />
                </button>
                {device.online === false && (
                  <p className="mobile-device-hint">
                    请确认电脑开机联网，并开启远程访问。
                  </p>
                )}
              </article>
            ))}
          </div>
          {!snapshot.devices.length && snapshot.directoryState === "ready" && (
            <div className="mobile-empty">
              <Laptop size={38} />
              <h2>添加你的第一台电脑</h2>
              <p>在电脑上安装 AnyWork，登录同一账号并开启远程访问。</p>
            </div>
          )}
          <button
            className="mobile-secondary-button"
            onClick={() => setPage("guide")}
          >
            <Plus size={18} />
            添加工作电脑
          </button>
          {busy === "connect" && (
            <button
              onClick={() => {
                connectAttempt.current++;
                setBusy(null);
              }}
            >
              取消等待
            </button>
          )}
        </section>
      )}
      {dialog && (
        <div className="mobile-dialog-shade">
          <form
            className="mobile-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.message}
            onSubmit={(e) => {
              e.preventDefault();
              finishDialog(dialog.value === undefined ? true : dialogValue);
            }}
          >
            <h2>{dialog.message}</h2>
            {dialog.value !== undefined && (
              <input
                aria-label={dialog.message}
                autoFocus
                value={dialogValue}
                maxLength={80}
                onChange={(e) => setDialogValue(e.target.value)}
              />
            )}
            <div>
              <button type="button" onClick={() => finishDialog(null)}>
                取消
              </button>
              <button
                className="mobile-primary"
                type="submit"
                disabled={dialog.value !== undefined && !dialogValue.trim()}
              >
                确认
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="mobile-brand">
      <img src={logo} alt="" width={32} height={32} />
      <span>AnyWork</span>
    </div>
  );
}
function PageHeader({ title, back }: { title: string; back(): void }) {
  return (
    <header className="mobile-page-header">
      <button aria-label="返回" onClick={back}>
        <ArrowLeft size={23} />
      </button>
      <span>{title}</span>
    </header>
  );
}
function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="mobile-key">
      <span>{label}</span>
      <code>{value}</code>
      <button
        aria-label={`复制${label}`}
        onClick={() =>
          void Promise.resolve()
            .then(() => navigator.clipboard.writeText(value))
            .then(() =>
              window.dispatchEvent(
                new CustomEvent("anywork-platform-status", {
                  detail: "已复制公钥",
                }),
              ),
            )
            .catch(platformError)
        }
      >
        <Copy size={18} />
        复制
      </button>
    </div>
  );
}
