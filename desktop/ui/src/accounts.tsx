import { useEffect, useRef, useState } from "react";
import LogtoClient, {
  type ClientAdapter,
  type PersistKey,
  type StorageKey,
  Prompt,
} from "@logto/client";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "@logto/browser";
import { Copy, ExternalLink } from "lucide-react";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

import { ConfirmDialog } from "./confirm";

type AuthorizationStatus =
  | "signedOut"
  | "authorizing"
  | "loginInterrupted"
  | "signedIn"
  | "reauthRequired"
  | "unsupported";
export type AccountSnapshot = {
  authorizationStatus: AuthorizationStatus;
  transactionId: string | null;
  signedIn: boolean;
  subject: string | null;
  accountLabel: string | null;
  enabled: boolean;
  busy: boolean;
  error: string | null;
  gridDeviceId: string | null;
  installationId: string | null;
  publicKey: string | null;
  accountPortalUrl: string;
  remoteClients: {
    id: string;
    kind: "ios" | "android" | "desktop" | "unknown";
    connectedAt: number;
  }[];
};
type Begin = {
  transactionId: string;
  endpoint: string;
  issuer: string;
  appId: string;
  resource: string;
  scope: string;
  redirectUri: string;
};
const invoke = <T,>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> =>
  window.__TAURI__
    ? window.__TAURI__.core.invoke<T>(command, args)
    : Promise.reject(new Error("请从 AnyWork 桌面应用打开此页面。"));
const message = "账号操作未完成，请检查登录状态和网络后重试。";
const enableMessages: Record<string, string> = {
  REMOTE_ENABLE_IDENTITY: "本机设备身份准备失败。",
  REMOTE_ENABLE_GATEWAY: "本机加密入口启动失败。",
  REMOTE_ENABLE_PROVIDER: "公网连接入口未就绪，请检查网络。",
  REMOTE_ENABLE_GRID_CLIENT: "设备协调客户端启动失败。",
  REMOTE_ENABLE_GRID_CONFIG:
    "设备协调服务配置校验未通过，请核对客户端与服务配置。",
  REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE: "暂时无法连接设备协调服务。",
  REMOTE_ENABLE_RESOURCE_TOKEN: "远程访问授权更新未完成，请查看账号状态。",
  REMOTE_ENABLE_GRID_REGISTER: "设备协调注册未完成。",
  REMOTE_ENABLE_GRID_EXPOSE: "加密入口发布未完成。",
  REMOTE_ENABLE_INDEX_TOKEN: "设备目录授权更新未完成，请查看账号状态。",
  REMOTE_ENABLE_INDEX_READ: "设备目录读取或账号校验未完成。",
  REMOTE_ENABLE_INDEX_SCHEMA: "设备目录格式或容量校验未通过。",
  REMOTE_ENABLE_INDEX_WRITE: "设备目录更新未完成。",
  REMOTE_ENABLE_INDEX_READBACK: "设备目录更新后的核对未通过。",
};
function actionError(error: unknown): { message: string; code: string | null } {
  // Accept only exact native stage codes, never display an arbitrary IPC error,
  // SDK body, URL or token. Retrying remains an explicit user action.
  return typeof error === "string" && Object.hasOwn(enableMessages, error)
    ? { message: enableMessages[error], code: error }
    : { message, code: null };
}

let loginOwner:
  | { transactionId: string; client: LogtoClient; memory: Map<string, string> }
  | undefined;
