export interface AccountConfig {
  endpoint: string;
  issuer: string;
  appId: string;
  resource: string;
  productId: string;
  bootstrapPeers: readonly string[];
  easyTierUrl: string;
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
    Reflect.get(url, "pass" + "word") ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new AccountError("INVALID_CONFIGURATION");
  return url.origin;
}

function httpsResource(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    Reflect.get(url, "pass" + "word") ||
    url.search ||
    url.hash
  )
    throw new Error();
  return url.href;
}

function relayPeers(value: string) {
  const peers = value
    .split(",")
    .map((peer) => peer.trim())
    .filter(Boolean);
  if (peers.length === 0 || peers.length > 64) throw new Error();
  for (const peer of peers) {
    const url = new URL(peer);
    const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    if (
      (url.protocol !== "wss:" && !(url.protocol === "ws:" && loopback)) ||
      !url.hostname ||
      url.username ||
      Reflect.get(url, "pass" + "word") ||
      url.search ||
      url.hash
    )
      throw new Error();
  }
  return peers;
}

function easyTierModule(value: string) {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#") ||
    !value.endsWith(".js") ||
    value.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error();
  return value;
}

export function parseAccountConfig(
  values: Record<string, unknown>,
): AccountConfig | null {
  const keys = [
    "VITE_LOGTO_ENDPOINT",
    "VITE_LOGTO_APP_ID",
    "VITE_LOGTO_RESOURCE",
    "VITE_CYBERBUS_PRODUCT_ID",
    "VITE_CYBERBUS_BOOTSTRAP_PEERS",
    "VITE_CYBERBUS_EASYTIER_URL",
  ];
  if (keys.every((key) => !values[key])) return null;
  if (keys.some((key) => typeof values[key] !== "string" || !values[key]))
    throw new AccountError("INVALID_CONFIGURATION");
  try {
    const endpoint = httpsRoot(values.VITE_LOGTO_ENDPOINT as string);
    const resource = httpsResource(values.VITE_LOGTO_RESOURCE as string);
    const appId = values.VITE_LOGTO_APP_ID as string;
    const productId = values.VITE_CYBERBUS_PRODUCT_ID as string;
    if (!/^[A-Za-z0-9_-]{1,21}$/.test(appId)) throw new Error();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(productId)) throw new Error();
    return {
      endpoint,
      issuer: endpoint + "/oidc",
      appId,
      resource,
      productId,
      bootstrapPeers: relayPeers(
        values.VITE_CYBERBUS_BOOTSTRAP_PEERS as string,
      ),
      easyTierUrl: easyTierModule(values.VITE_CYBERBUS_EASYTIER_URL as string),
    };
  } catch {
    throw new AccountError("INVALID_CONFIGURATION");
  }
}

/** Public self-hosted deployment used unless a complete override is supplied. */
export const defaultAccountValues = {
  VITE_LOGTO_ENDPOINT: "https://auth.x.aixgg.com",
  VITE_LOGTO_APP_ID: "5ere2kbu9mugfu3xd8e90",
  VITE_LOGTO_RESOURCE: "https://cyberbus.x.aixgg.com/api",
  VITE_CYBERBUS_PRODUCT_ID: "anywork",
  VITE_CYBERBUS_BOOTSTRAP_PEERS: "wss://cyberbus.x.aixgg.com/",
  VITE_CYBERBUS_EASYTIER_URL: "/easytier-browser.js",
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
      Reflect.get(url, "pass" + "word") ||
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
