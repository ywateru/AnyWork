import { useEffect, useState } from "react";
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
import { ShieldCheck } from "lucide-react";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

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
  REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE:
    "暂时无法读取设备协调服务配置，已完成有限重试。",
  REMOTE_ENABLE_RESOURCE_TOKEN: "远程访问授权更新未完成，请查看账号状态。",
  REMOTE_ENABLE_GRID_REGISTER: "设备协调注册未完成。",
  REMOTE_ENABLE_GRID_EXPOSE: "加密入口发布未完成。",
  REMOTE_ENABLE_INDEX_TOKEN: "设备目录授权更新未完成，请查看账号状态。",
  REMOTE_ENABLE_INDEX_READ: "设备目录读取或账号校验未完成。",
  REMOTE_ENABLE_INDEX_SCHEMA: "设备目录格式或容量校验未通过。",
  REMOTE_ENABLE_INDEX_WRITE: "设备目录更新未完成。",
  REMOTE_ENABLE_INDEX_READBACK: "设备目录更新后的核对未通过。",
};
function actionError(error: unknown): string {
  // Accept only exact native stage codes, never display an arbitrary IPC error,
  // SDK body, URL or token. Retrying remains an explicit user action.
  return typeof error === "string" && Object.hasOwn(enableMessages, error)
    ? `${enableMessages[error]}请处理后手动重试。（${error}）`
    : message;
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
  const pending = operations > 0;
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await invoke<AccountSnapshot>("account_snapshot");
        if (active) setState(next);
      } catch {
        if (active) setError(message);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function action(fn: () => Promise<unknown>) {
    setOperations((count) => count + 1);
    setError("");
    try {
      await fn();
    } catch (error) {
      setError(actionError(error));
    } finally {
      try {
        setState(await invoke<AccountSnapshot>("account_snapshot"));
      } catch {
        setError(message);
      }
      setOperations((count) => count - 1);
    }
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
    pending,
    error,
    action,
    signIn: (mode: "register" | "signIn") => action(() => login(mode)),
    cancel: () => action(() => clearLogin()),
    logout: () =>
      action(async () => {
        await invoke("account_logout");
        await clearLogin();
      }),
  };
}
type AccountController = ReturnType<typeof useAccountController>;
const statusLabels: Record<AuthorizationStatus, string> = {
  signedOut: "尚未登录",
  authorizing: "等待浏览器完成登录",
  loginInterrupted: "登录已结束，请取消本次登录后重试",
  signedIn: "已登录",
  reauthRequired: "本机授权需要重新登录",
  unsupported: "当前平台暂不支持账号远程访问",
};
function accountStatusText(state: AccountSnapshot): string {
  return state.authorizationStatus === "signedIn" && state.accountLabel
    ? `已登录 · ${state.accountLabel}`
    : statusLabels[state.authorizationStatus];
}
function AccountActions({ controller }: { controller: AccountController }) {
  const { state, pending, signIn, cancel, logout } = controller;
  if (!state) return <span role="status">正在读取账号状态</span>;
  switch (state.authorizationStatus) {
    case "signedOut":
      return (
        <>
          <button disabled={pending} onClick={() => void signIn("register")}>
            注册
          </button>
          <button
            className="primary"
            disabled={pending}
            onClick={() => void signIn("signIn")}
          >
            登录
          </button>
        </>
      );
    case "authorizing":
    case "loginInterrupted":
      return <button onClick={() => void cancel()}>取消登录</button>;
    case "signedIn":
      return (
        <button disabled={pending} onClick={() => void logout()}>
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
export function AccountPage({
  localReady,
  controller,
}: {
  localReady: boolean;
  controller: AccountController;
}) {
  const { state, pending, error, action } = controller;
  return (
    <section
      className="workspace-panel account-panel"
      aria-label="AnyWork 账号入口"
    >
      <div className="panel-heading">
        <ShieldCheck size={20} aria-hidden="true" />
        <h2>从其他设备继续</h2>
      </div>
      <p className="hint account-intro">
        手机或网页登录同一账号，选择这台电脑。
        {(!state ||
          ["signedOut", "authorizing", "loginInterrupted"].includes(
            state.authorizationStatus,
          )) &&
          "注册和登录会在系统浏览器中完成。"}
      </p>
      <section className="account-identity" aria-label="账号状态">
        <p className="account-status" role="status">
          {state ? accountStatusText(state) : "正在读取账号状态"}
        </p>
        <div className="account-entry-actions">
          <AccountActions controller={controller} />
        </div>
      </section>
      <section className="remote-control" aria-label="远程访问设置">
        <h3>允许我的其他设备访问</h3>
        <p className="hint">登录后仍需在这台电脑开启远程访问。</p>
        <div className="remote-status-row">
          <p role="status">
            <span
              className={state?.enabled ? "status-dot ready" : "status-dot"}
            />
            {state?.enabled ? "远程访问已开启" : "远程访问未开启"}
          </p>
          <button
            disabled={
              pending || (!state?.enabled && (!state?.signedIn || !localReady))
            }
            onClick={() =>
              void action(() =>
                invoke(state?.enabled ? "account_disable" : "account_enable"),
              )
            }
          >
            {state?.enabled ? "关闭远程访问" : "开启远程访问"}
          </button>
        </div>
        {!localReady && (
          <p className="hint remote-next-step">
            先打开本地工作区，再开启远程访问。
          </p>
        )}
        {pending && (
          <p className="hint" role="status">
            正在处理账号操作，请稍候。
          </p>
        )}
      </section>
      <div className="device-actions">
        <button
          onClick={() => void action(() => invoke("desktop_account_portal"))}
        >
          查看我的设备
        </button>
        {state?.enabled && state.installationId && state.publicKey ? (
          <details aria-label="本机身份核对">
            <summary>身份核对</summary>
            <div className="identity-content">
              <p className="hint">
                首次从浏览器连接或身份变更时，请核对以下设备身份和公钥。
              </p>
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
          <p className="hint">开启远程后可核对本机身份。</p>
        )}
      </div>
      {(error || state?.error) && (
        <div role="alert" className="error">
          {error || state?.error}
        </div>
      )}
    </section>
  );
}
