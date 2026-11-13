import { AccountError } from "./accountConfig";

/** Display data only. Subject remains the authorization/isolation boundary. */
export type AccountIdentity = {
  subject: string;
  label: string;
  email?: string;
};
type ProfileFields = {
  sub?: unknown;
  exp?: unknown;
  name?: unknown;
  username?: unknown;
  preferred_username?: unknown;
  email?: unknown;
};

function readable(value: unknown, subject: string): string | undefined {
  if (typeof value !== "string") return;
  const text = value.trim();
  if (
    !text.replace(/\p{Cf}/gu, "").trim() ||
    text === subject ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text)
  )
    return;
  return text;
}

/** Logto's official profile claims use `username`; accept OIDC's alias too.
 * No customData, device name, nested profile or subject fallback is consulted. */
export function accountIdentity(
  profile: ProfileFields,
  subject: string,
): AccountIdentity | undefined {
  if (!subject || profile.sub !== subject)
    throw new AccountError("IDENTITY_CHANGED");
  const email = readable(profile.email, subject);
  const label =
    readable(profile.name, subject) ??
    readable(profile.username, subject) ??
    readable(profile.preferred_username, subject) ??
    email;
  return label ? { subject, label, email } : undefined;
}

/** The caller aborts on retry/logout/unmount/account change. The SDK validates
 * ID tokens at exchange; UserInfo is obtained with its authenticated public API. */
export async function readAccountIdentity({
  subject,
  claims,
  userInfo,
  signal,
}: {
  subject: string;
  claims: () => Promise<ProfileFields>;
  userInfo: (subject: string, signal: AbortSignal) => Promise<ProfileFields>;
  signal: AbortSignal;
}): Promise<AccountIdentity | undefined> {
  signal.throwIfAborted();
  const before = await claims();
  signal.throwIfAborted();
  const fromClaims = accountIdentity(before, subject);
  // An expired token's display claims alone cannot establish current identity.
  const expired =
    typeof before.exp === "number" && before.exp * 1000 <= Date.now();
  const result =
    fromClaims && !expired
      ? fromClaims
      : accountIdentity(await userInfo(subject, signal), subject);
  signal.throwIfAborted();
  const after = await claims();
  signal.throwIfAborted();
  if (after.sub !== subject) throw new AccountError("IDENTITY_CHANGED");
  return result;
}
