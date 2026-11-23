import { AccountError } from "./accountConfig";
import { publicKeyBytes } from "./remoteTransport";

export interface DeviceRecord {
  label: string;
  platform: string;
  publicKey: string;
  keyVersion: number;
}
export interface DeviceLocator {
  version: 1;
  productId: string;
  ipv4: string;
  port: number;
  keyVersion: number;
  issuedAt: number;
  expiresAt: number;
}
export interface AnyWorkData {
  schemaVersion: 1;
  preferences?: {
    locale?: "zh-CN" | "en";
    appearance?: "light" | "dark" | "system";
  };
  devices: Record<string, DeviceRecord>;
  cyberbus: Record<string, DeviceLocator>;
}
export interface AccountProfile {
  customData: Record<string, unknown>;
  anywork: AnyWorkData;
}
const MAX_BYTES = 32 * 1024;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const safeId = (value: string) =>
  !["__proto__", "constructor", "prototype", "toString"].includes(value) &&
  /^[A-Za-z0-9_-]{1,128}$/.test(value);
const safeText = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);
function parseLocator(value: unknown): DeviceLocator {
  if (
    !object(value) ||
    Object.keys(value).length !== 7 ||
    value.version !== 1 ||
    !safeText(value.productId, 64) ||
    !/^[A-Za-z0-9_-]+$/.test(value.productId) ||
    typeof value.ipv4 !== "string" ||
    typeof value.port !== "number" ||
    !Number.isSafeInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    value.port === 11000 ||
    typeof value.keyVersion !== "number" ||
    !Number.isSafeInteger(value.keyVersion) ||
    value.keyVersion < 1 ||
    typeof value.issuedAt !== "number" ||
    !Number.isSafeInteger(value.issuedAt) ||
    value.issuedAt < 0 ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= value.issuedAt ||
    value.expiresAt - value.issuedAt > 86400
  )
    throw new AccountError("INVALID_ACCOUNT_DATA");
  const octets = value.ipv4.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255) ||
    octets[0] !== 10 ||
    octets[1] !== 144 ||
    (octets[2]! & 0xf0) !== 0
  )
    throw new AccountError("INVALID_ACCOUNT_DATA");
  return {
    version: 1,
    productId: value.productId,
    ipv4: value.ipv4,
    port: value.port,
    keyVersion: value.keyVersion,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  };
}
export function parseAccountProfile(value: unknown): AccountProfile {
  if (
    !object(value) ||
    !object(value.customData) ||
    new TextEncoder().encode(JSON.stringify(value.customData)).byteLength >
      MAX_BYTES
  )
    throw new AccountError("INVALID_ACCOUNT_DATA");
  const customData = value.customData;
  if (customData.anywork === undefined)
    return {
      customData,
      anywork: { schemaVersion: 1, devices: {}, cyberbus: {} },
    };
  const raw = customData.anywork;
  if (
    !object(raw) ||
    raw.schemaVersion !== 1 ||
    !object(raw.devices) ||
    Object.keys(raw.devices).length > 32 ||
    (raw.cyberbus !== undefined && !object(raw.cyberbus)) ||
    (object(raw.cyberbus) && Object.keys(raw.cyberbus).length > 32)
  )
    throw new AccountError("INVALID_ACCOUNT_DATA");
  const devices: Record<string, DeviceRecord> = Object.create(null);
  for (const [id, item] of Object.entries(raw.devices)) {
    if (
      !safeId(id) ||
      !object(item) ||
      !safeText(item.label, 80) ||
      !safeText(item.platform, 32) ||
      typeof item.publicKey !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(item.publicKey) ||
      !Number.isSafeInteger(item.keyVersion) ||
      (item.keyVersion as number) < 1
    )
      throw new AccountError("INVALID_ACCOUNT_DATA");
    try {
      publicKeyBytes(item.publicKey);
    } catch {
      throw new AccountError("INVALID_ACCOUNT_DATA");
    }
    devices[id] = {
      label: item.label,
      platform: item.platform,
      publicKey: item.publicKey,
      keyVersion: item.keyVersion as number,
    };
  }
  const cyberbus: Record<string, DeviceLocator> = Object.create(null);
  for (const [id, item] of Object.entries(
    object(raw.cyberbus) ? raw.cyberbus : {},
  )) {
    if (!safeId(id) || !devices[id])
      throw new AccountError("INVALID_ACCOUNT_DATA");
    cyberbus[id] = parseLocator(item);
  }
  let preferences: AnyWorkData["preferences"];
  if (raw.preferences !== undefined) {
    if (
      !object(raw.preferences) ||
      (raw.preferences.locale !== undefined &&
        !["zh-CN", "en"].includes(raw.preferences.locale as string)) ||
      (raw.preferences.appearance !== undefined &&
        !["light", "dark", "system"].includes(
          raw.preferences.appearance as string,
        ))
    )
      throw new AccountError("INVALID_ACCOUNT_DATA");
    preferences = {
      ...(raw.preferences.locale
        ? { locale: raw.preferences.locale as "zh-CN" | "en" }
        : {}),
      ...(raw.preferences.appearance
        ? {
            appearance: raw.preferences.appearance as
              "light" | "dark" | "system",
          }
        : {}),
    };
  }
  return {
    customData,
    anywork: {
      schemaVersion: 1,
      devices,
      cyberbus,
      ...(preferences ? { preferences } : {}),
    },
  };
}

/** Account API owns only this user's public settings. It never authorizes remote access. */
export class AccountStore {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private endpoint: string,
    private token: () => Promise<string | undefined>,
    private fetcher: typeof fetch = (input, options) => fetch(input, options),
  ) {}
  async read(signal?: AbortSignal): Promise<AccountProfile> {
    const response = await this.call("GET", undefined, signal);
    return parseAccountProfile(await response.json());
  }
  update(
    change: (current: AnyWorkData) => AnyWorkData,
    signal?: AbortSignal,
  ): Promise<AccountProfile> {
    const write = this.writes
      .catch(() => {})
      .then(async () => {
        const before = await this.read(signal);
        const anywork = change(structuredClone(before.anywork));
        const customData = {
          ...before.customData,
          anywork: {
            ...(object(before.customData.anywork)
              ? before.customData.anywork
              : {}),
            ...anywork,
          },
        };
        const expected = parseAccountProfile({ customData });
        await this.call("PATCH", JSON.stringify({ customData }), signal);
        const after = await this.read(signal);
        if (JSON.stringify(after.anywork) !== JSON.stringify(expected.anywork))
          throw new AccountError("CONFIGURATION_CONFLICT");
        return after;
      });
    this.writes = write;
    return write;
  }
  private async call(method: string, body?: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const accessToken = await this.token(); // No resource: opaque Account API token.
    signal?.throwIfAborted();
    if (!accessToken) throw new AccountError("LOGIN_REQUIRED");
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint + "/api/my-account", {
        method,
        body,
        signal,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: "Bearer " + accessToken,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new AccountError("ACCOUNT_UNAVAILABLE");
    }
    if (!response.ok)
      throw new AccountError(
        response.status === 401 ? "LOGIN_REQUIRED" : "ACCOUNT_UNAVAILABLE",
      );
    return response;
  }
}
