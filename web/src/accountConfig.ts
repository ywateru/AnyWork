export interface AccountConfig {
  endpoint: string;
  issuer: string;
  appId: string;
  resource: string;
  gridUrl: string;
  nativeAppId: string;
}

export class AccountError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AccountError";
  }
}

function httpsRoot(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new AccountError("INVALID_CONFIGURATION");
  return url.origin;
}

export function parseAccountConfig(
  values: Record<string, unknown>,
): AccountConfig | null {
  const keys = [
    "VITE_LOGTO_ENDPOINT",
    "VITE_LOGTO_APP_ID",
    "VITE_LOGTO_RESOURCE",
    "VITE_CYBERGRID_URL",
    "VITE_CYBERGRID_NATIVE_APP_ID",
  ];
  if (keys.every((key) => !values[key])) return null;
  if (keys.some((key) => typeof values[key] !== "string" || !values[key]))
    throw new AccountError("INVALID_CONFIGURATION");
  try {
    const endpoint = httpsRoot(values.VITE_LOGTO_ENDPOINT as string);
    const gridUrl = httpsRoot(values.VITE_CYBERGRID_URL as string);
    const resource = new URL(values.VITE_LOGTO_RESOURCE as string);
    if (
      resource.protocol !== "https:" ||
      resource.username ||
      resource.password ||
      resource.hash ||
      resource.search
    )
      throw new Error();
    const appId = values.VITE_LOGTO_APP_ID as string;
    const nativeAppId = values.VITE_CYBERGRID_NATIVE_APP_ID as string;
    if (![appId, nativeAppId].every((id) => /^[A-Za-z0-9_-]{1,21}$/.test(id)))
      throw new Error();
    return {
      endpoint,
      issuer: endpoint + "/oidc",
      appId,
      resource: resource.href,
      gridUrl,
      nativeAppId,
    };
  } catch {
    throw new AccountError("INVALID_CONFIGURATION");
  }
}

/** Public self-hosted deployment used unless a complete override is supplied. */
export const defaultAccountValues = {
  VITE_LOGTO_ENDPOINT: "https://auth.x.aixgg.com",
  VITE_LOGTO_APP_ID: "5ere2kbu9mugfu3xd8e90",
  VITE_LOGTO_RESOURCE: "https://anywork-cybergrid-selfhost.vercel.app/api",
  VITE_CYBERGRID_URL: "https://anywork-cybergrid-selfhost.vercel.app",
  VITE_CYBERGRID_NATIVE_APP_ID: "x7lzj58abb1sdp16lkd34",
};

export function resolveAccountConfig(
  values: Record<string, unknown>,
): AccountConfig {
  const hasOverride = Object.keys(defaultAccountValues).some(
    (key) => values[key] !== undefined,
  );
  const config = parseAccountConfig(
    hasOverride ? values : defaultAccountValues,
  );
  if (!config) throw new AccountError("INVALID_CONFIGURATION");
  return config;
}

export function accountPortalUrl(
  value: unknown = "https://anywork.aixgg.com/app/",
): string {
  try {
    if (typeof value !== "string") throw new Error();
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/app/"
    )
      throw new Error();
    return url.href;
  } catch {
    throw new AccountError("INVALID_CONFIGURATION");
  }
}

export function accountStorageNamespace(
  config: Pick<AccountConfig, "issuer" | "appId">,
): string {
  return "anywork:" + encodeURIComponent(config.issuer) + ":" + config.appId;
}
