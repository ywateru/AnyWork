import { createContext, useContext, type ReactNode } from "react";
import "./AccountIdentityDetails.css";

export type AccountIdentityView = {
  label: string;
  email?: string;
  status: "loading" | "ready" | "missing" | "error";
  locale: "en" | "zh-CN";
  retry: () => void;
  signIn: () => void;
};
export const AccountIdentityContext = createContext<AccountIdentityView | null>(
  null,
);

/** Shared by the actual device page and connected workspace account menu. */
export function AccountIdentityDetails({ fallback }: { fallback?: ReactNode }) {
  const identity = useContext(AccountIdentityContext);
  if (!identity) return fallback;
  const zh = identity.locale === "zh-CN";
  return (
    <div className="account-identity-details">
      <p className="account-identity-name">{identity.label}</p>
      {identity.email && identity.email !== identity.label && (
        <p>{identity.email}</p>
      )}
      {identity.status !== "ready" && (
        <>
          <p role="status">
            {identity.status === "loading"
              ? zh
                ? "正在读取账号资料…"
                : "Loading account profile…"
              : identity.status === "missing"
                ? zh
                  ? "账号未提供可显示的名称或邮箱。"
                  : "No display name or email is available."
                : zh
                  ? "账号身份资料暂时不可用。"
                  : "Account profile is temporarily unavailable."}
          </p>
          {identity.status !== "loading" && (
            <>
              <button type="button" onClick={identity.retry}>
                {zh ? "重试账号资料" : "Retry profile"}
              </button>
              <button type="button" onClick={identity.signIn}>
                {zh ? "重新登录" : "Sign in again"}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
