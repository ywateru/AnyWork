# Self-hosted cloud configuration and prebuilt publication — independent review

Date: 2026-11-09. Script candidate: `1f9a1bf3b737a7c8ef3558c8dbd730dfc4f07310`. Additional source artifacts: `883bdd0` and `8ece094d5dcbe62ace85468585d94cbaa95ba541`; cloud scripts are unchanged between the script candidate and that artifact head.

Scope: [current self-hosted task](../tasks/account-client-entry.md), [cloud contract](../../cloud-configuration.md), self-hosted bootstrap, deployment recovery, staging boundaries and source-artifact inclusion. The CyberGrid runtime adaptation has a separate source reviewer; this report does not substitute for its acceptance or for a real deployment.

## Findings

None.

- Self-hosted bootstrap validates an explicit self-hosted mode and separately supplied Management API audience. It does not derive that audience from the custom authentication domain. The supplied management application is used only for bootstrap client credentials with `all`; the source never patches that application, sign-in experience, email connectors or users. Account API fields preserve other existing fields. Owned application/resource/scope/role creation saves an intent before POST, checks the saved identity against inventory and refuses unresolved/ambiguous outcomes instead of submitting another creation.
- Native/SPA callback/CORS and refresh metadata are configured on the owned applications. The resource is separate from Management API, with connect permission and300-second access TTL; the user role is default. Current shared username-based registration is preserved; no email delivery claim follows from these changes.
- Self-hosted coordinator environment contains the explicit public SPA/Native directory and pinned mode. Runtime Management API ID/secret are not copied from bootstrap state. Existing production environment keys outside the exact expected runtime set, including management variables, stop the command before an upsert. The previous Cloud Git-source path remains selected for non-self-hosted state.
- Prebuilt staging is limited to the project binding and checked Vercel output. Symlinks, special/private build files, unsanitized build metadata and known credential bytes are rejected. Accepted source SHA, fixed upstream, patch digest, output digest and private configuration digest become the durable intent/provider metadata. CLI50.28.0 is checked, authentication stays in its existing external store, and captured subprocess output is not echoed.
- Deployment phase is durably marked submitting before the uploader. Unknown CLI outcomes do not restart the upload. Recovery verifies a unique operation match plus project, production target, source and all adaptation/artifact/configuration metadata; missing, conflicting or ambiguous inventory fails closed. Explicit redeployment uses a stable operation UUID and cannot bypass an active or unresolved previous operation.
- The checked-in source adaptation retains its upstream license and fixed-base/patch/tree reproduction instructions. The patch digest matches `PROVENANCE.json`; the local `.gitattributes` exception applies only to the exact patch and preserves its upstream context bytes. The source exporter includes all five artifact files with their exact committed bytes. This metadata/staging validator binds the operator-supplied reviewed artifact; it is not a rebuild or an independent proof that arbitrary generated JavaScript was compiled from that source. The separate adaptation review and checked build must precede the actual upload.

## Independent offline verification

All passed:

| Suite | Result |
| --- | --- |
| Self-hosted configuration contracts | 6 |
| Prebuilt privacy/source binding/CLI/unknown outcome contracts | 6 |
| Existing and self-hosted deployment recovery | 20 |
| Public configuration safety | 9 |
| Frontend configuration/CSP and real temporary CLI | 7 |
| Source export | 6 |
| Publisher/release recovery | 28 |
| Total | **82 passed** |

Also passed: `git diff --check` across the entire script/artifact candidate; exact-revision export of `8ece094d5dcbe62ace85468585d94cbaa95ba541`, with all five `integrations/cybergrid` members compared byte-for-byte to Git; patch/provenance digest comparison; and upstream license equality against the previously pinned vendor copy.

Four distinct known secret values from the permitted private bootstrap state were scanned against the12 changed committed candidate files, with **zero matches**. No values or hashes were printed. This scan concerns known current bootstrap credentials in source, not a generated deployment output that has not yet been staged.

## Independent real read-only configuration check

Used the existing saved management access token from the mode0600 external self-hosted state; no token request, refresh, bootstrap replay or cloud mutation was made. Only GET requests were issued to the pinned self-hosted Management API. All of these comparisons were true:

- Saved SPA/Native IDs and expected application types; exact native callback and registered frontend SPA callback.
- Dedicated self-hosted resource audience, TTL300, connect scope, default User role and role-to-connect association.
- Account API enabled; customData Edit and name/avatar/email ReadOnly.
- Current shared sign-in experience equals the saved preserved snapshot, and username signup remains enabled.

That last comparison verifies the saved preserved snapshot against current service state. The source review separately confirms that this script only GETs sign-in experience; this verifier did not claim a newly captured pre-configuration baseline or rerun the author's synthetic-user creation/default-assignment experiment.

No ordinary user grant, browser state, manager fixture or Keychain was accessed. No PATCH/POST/create/deploy or role assignment occurred in the real readback. Test publisher output is from local mocked providers, not a published release.

## Conclusion

**pass** for the reviewed cloud scripts and source-artifact inclusion. Actual adapted-runtime acceptance, staged-output secret scan, self-hosted OAuth/device/public encrypted session, exact frontend/CSP deployment and final update remain separate delivery checks.
