import { BrowserStorage } from "@logto/browser";

const grantKeys = ["idToken", "refreshToken", "accessToken"] as const;
type StorageKey = Parameters<BrowserStorage["getItem"]>[0];

/** One SDK instance owns one persisted grant. The synchronous checks also cover
 * the interval before another tab's storage event is delivered. Never clear or
 * overwrite a replacement grant when an old refresh response finishes. */
export class AccountGrantStorage extends BrowserStorage {
  private retired = false;
  private readonly expected = new Map<string, string | null>();

  constructor(namespace: string) {
    super(namespace);
    if (typeof window !== "undefined") {
      try {
        for (const key of grantKeys)
          this.expected.set(key, localStorage.getItem(this.getKey(key)));
      } catch {
        // Keep the login surface renderable when browser storage is denied.
        this.retired = true;
      }
    }
  }

  assertCurrent() {
    if (this.retired) throw new Error("ACCOUNT_REAUTH_REQUIRED");
    for (const [key, value] of this.expected)
      if (localStorage.getItem(this.getKey(key as StorageKey)) !== value) {
        this.retired = true;
        throw new Error("ACCOUNT_REAUTH_REQUIRED");
      }
  }

  retire() {
    this.retired = true;
  }

  async getItem(key: StorageKey) {
    this.assertCurrent();
    return super.getItem(key);
  }

  async setItem(key: StorageKey, value: string) {
    this.assertCurrent();
    // BrowserStorage writes synchronously before returning its Promise. Update
    // only our own field; never adopt another tab's concurrently changed grant.
    const result = super.setItem(key, value);
    if (this.expected.has(key)) this.expected.set(key, value);
    return result;
  }

  async removeItem(key: StorageKey) {
    this.assertCurrent();
    const result = super.removeItem(key);
    if (this.expected.has(key)) this.expected.set(key, null);
    return result;
  }
}
