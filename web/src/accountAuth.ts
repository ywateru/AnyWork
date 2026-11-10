import LogtoClient, {
  BrowserStorage,
  type LogtoConfig,
  type SignInOptions,
} from "@logto/browser";
import { accountStorageNamespace, type AccountConfig } from "./accountConfig";

/** Keep the official browser adapter, isolating persisted grants across issuers. */
export class AccountLogtoClient extends LogtoClient {
  private tokenTail: Promise<void> = Promise.resolve();
  private accountEpoch = 0;
  private tokenAccessBlocked = false;
  constructor(config: LogtoConfig, account: AccountConfig) {
    super(config);
    // Official client defers persisted token reads to first use, explicitly allowing
    // subclasses to replace adapter.storage in their constructor.
    this.adapter.storage = new BrowserStorage(accountStorageNamespace(account));
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tokenTail.then(operation);
    this.tokenTail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  /** All opaque/resource requests share one refresh-token owner, including renewals. */
  getAccountAccessToken(resource?: string, fresh = false): Promise<string> {
    const epoch = this.accountEpoch;
    return this.serialize(async () => {
      if (epoch !== this.accountEpoch || this.tokenAccessBlocked)
        throw new Error("ACCOUNT_REAUTH_REQUIRED");
      try {
        // SDK 3.1.2 caches right up to expiry. Its public cache invalidation API
        // requests a fresh resource token without reading or replaying a grant.
        if (fresh) await this.clearAccessToken();
        const token = await this.getAccessToken(resource);
        if (epoch !== this.accountEpoch)
          throw new Error("ACCOUNT_REAUTH_REQUIRED");
        return token;
      } catch {
        // A failed exchange may have rotated the grant. Do not retry its old value.
        this.tokenAccessBlocked = true;
        throw new Error("ACCOUNT_REAUTH_REQUIRED");
      }
    });
  }
  startAccountSignIn(options: SignInOptions) {
    ++this.accountEpoch;
    this.tokenAccessBlocked = true;
    return this.serialize(() => this.signIn(options));
  }
  endAccountSession(postLogoutRedirectUri?: string) {
    ++this.accountEpoch;
    this.tokenAccessBlocked = true;
    // Fence immediately, then wait for the only in-flight rotation before SDK
    // cleanup/revocation so it cannot recreate token storage after logout.
    return this.serialize(() => this.signOut(postLogoutRedirectUri));
  }
}