async function clearLogin(transactionId?: string): Promise<void> {
  const owner = loginOwner;
  const snapshot = await invoke<AccountSnapshot>("account_snapshot");
  const id = transactionId ?? owner?.transactionId ?? snapshot.transactionId;
  if (id && snapshot.transactionId === id) {
    try {
      await invoke("account_cancel", { transactionId: id });
    } catch {
      const after = await invoke<AccountSnapshot>("account_snapshot");
      if (after.transactionId === id) throw new Error(message);
    }
  }
  if (owner && (!id || owner.transactionId === id)) {
    await owner.client.clearAllTokens();
    owner.memory.clear();
    if (loginOwner === owner) loginOwner = undefined;
  }
}
async function login(mode: "register" | "signIn"): Promise<void> {
  if (loginOwner) throw new Error("上次登录仍在收尾，请先取消或退出账号。");
  const begin = await invoke<Begin>("account_begin");
  const memory = new Map<string, string>();
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const response = await invoke<{
      status: number;
      headers: Record<string, string>;
      body: string;
    }>("account_fetch", {
      transactionId: begin.transactionId,
      request: {
        url: request.url,
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : await request.text(),
      },
    });
    // Official requesters may log raw OAuth error bodies. Reject before these
    // bodies reach the SDK and only show the fixed local error above.
    if (response.status < 200 || response.status >= 300)
      throw new Error(message);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
  const adapter: ClientAdapter = {
    storage: {
      getItem: async (key: StorageKey | PersistKey) => memory.get(key) ?? null,
      setItem: async (key: StorageKey | PersistKey, value: string) => {
        memory.set(key, value);
      },
      removeItem: async (key: StorageKey | PersistKey) => {
        memory.delete(key);
      },
    },
    fetch: transport,
    navigate: async (url, options) => {
      if (options.for !== "sign-in") throw new Error(message);
      await invoke("account_open", { transactionId: begin.transactionId, url });
    },
    generateState: async () => generateState(),
    generateCodeVerifier: async () => generateCodeVerifier(),
    generateCodeChallenge: async (verifier) => generateCodeChallenge(verifier),
  };
  let keys: Promise<ReturnType<typeof createLocalJWKSet>> | undefined;
  const client = new LogtoClient(
    {
      endpoint: begin.endpoint,
      appId: begin.appId,
      resources: [begin.resource],
      scopes: begin.scope.split(/\s+/),
      requestTimeoutMs: 30000,
    },
    adapter,
    (instance) => ({
      verifyIdToken: async (token) => {
        keys ??= (async () => {
          const configuration = await instance.getOidcConfig();
          if (configuration.issuer !== begin.issuer) throw new Error(message);
          const response = await transport(configuration.jwksUri, {
            method: "GET",
          });
          const jwks = (await response.json()) as JSONWebKeySet;
          if (
            !Array.isArray(jwks.keys) ||
            jwks.keys.length < 1 ||
            jwks.keys.length > 32
          )
            throw new Error(message);
          return createLocalJWKSet(jwks);
        })().catch(() => {
          keys = undefined;
          throw new Error(message);
        });
        const result = await jwtVerify(token, await keys, {
          audience: begin.appId,
          issuer: begin.issuer,
          clockTolerance: 300,
          requiredClaims: ["sub", "iat", "exp"],
        });
        if (
          typeof result.payload.sub !== "string" ||
          !result.payload.sub ||
          Math.abs((result.payload.iat ?? 0) - Date.now() / 1000) > 300
        )
          throw new Error(message);
      },
    }),
  );
  loginOwner = { transactionId: begin.transactionId, client, memory };
  let handedOff = false;
  try {
    await client.signIn({
      redirectUri: begin.redirectUri,
      prompt: [Prompt.Login, Prompt.Consent],
      firstScreen: mode,
    });
    const callback = await invoke<string>("account_wait_callback", {
      transactionId: begin.transactionId,
    });
    await client.handleSignInCallback(callback);
    // One JS owner requests both token classes serially; Rust retains every
    // rotation in RAM before either request returns across IPC.
    const accountToken = await client.getAccessToken();
    const accessToken = await client.getAccessToken(begin.resource);
    const refreshToken = await client.getRefreshToken();
    if (!refreshToken) throw new Error(message);
    const outcome = await invoke<string>("account_commit", {
      transactionId: begin.transactionId,
      tokens: { accessToken, accountToken, refreshToken },
    });
    if (outcome !== "OwnedInMemory") throw new Error(message);
    handedOff = true;
    await client.clearAllTokens();
    memory.clear();
    loginOwner = undefined;
  } catch {
    if (!handedOff) {
      try {
        await clearLogin(begin.transactionId);
      } catch {
        /* Retain the JS owner without refreshing until native ownership is resolved. */
      }
    }
    throw new Error(message);
  }
}
export function useAccountController() {
  const [state, setState] = useState<AccountSnapshot | null>(null);
  const [operations, setOperations] = useState(0);
  const [remoteOperations, setRemoteOperations] = useState(0);
  const pending = operations > 0;
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [remoteIssue, setRemoteIssue] = useState<ReturnType<
    typeof actionError
  > | null>(null);
  const remoteGeneration = useRef(0);
  const authorizationGeneration = useRef(0);
  const [available, setAvailable] = useState(false);
  const generation = useRef(0);
  const authorizationIdentity = useRef<string | null | undefined>(undefined);
  function acceptSnapshot(next: AccountSnapshot) {
    const identity =
      next.authorizationStatus === "signedIn" && next.signedIn
        ? (next.subject ?? next.accountLabel)
        : null;
    if (authorizationIdentity.current !== identity) {
      authorizationIdentity.current = identity;
      ++authorizationGeneration.current;
      ++remoteGeneration.current;
      setRemoteIssue(null);
    }
    setState(next);
    setAvailable(true);
  }
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const owner = generation.current;
      try {
        const next = await invoke<AccountSnapshot>("account_snapshot");
        if (active && owner === generation.current) {
          acceptSnapshot(next);
        }
      } catch {
        if (active && owner === generation.current) setAvailable(false);
      }
      if (active) timer = setTimeout(() => void refresh(), 1000);
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  async function action(
    fn: () => Promise<unknown>,
    remote = false,
    valid = () => true,
  ) {
    const owner = ++generation.current;
    const remoteOwner = remote ? ++remoteGeneration.current : 0;
    const authorizationOwner = authorizationGeneration.current;
    // Portal/copy actions order snapshots but do not own a remote failure.
    // Authorization actions synchronously revoke remote ownership below.
    const isCurrent = () =>
      valid() &&
      (remote
        ? remoteOwner === remoteGeneration.current &&
          authorizationOwner === authorizationGeneration.current
        : owner === generation.current);
    const isCurrentAuthorization = () =>
      valid() &&
      authorizationOwner === authorizationGeneration.current &&
      (!remote || remoteOwner === remoteGeneration.current);
    const setCount = remote ? setRemoteOperations : setOperations;
    setCount((count) => count + 1);
    setError("");
    setErrorCode(null);
    if (remote) setRemoteIssue(null);
    try {
      await fn();
    } catch (error) {
      if (isCurrent()) {
        const issue = actionError(error);
        if (remote) setRemoteIssue(issue);
        else {
          setError(issue.message);
          setErrorCode(issue.code);
        }
      }
    } finally {
      if (isCurrent()) {
        const finalOwner = ++generation.current;
        try {
          const next = await invoke<AccountSnapshot>("account_snapshot");
          if (finalOwner === generation.current && isCurrentAuthorization()) {
            acceptSnapshot(next);
          }
        } catch {
          if (finalOwner === generation.current && isCurrentAuthorization()) {
            setAvailable(false);
            setError(message);
          }
        }
      }
      setCount((count) => count - 1);
    }
  }
  function authorizationAction(fn: () => Promise<unknown>) {
    ++authorizationGeneration.current;
    ++remoteGeneration.current;
    setRemoteIssue(null);
    return action(fn);
  }
  // If IPC failed during cleanup, retain an explicit cancellation action for
  // the matching memory adapter even when a later native snapshot is signed out.
  const visibleState =
    state?.authorizationStatus === "signedOut" && loginOwner
      ? {
          ...state,
          authorizationStatus: pending
            ? ("authorizing" as const)
            : ("loginInterrupted" as const),
        }
      : state;
  return {
    state: visibleState,
    available,
    pending,
    remotePending: remoteOperations > 0,
    error: remoteIssue?.message ?? error,
    errorCode: remoteIssue ? remoteIssue.code : errorCode,
    action,
    remoteAction: (fn: () => Promise<unknown>, valid?: () => boolean) =>
      action(fn, true, valid),
    signIn: (mode: "register" | "signIn") =>
      authorizationAction(() => login(mode)),
    cancel: () => authorizationAction(() => clearLogin()),
    logout: () =>
      authorizationAction(async () => {
        await invoke("account_logout");
        await clearLogin();
      }),
  };
}
export type AccountController = ReturnType<typeof useAccountController>;
const statusLabels: Record<AuthorizationStatus, string> = {
  signedOut: "尚未登录",
  authorizing: "等待浏览器完成登录",
  loginInterrupted: "登录已结束，请取消本次登录后重试",
  signedIn: "已登录",
  reauthRequired: "本机授权需要重新登录",
  unsupported: "当前平台暂不支持账号远程访问",
};
export function accountStatusText(state: AccountSnapshot): string {
  return state.authorizationStatus === "signedIn" && state.accountLabel
    ? `已登录 · ${state.accountLabel}`
    : statusLabels[state.authorizationStatus];
}
export function AccountActions({
  controller,
  onLogout,
}: {
  controller: AccountController;
  onLogout?: () => void;
}) {
  const { state, available, pending, signIn, cancel, logout } = controller;
  if (!available) return <span role="status">正在核验账号状态</span>;
  if (!state) return <span role="status">正在读取账号状态</span>;
  switch (state.authorizationStatus) {
    case "signedOut":
      return (
        <>
          <button disabled={pending} onClick={() => void signIn("register")}>
            创建账号
          </button>
          <button
            className="primary"
            disabled={pending}
            onClick={() => void signIn("signIn")}
          >
            登录已有账号
          </button>
        </>
      );
    case "authorizing":
    case "loginInterrupted":
      return <button onClick={() => void cancel()}>取消登录</button>;
    case "signedIn":
      return (
        <button
          disabled={pending}
          onClick={() => (onLogout ? onLogout() : void logout())}
        >
          退出账号
        </button>
      );
    case "reauthRequired":
      return (
        <button disabled={pending} onClick={() => void logout()}>
          结束本次授权后重新登录
        </button>
      );
    case "unsupported":
      return null;
  }
}
export function AccountEntry({
  controller,
}: {
  controller: AccountController;
}) {
  const { state, available } = controller;
  return (
    <section className="signin-content" aria-label="AnyWork 账号入口">
      <p className="hint">注册和登录在系统浏览器中完成，密码由登录服务处理。</p>
      <p className="account-status" role="status">
        {available && state ? accountStatusText(state) : "正在核验账号状态"}
      </p>
      <div className="account-entry-actions">
        <AccountActions controller={controller} />
      </div>
      {state?.authorizationStatus === "unsupported" && (
        <p className="notice">
          当前平台暂不支持桌面账号登录，因此无法从这里准备或打开工作区。可以使用独立的命令行入口；本应用不会跳过账号验证。
        </p>
      )}
      <p className="hint default-remote-disclosure">
        登录并准备工作区后，将默认开启远程访问；你可以随时关闭。
      </p>
      <AccountError controller={controller} />
    </section>
  );
}
export function publicPortal(
  state: AccountSnapshot | null,
  available: boolean,
): string | null {
  if (!available || typeof state?.accountPortalUrl !== "string") return null;
  try {
    const url = new URL(state.accountPortalUrl);
    return url.protocol === "https:" &&
      !url.username &&
      !url.href
        .slice(url.protocol.length + 2)
        .split("/")[0]
        .includes("@") &&
      !url.search &&
      !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function AccountError({
  controller,
}: {
  controller: AccountController;
}) {
  const raw = controller.error || controller.state?.error;
  if (!raw) return null;
  const code =
    controller.errorCode ?? (Object.hasOwn(enableMessages, raw) ? raw : null);
  return (
    <div className="account-error">
      <p role="alert" className="error">
        {code ? enableMessages[code] : raw}
      </p>
      {code && (
        <details className="error-details">
          <summary>诊断详情</summary>
          <code>{code}</code>
          <p className="hint">检查网络、账号与设备协调配置后，手动重试。</p>
        </details>
      )}
    </div>
  );
}
export function remoteConnectionCount(
  state: AccountSnapshot | null,
): number | null {
  const list = state?.remoteClients;
  return Array.isArray(list) &&
    list.length <= 4 &&
    list.every(
      (client) =>
        client &&
        typeof client.id === "string" &&
        client.id.length > 0 &&
        ["ios", "android", "desktop", "unknown"].includes(client.kind) &&
        Number.isFinite(client.connectedAt) &&
        client.connectedAt > 0 &&
        client.connectedAt <= 8640000000000,
    )
    ? list.length
    : null;
}
export function remoteStatusText(controller: AccountController): string {
  const { state, available, remotePending, error } = controller;
  if (!available || !state) return "状态暂不可用";
  if (remotePending || state.busy) return "正在准备远程访问…";
  if (!state.enabled)
    return error || state.error ? "未能开启 · 重试" : "已关闭";
  const count = remoteConnectionCount(state);
  return count === null
    ? "已开启 · 连接状态暂不可用"
    : `已开启 · ${count} 个活动连接`;
}
export function AccountPage({
  localReady,
  controller,
}: {
  localReady: boolean;
  controller: AccountController;
}) {
  const { state, available, pending, remotePending, remoteAction, action } =
    controller;
  const portal = publicPortal(state, available);
  const busy = remotePending || Boolean(available && state?.busy);
  const [disableConfirmation, setDisableConfirmation] = useState<string | null>(
    null,
  );
  const [intent, setIntent] = useState<"enable" | "disable" | null>(null);
  const owner = state?.subject ?? state?.accountLabel ?? null;
  const count = remoteConnectionCount(state);
  async function toggleRemote(disable: boolean) {
    if (
      !available ||
      !state?.signedIn ||
      busy ||
      pending ||
      (!disable && !localReady)
    )
      return;
    if (disable && !state.enabled) return;
    setDisableConfirmation(null);
    setIntent(disable ? "disable" : "enable");
    try {
      await remoteAction(() =>
        invoke(disable ? "account_disable" : "account_enable"),
      );
    } finally {
      setIntent(null);
    }
  }
  const [copied, setCopied] = useState<{ url: string; message: string } | null>(
    null,
  );
  return (
    <section className="remote-panel" aria-label="远程使用">
      <p className="page-description">让同一账号的其他设备连接这台电脑。</p>
      <div className="remote-status-row">
        <p role="status">
          <span
            className={
              available && state?.enabled ? "status-dot ready" : "status-dot"
            }
          />
          {!available || !state
            ? "远程状态暂不可用"
            : busy
              ? intent === "disable"
                ? "正在关闭远程访问…"
                : "正在准备远程访问…"
              : state?.enabled
                ? "远程访问已开启"
                : "远程访问未开启"}
        </p>
        {!available || !state ? (
          <span className="hint">状态未知</span>
        ) : (
          <button
            role="switch"
            aria-label={
              state.enabled
                ? "关闭远程访问"
                : controller.error
                  ? "重试开启远程"
                  : "开启远程访问"
            }
            aria-checked={state.enabled}
            disabled={
              pending ||
              busy ||
              (!state.enabled && (!state.signedIn || !localReady))
            }
            onClick={() => {
              if (state.enabled && count !== 0 && owner)
                setDisableConfirmation(owner);
              else void toggleRemote(state.enabled);
            }}
          >
            {busy
              ? intent === "disable"
                ? "正在关闭…"
                : "正在开启…"
              : state.enabled
                ? "关闭远程访问"
                : controller.error
                  ? "重试开启远程"
                  : "开启远程访问"}
          </button>
        )}
      </div>
      <p className="hint remote-impact">
        {!available || !state
          ? "恢复状态前无法更改远程访问。"
          : state.enabled
            ? "关闭会中断当前远程连接，本地工作区继续可用。"
            : "本次登录手动关闭后保持关闭，可随时重新开启。"}
      </p>
      <AccountError controller={controller} />
      <div className="remote-portal-block">
        <span className="address-heading">其他设备的账号入口</span>
        <code className="portal-address" data-testid="account-portal">
          {portal ?? "账号入口暂不可用"}
        </code>
        <div className="portal-actions">
          <button
            aria-label="复制账号入口"
            disabled={!portal}
            onClick={() => {
              void (async () => {
                if (!portal) return;
                try {
                  await navigator.clipboard.writeText(portal);
                  setCopied({ url: portal, message: "账号入口已复制" });
                } catch {
                  setCopied({
                    url: portal,
                    message: "未能复制，请选中账号入口手动复制。",
                  });
                }
              })();
            }}
          >
            <Copy size={15} aria-hidden="true" />
            复制
          </button>
          <button
            aria-label="打开账号入口"
            disabled={!portal || pending}
            onClick={() => void action(() => invoke("desktop_account_portal"))}
          >
            <ExternalLink size={15} aria-hidden="true" />
            打开
          </button>
        </div>
        <p className="copy-feedback" role="status">
          {portal && copied?.url === portal ? copied.message : ""}
        </p>
      </div>
      <details className="connection-help">
        <summary>如何连接其他设备</summary>
        <p className="hint">
          在手机或网页打开上方账号入口，登录同一账号，选择这台电脑。手机不能使用本地地址。
        </p>
        <p className="hint">首次连接或身份变更时，请核对本机身份和公钥。</p>
      </details>
      {available &&
      state?.enabled &&
      state.installationId &&
      state.publicKey ? (
        <details className="identity-details" aria-label="本机身份核对">
          <summary>本机身份核对</summary>
          <div className="identity-content">
            <label>
              设备身份
              <input
                aria-label="设备身份"
                readOnly
                value={state.installationId}
              />
            </label>
            <label>
              设备公钥
              <input aria-label="设备公钥" readOnly value={state.publicKey} />
            </label>
            <button
              onClick={() =>
                void action(async () => {
                  await navigator.clipboard.writeText(
                    `${state.installationId}\n${state.publicKey}`,
                  );
                })
              }
            >
              复制设备身份与公钥
            </button>
          </div>
        </details>
      ) : (
        <p className="hint identity-unavailable">开启远程后可核对本机身份。</p>
      )}
      {disableConfirmation && (
        <ConfirmDialog
          title="关闭远程访问？"
          confirmLabel="确认关闭远程"
          disabled={
            !available ||
            !state?.enabled ||
            owner !== disableConfirmation ||
            pending ||
            busy
          }
          onClose={() => setDisableConfirmation(null)}
          onConfirm={() => {
            if (owner === disableConfirmation) void toggleRemote(true);
          }}
        >
          <p>
            {count === null
              ? "将断开当前远程连接。"
              : `将断开当前 ${count} 个活动连接。`}
            本地工作区继续可用。本次登录期间会保持关闭，直到你手动开启。
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
