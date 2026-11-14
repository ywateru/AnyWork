/** Public failure classifications only: never display HTTP bodies, token errors,
 * exception messages, subjects or URLs received from an upstream service. */
export type PresenceStage =
  "account" | "configuration" | "host-authorization" | "exchange" | "directory";
const stages: readonly string[] = [
  "account",
  "configuration",
  "host-authorization",
  "exchange",
  "directory",
];
const codes = new Set([
  "ACCOUNT_UNAVAILABLE",
  "INVALID_ACCOUNT_DATA",
  "LOGIN_REQUIRED",
  "IDENTITY_CHANGED",
  "INVALID_CONFIGURATION",
  "CONFIGURATION_MISMATCH",
  "AUTHENTICATION_FAILED",
  "SESSION_UNAVAILABLE",
  "NETWORK_ERROR",
  "TIMEOUT",
  "INVALID_RESPONSE",
  "FORBIDDEN",
  "DIRECTORY_TOO_LARGE",
]);
export interface PresenceFailure {
  stage: PresenceStage;
  code: string;
  status?: number;
}
export function presenceFailure(
  error: unknown,
  fallback: PresenceStage,
): PresenceFailure {
  const value = error instanceof Error ? error : undefined;
  const code = value && "code" in value ? value.code : undefined;
  const stage = value && "stage" in value ? value.stage : undefined;
  const status = value && "status" in value ? value.status : undefined;
  return {
    stage:
      typeof stage === "string" && stages.includes(stage)
        ? (stage as PresenceStage)
        : fallback,
    code: typeof code === "string" && codes.has(code) ? code : "UNAVAILABLE",
    ...(typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
      ? { status }
      : {}),
  };
}
export function presenceStageLabel(
  stage: PresenceStage,
  locale: "zh-CN" | "en",
) {
  const labels = {
    account: ["账号设备资料", "Account device records"],
    configuration: ["在线状态服务配置", "Presence service configuration"],
    "host-authorization": ["在线状态授权", "Presence authorization"],
    exchange: ["在线状态服务会话", "Presence service session"],
    directory: ["设备在线状态查询", "Device presence query"],
  };
  return labels[stage][locale === "zh-CN" ? 0 : 1];
}
