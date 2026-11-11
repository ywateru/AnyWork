import { useEffect, useState } from "react";
import { Laptop, RefreshCw } from "lucide-react";
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
        contextLabel={`这台电脑${session.context.accountLabel ? ` · 由 ${session.context.accountLabel} 在本机打开` : " · 本地工作区"}`}
        disconnectLabel="退出本机网页会话"
        onDisconnect={() => void disconnect()}
      />
    );
  return (
    <div className="account-root local-entry">
      <header className="account-header">
        <a className="account-brand" href="/">
          <img
            src={import.meta.env.BASE_URL + "icon.svg"}
            width="32"
            height="32"
            alt=""
          />
          AnyWork
        </a>
        <AccountEntry />
      </header>
      <main className="local-entry-main">
        <Laptop size={36} strokeWidth={1.4} />
        <h1>这台电脑的工作区</h1>
        <p>在 AnyWork 桌面端点击“打开工作区”，即可继续本机工作。</p>
        <p className="local-entry-hint">
          本地工作无需云账号。登录正式账号页面可查看已允许远程访问的设备。
        </p>
        {busy ? (
          <p role="status">正在确认本机会话…</p>
        ) : (
          <>
            <p role="status">{error || "请从桌面端打开工作区。"}</p>
            <button onClick={() => open(readLocalSession())}>
              <RefreshCw size={16} />
              重新检查
            </button>
            <div className="account-login-actions">
              <AccountEntry />
              <AccountEntry signup />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
