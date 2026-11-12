import LogtoClient, {
  BrowserStorage,
  decodeAccessToken,
  type LogtoConfig,
  type SignInOptions,
} from "@logto/browser";
import {
  AccountError,
  accountStorageNamespace,
  type AccountConfig,
} from "./accountConfig";
import type { AccessTokenRequest } from "./vendor/cybergrid";

/** Capture the owner before the first await, including a delayed claims read. */
export async function withAccountSubject<T>(
  subject: () => string | undefined,
  claims: () => Promise<{ sub?: string } | null | undefined>,
  operation: () => Promise<T>,
): Promise<T> {
  const expected = subject();
  const before = await claims();
  if (!expected || subject() !== expected || before?.sub !== expected)
    throw new AccountError("IDENTITY_CHANGED");
  const value = await operation();
  const after = await claims();
  if (subject() !== expected || after?.sub !== expected)
    throw new AccountError("IDENTITY_CHANGED");
  return value;
}

function sufficientValidity(token: string, seconds: number): boolean {
  try {
    // Unverified exp is only a cache freshness hint. Identity remains verified by
    // Logto/our subject fence and the receiving service, never by this decode.
    const { exp } = decodeAccessToken(token);
    return (
      typeof exp === "number" &&
      Number.isFinite(exp) &&
      exp * 1000 - Date.now() >= seconds * 1000
    );
  } catch {
    return false;
  }
}

/** Keep the official browser adapter, isolating persisted grants across issuers. */
export class AccountLogtoClient extends LogtoClient {
  private tokenTail: Promise<void> = Promise.resolve();
  private accountEpoch = 0;
  private tokenAccessBlocked = false;
  private readonly gridBinding: Pick<
    AccountConfig,
    "issuer" | "appId" | "resource"
  >;
  constructor(config: LogtoConfig, account: AccountConfig) {
    super(config);
    this.gridBinding = {
      issuer: account.issuer,
      appId: account.appId,
      resource: account.resource,
    };
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
    return this.accountToken(resource, fresh);
  }
  /** Only the official Grid callback can request this fixed resource binding. */
  getCyberGridAccessToken(request: AccessTokenRequest): Promise<string> {
    const binding = this.gridBinding;
    if (
      request.issuer !== binding.issuer ||
      request.clientId !== binding.appId ||
      request.resource !== binding.resource ||
      !Array.isArray(request.scopes) ||
      request.scopes.length !== 1 ||
      request.scopes[0] !== "connect" ||
      !Number.isSafeInteger(request.minValidity) ||
      request.minValidity < 1 ||
      request.minValidity > 3600 ||
      typeof request.forceRefresh !== "boolean" ||
      !["connect", "coordination-recovery", "authorization-rejected"].includes(
        request.requestReason,
      ) ||
      request.forceRefresh !==
        (request.requestReason === "authorization-rejected") ||
      !Number.isSafeInteger(request.generation) ||
      request.generation < 0 ||
      !(request.signal instanceof AbortSignal)
    )
      return Promise.reject(new AccountError("INVALID_TOKEN_REQUEST"));
    return this.accountToken(request.resource, request.forceRefresh, request);
  }
  private accountToken(
    resource?: string,
    fresh = false,
    request?: AccessTokenRequest,
  ): Promise<string> {
    const epoch = this.accountEpoch;
    return this.serialize(async () => {
      const current = () => {
        request?.signal.throwIfAborted();
        if (epoch !== this.accountEpoch || this.tokenAccessBlocked)
          throw new Error("ACCOUNT_REAUTH_REQUIRED");
      };
      current();
      const ownedSDK = async <T>(operation: () => Promise<T>): Promise<T> => {
        try {
          return await operation();
        } catch {
          // A failed exchange may have rotated the grant. Do not replay it.
          this.tokenAccessBlocked = true;
          throw new Error("ACCOUNT_REAUTH_REQUIRED");
        }
      };
      const acquire = async (force: boolean) => {
        if (force) {
          await ownedSDK(() => this.clearAccessToken());
          current();
        }
        // Never cancel an already-started rotation: the official SDK must
        // finish saving its result before another resource/logout can run.
        return ownedSDK(() => this.getAccessToken(resource));
      };
      let token = await acquire(fresh);
      current();
      if (request && !sufficientValidity(token, request.minValidity)) {
        if (!fresh) {
          token = await acquire(true);
          current();
        }
        if (!sufficientValidity(token, request.minValidity))
          throw new AccountError("TOKEN_VALIDITY_INSUFFICIENT");
      }
      return token;
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
