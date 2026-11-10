import { Laptop, UserRound } from "lucide-react";
import { accountPortalUrl } from "../accountConfig";

export default function AccountEntry({
  onDevices,
  signup = false,
  label,
}: {
  onDevices?: () => void;
  signup?: boolean;
  label?: string;
}) {
  if (onDevices)
    return (
      <button className="workspace-account-entry" onClick={onDevices}>
        <Laptop size={15} /> 我的设备
      </button>
    );
  let href: string;
  try {
    href = accountPortalUrl(import.meta.env.VITE_ACCOUNT_PORTAL_URL);
  } catch {
    return (
      <span className="workspace-account-unavailable">账号入口配置无效</span>
    );
  }
  return (
    <a
      className="workspace-account-entry"
      href={href + (signup ? "?signup=1" : "")}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={
        signup
          ? "注册账号（在新标签页打开）"
          : label
            ? `${label}（在新标签页打开）`
            : "登录查看设备（在新标签页打开）"
      }
      title="在新标签页打开账号与设备，保留当前工作区"
    >
      <UserRound size={15} /> {signup ? "注册账号" : label || "注册 / 登录"}
    </a>
  );
}
