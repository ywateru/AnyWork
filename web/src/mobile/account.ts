import { invoke } from "./bridge";
export interface Device {
  deviceRef: string;
  installationId: string;
  label: string;
  platform: string;
  publicKey: string;
  keyVersion: number;
  online: boolean | null;
  trustedPublicKey: string | null;
}
export interface AccountSnapshot {
  protocolVersion: 1;
  epoch: number;
  phase: "signedOut" | "signingIn" | "signedIn" | "reauthRequired";
  account: { scopeId: string; label: string; email: string | null } | null;
  devices: Device[];
  directoryState: "idle" | "loading" | "ready" | "unknown";
  revision: number;
  errorCode: string | null;
}
export function accountCommand(
  command:
    "snapshot" | "login" | "cancel" | "logout" | "refresh" | "device_update",
  request?: object,
) {
  return invoke<AccountSnapshot>(`mobile_account_${command}`, request);
}
export function errorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error)
    return String(error.code);
  return error instanceof Error ? error.message : String(error);
}
export function friendlyError(error: unknown) {
  const code = errorCode(error);
  const messages: Record<string, string> = {
    CANCELLED: "操作已取消",
    LOGIN_REQUIRED: "登录已失效，请重新登录",
    AUTHORIZATION_EXPIRED: "连接授权已过期，请重新连接",
    DIRECTORY_CONFLICT: "设备资料已更改，请刷新后重新核验",
    DEVICE_NOT_READY: "电脑尚未就绪，请检查电脑上的远程访问",
    KEY_CONFIRMATION_REQUIRED: "请先核对电脑的安全公钥",
    STALE_CONNECTION: "连接已失效，请重新连接",
    CONNECTION_CLOSED: "连接已断开，请重新连接",
    TIMEOUT: "连接超时，请检查网络后重试",
    LIMIT_EXCEEDED: "操作超过当前传输限制",
  };
  return messages[code] || code || "暂时无法完成操作，请重试";
}
