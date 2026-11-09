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

type AccountSnapshot = {
  signedIn: boolean;
  subject: string | null;
  enabled: boolean;
  busy: boolean;
  checkpointPending: boolean;
  error: string | null;
  gridDeviceId: string | null;
  installationId: string | null;
  publicKey: string | null;
};
type Begin = {
  restored: boolean;
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
const message = "账号操作未完成，请检查登录状态、系统钥匙串和网络后重试。";
let loginOwner:
  | { transactionId: string; client: LogtoClient; memory: Map<string, string> }
  | undefined;
async function login(): Promise<void> {
  if (loginOwner) throw new Error("上次登录仍在收尾，请先取消或退出账号。");
  const begin = await invoke<Begin>("account_begin");
  if (begin.restored) return;
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
    });
    const callback = await invoke<string>("account_wait_callback", {
      transactionId: begin.transactionId,
    });
    await client.handleSignInCallback(callback);
    // One JS owner requests both token classes serially; Rust journals every
    // rotation before either request returns across IPC.
    const accountToken = await client.getAccessToken();
    const accessToken = await client.getAccessToken(begin.resource);
    const refreshToken = await client.getRefreshToken();
    if (!refreshToken) throw new Error(message);
    const outcome = await invoke<string>("account_commit", {
      transactionId: begin.transactionId,
      tokens: { accessToken, accountToken, refreshToken },
    });
    if (outcome !== "OwnedPersisted" && outcome !== "OwnedPending")
      throw new Error(message);
    handedOff = true;
    await client.clearAllTokens();
    memory.clear();
    loginOwner = undefined;
    if (outcome === "OwnedPending")
      throw new Error(
        "账号已由本机接管，系统钥匙串保存尚未完成。请重试恢复或退出账号后重新登录。",
      );
  } catch {
    if (!handedOff) {
      try {
        await invoke("account_cancel", { transactionId: begin.transactionId });
        await client.clearAllTokens();
        memory.clear();
        loginOwner = undefined;
      } catch {
        /* Retain the JS owner without refreshing until native ownership is resolved. */
      }
    }
    throw new Error(message);
  }
}
export function AccountPage({ localReady }: { localReady: boolean }) {
  const [state, setState] = useState<AccountSnapshot | null>(null);
  const [pending, setPending] = useState(false);
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
    setPending(true);
    setError("");
    try {
      await fn();
      setState(await invoke<AccountSnapshot>("account_snapshot"));
    } catch {
      setError(message);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <header>
        <div>
          <h1>账号与远程访问</h1>
          <p>登录同一账号后，从手机或浏览器找到这台电脑。</p>
        </div>
        <ShieldCheck size={28} aria-hidden="true" />
      </header>
      <section className="settings-section">
        <h2>AnyWork 账号</h2>
        <p className="hint">注册和密码输入在登录服务中完成。</p>
        <p role="status">
          {state?.signedIn
            ? "已登录"
            : state?.busy
              ? "等待浏览器完成登录"
              : "尚未登录"}
        </p>
        {state?.signedIn || state?.checkpointPending || error ? (
          <button
            disabled={pending}
            onClick={() =>
              void action(async () => {
                await invoke("account_logout");
                if (loginOwner) {
                  await loginOwner.client.clearAllTokens();
                  loginOwner.memory.clear();
                  loginOwner = undefined;
                }
              })
            }
          >
            退出账号
          </button>
        ) : (
          <button
            disabled={pending || state?.busy}
            onClick={() => void action(login)}
          >
            注册 / 登录
          </button>
        )}
        {(state?.busy || loginOwner) && (
          <button
            onClick={() =>
              void action(async () => {
                if (loginOwner) {
                  await invoke("account_cancel", {
                    transactionId: loginOwner.transactionId,
                  });
                  await loginOwner.client.clearAllTokens();
                  loginOwner.memory.clear();
                  loginOwner = undefined;
                }
              })
            }
          >
            取消登录
          </button>
        )}
      </section>
      <section className="settings-section">
        <h2>允许我的其他设备访问</h2>
        <p className="hint">
          会话、文件和终端内容保留在这台电脑。远程连接在设备两端解密。
        </p>
        <p role="status">
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
        {!localReady && <p className="hint">先在总览启动并连接本地服务。</p>}
        {state?.enabled && state.installationId && state.publicKey ? (
          <div aria-label="本机身份核对">
            <p className="hint">
              首次从浏览器连接时，请核对以下设备身份和公钥。
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
        ) : (
          <p className="hint">开启远程访问后，可在此核对本机身份与公钥。</p>
        )}

        {state?.checkpointPending && (
          <button
            disabled={pending}
            onClick={() => void action(() => invoke("account_recover"))}
          >
            重试保存账号
          </button>
        )}
        {state?.checkpointPending && (
          <p role="alert">
            系统钥匙串保存未完成。访问令牌尚未提供给远程连接，请恢复钥匙串或退出账号后重试。
          </p>
        )}
      </section>
      {(error || state?.error) && (
        <div role="alert" className="error">
          {error || state?.error}
        </div>
      )}
    </>
  );
}
