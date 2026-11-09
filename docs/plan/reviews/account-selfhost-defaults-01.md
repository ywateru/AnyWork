# Self-hosted client defaults — independent review

Date: 2026-11-09. Reviewed exact product commit: `d20308fb28abd956c2116d3e045948f2380bc290`.

Scope: Native seven-field public defaults and Web five-field public defaults, following the self-hosted revision in [account-client-entry](../tasks/account-client-entry.md) and [native configuration contract](../../account-desktop.md). This review does not verify the new issuer's actual deployment or authorization flow.

## Findings

None.

- Native defaults match the supplied public binding: endpoint `https://auth.x.aixgg.com`, issuer `/oidc`, Native `x7lzj58abb1sdp16lkd34`, SPA `5ere2kbu9mugfu3xd8e90`, resource `https://anywork-cybergrid-selfhost.vercel.app/api`, corresponding Grid origin and frontend `https://anywork-tau.vercel.app`. Web matches all five identity/Grid fields and derives the same issuer. The unchanged portal is the existing `/app/` origin. No management resource or credential enters this change.
- Native configuration loading still deserializes a complete replacement into a required-field struct with unknown fields denied, validates issuer/service/origin boundaries and rejects incomplete overrides. Its namespace still hashes all seven serialized fields and the support directory; the installation binding adds the owner subject. The new isolated regression confirms that even with other public fields held constant, switching the Cloud issuer to the self-hosted issuer produces a distinct public installation ID and starts with no restored account.
- Web still selects either the complete default group or the complete explicitly supplied group; it does not fill a partial override from defaults. The official SDK storage test now explicitly exercises the old Cloud issuer against the self-hosted default with the same SPA ID, proving issuer separation even without relying on different actual application IDs. Same-deployment reload and independent cleanup remain covered.
- The entire product diff only changes defaults, corresponding regression assertions and native documentation. RAM-only grant/key ownership, fresh-process signed-out state, explicit local enable, refresh serialization and existing manual-connection settings are unchanged. There is no Cloud grant, public-ID or secret-store migration.
- Documentation distinguishes username-based registration without an email connector from verified email delivery; source/default acceptance does not assert a successful new-issuer login.

## Independent validation

Executed against the reviewed commit before adding this report:

- `CARGO_INCREMENTAL=0 cargo test -p anywork-desktop --lib`: **48 passed, 4 existing external tests ignored**.
- `CARGO_INCREMENTAL=0 cargo test -p anywork-remote`: **6 passed** (2 protocol unit tests and 4 actual encrypted gateway tests).
- `cargo fmt --all -- --check` and `git diff --check d20308f^ d20308f`: passed.
- `npx vitest run --root web src/accountConfig.test.ts src/accountData.test.ts`: **10 passed**.
- `npm run typecheck`, `npm run build:desktop-ui` and `npm run build`: passed; Web retained its existing chunk-size informational warning.
- Actual built desktop UI served on a new ephemeral local port with the existing synthetic bridge: account-entry DOM regression passed, including failure retry, separate official registration/login screens, cancellation race, memory-only notice, account label, reauthentication and safe enable-stage controls.
- `node web/scripts/client-account-check.mjs`: passed at1440/390px, including entry visibility/keyboard/signup-login destination, retained manual connection, account-mode isolation and failed-callback recovery.

All runtime inputs were isolated local fixtures. No private grant, manager configuration, Keychain, root-owned fixture or live cloud resource was read or modified. The temporary reviewer-owned static server was stopped. No actual new-issuer OAuth, account creation, email delivery or cross-device session is claimed by these checks.

## Conclusion

**pass** for this exact client-default change. Merge-time configuration/CSP consistency and real self-hosted identity/device acceptance remain separate orchestrator checks.
