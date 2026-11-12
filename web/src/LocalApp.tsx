import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import App from "./App";
import AccountEntry from "./components/AccountEntry";
import {
  initialLocalTicket,
  initialLocalHandoffRejected,
} from "./localBootstrap";
import {
  LocalTransport,
  readLocalSession,
  type LocalContext,
} from "./localTransport";
import "./account.css";
import {
  AccountBrand,
  AccountSurface,
  AccountUtilities,
} from "./components/AccountChrome";
// StrictMode remounts must not consume the single-use handoff twice.
let bootstrap: Promise<LocalContext> | undefined;
export default function LocalApp() {
  const [session, setSession] = useState<{
    context: LocalContext;
    transport: LocalTransport;
  }>();
  const [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const open = (promise: Promise<LocalContext>) => {
    let cancelled = false;
    setBusy(true);
    setError("");
    void promise
      .then((context) => {
        if (cancelled) return;
        const transport = new LocalTransport();
        setSession({ context, transport });
        void transport.ended.then(() =>
          setSession((current) =>
            current?.transport === transport ? undefined : current,
          ),
        );
      })
      .catch(() => {
        if (!cancelled)
          setError("本机会话尚未建立或已到期，请从桌面端重新打开工作区。");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  };
  useEffect(() => {
    bootstrap ??= initialLocalHandoffRejected
      ? Promise.reject(new Error("LOCAL_SESSION_REQUIRED"))
      : readLocalSession(initialLocalTicket);
    return open(bootstrap);
  }, []);
  const disconnect = async () => {
    session?.transport.close();
    setSession(undefined);
    setBusy(true);
    try {
      const response = await fetch("/api/local/session", {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) throw new Error();
      setError("已退出本机网页会话。桌面上的工作和远程授权继续保留。");
    } catch {
      setError("本机网页已关闭，退出请求未完成。请返回桌面端检查本机服务。");
    } finally {
      setBusy(false);
    }
  };
  if (session)
    return (
      <App
        initial={{
          url: location.origin,
          token: "",
          scope: location.origin,
          transport: session.transport,
        }}
        deviceLabel="这台电脑"
        contextLabel={`这台电脑${session.context.accountLabel ? ` · 由 ${session.context.accountLabel} 在本机打开` : " · 本地工作区"}`}
        disconnectLabel="退出本机网页会话"
        onDisconnect={() => void disconnect()}
      />
    );
  return (
    <AccountSurface className="account-auth local-entry">
      <main className="account-auth-main local-entry-main">
        <AccountBrand />
        <h1>这台电脑的工作区</h1>
        <p>在 AnyWork 桌面端点击“打开本地工作区”，即可继续本机工作。</p>
        {busy ? (
          <p role="status">正在确认本机会话…</p>
        ) : (
          <>
            <p role="status">{error || "请从桌面端打开工作区。"}</p>
            <button
              className="account-primary"
              onClick={() => open(readLocalSession())}
            >
              <RefreshCw size={16} />
              重新检查
            </button>
            <p className="local-entry-hint">
              本机浏览器会话与 Web 账号相互独立。登录账号不能代替本机授权。
            </p>
            <div className="account-login-actions">
              <AccountEntry label="登录查看设备" />
              <AccountEntry signup />
            </div>
          </>
        )}
        <AccountUtilities />
      </main>
    </AccountSurface>
  );
}
