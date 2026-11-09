# Independent CyberGrid pinned-directory review

- Reviewer: independent `verify_desktop`, 2026-11-09, macOS arm64 / Node 22.16.
- Accepted exact candidate: **c923cc232e74e4aff78fa3c82916ce9fb9a283b5**.
- Upstream base: **2bd6729c6bbee90ed2926410caca883a0a100890**.
- Repository: `/Users/water/work/2026/any-work/.worktrees/cybergrid-public-directory`.
- Verdict: **PASS for the minimal public-directory patch**. No blocking finding. One non-blocking preexisting lifecycle boundary is recorded below. This is source/isolated-runtime acceptance, not a deployment or real self-hosted OAuth acceptance.

## Findings

**P3, non-blocking — SPA replacement does not revoke previously issued console sessions.** The new operational guidance at `docs/pinned-application-directory.md:21` accurately promises rejection of removed Native device sessions, but its instruction to reauthorize after SPA replacement must not be read as automatic revocation of all previous sessions. Existing `server/src/service.ts:48-50` stores console sessions with `appId: null`; line 65 rechecks directory eligibility only for device sessions. An independent real-HTTP test replaced both the SPA declaration and browser client ID while retaining the same store, then observed the old console session still accessing `/console/apps` with status 200. This behavior predates the patch, console purpose restrictions remain in force, and the task explicitly preserves service/SDK behavior. It therefore does not block this candidate. Operational documentation should retain the Native-specific wording and avoid claiming that a pin change automatically revokes every session. If immediate console revocation is needed, it requires the existing explicit revoke/expiry lifecycle or a separately designed protocol change.

No P1/P2 finding or other blocking contract mismatch was found.

## Configuration and security inspection

Reviewed all seven changed files and the unchanged interfaces they connect to: `ApplicationDirectory`, dynamic Logto directory, identity verification, deployment configuration, service dispatch, CORS, and Redis adapter.

`server/src/application-directory-config.ts:33-47` accepts only exact modes. Unset mode and explicit `management` retain the previous complete-M2M requirement and reject pinned JSON. Exact `pinned` requires JSON and browser ID, rejects either Management variable whenever present (including empty values), and never constructs a `LogtoDirectory` fallback. Missing, mixed, invalid and unsupported configuration returns the fixed `DirectoryConfigurationError` without retaining the original parse error/configuration body.

The schema at lines 13-27 bounds the UTF-8 source to 32768 bytes and the list to 2–32 applications. Each declaration must have exactly the four public fields, a unique bounded ID without whitespace/control bytes, a bounded nonblank name, exact SPA/Native type and boolean false Device Flow. It requires exactly one SPA matching the configured browser client and at least one Native. M2M, extra fields, duplicate IDs, incomplete records and enabled Device Flow are rejected. Construction copies declarations into new records; each `list()` call returns new copies. Request parameters, Account API customData and later changes to the source environment cannot alter the directory.

`server/src/config.ts:11` selects and validates the directory before Redis adapter/store construction at line 19. The configured identity is still `LogtoIdentity`, with its fixed HTTPS issuer/resource, ES384-only signature verification, client binding, user-token restriction and connect scope. No acceptance of unsigned or client-credentials identities, runtime management secret, new credential persistence, SDK fallback, CORS relaxation or business-data storage was added. The existing dynamic mode still has management capability by design; a self-hosted deployment must explicitly select pinned and remove both management variables.

The unchanged service validates the declared Native application at initial exchange and again on subsequent device requests. Removing a Native pin and deploying a replacement directory rejects old device sessions even if their store entries remain; explicit deletion/revoke remains usable. `docs/pinned-application-directory.md:21-23` clearly states the authoritative boundary: pins are trusted deployment declarations, do not synchronize Logto changes, and deleting an app only in Logto does not immediately revoke already-issued coordination sessions. Administrator-maintained application type/Device Flow metadata is part of that trust assumption. The last Native cannot be removed while preserving a valid running configuration; the documented operation is to stop that deployment.

## Independent checks and results

Used a minimal sanitized child environment for test/build commands; no `.env`, real grant or deployment secret was read. Executed:

```sh
npm --prefix server test
npm --prefix server run typecheck
npm --prefix server run build
git diff --check
```

Results: **85 passed, 0 failed, 7 skipped**, 92 server tests total. The seven skips require an unavailable local redis-server executable; they are not reported as passed. This includes all five new pinned-directory cases: zero-network/defensive-copy behavior, malformed/mixed startup, strict schema, legacy-mode compatibility and signed service identity/purpose/CORS/removal checks. Typecheck and build passed; the build verified static assets without fetching SDK releases.

A reviewer-owned temporary harness at `/tmp/cybergrid-pinned-independent.mts` added **35 successful assertions** through the real Node `serveAPI` adapter on an ephemeral loopback port, the actual `createService` and `LogtoIdentity`, locally generated ES384 keys/tokens, and the real `MemoryStore` with negotiated `memory-v1` registration. It verified:

- Fixed issuer/resource/auth-code configuration and rejection of unknown/SPA targets on the Native config route.
- Rejection of signed wrong issuer/audience/client/scope, expired tokens, client-credentials grants and an HS256 token.
- Actual Native and SPA exchanges, exact owner-scoped discovery for two synthetic users, console/device purpose separation and exact-origin CORS enforcement.
- After a Native pin replacement, existing device access returns 401 `APPLICATION_UNAVAILABLE`, new exchange returns 404, and explicit DELETE returns 200; restoring the old pin does not restore the explicitly revoked session.
- Mutation of the input environment after directory construction does not change the directory; the preexisting SPA-session boundary in the finding above is reproduced rather than inferred.

The harness closes its HTTP listener/store in `finally`. It contains no real tokens or credentials and remains outside the product tree for reproducibility. These extra checks use an explicit MemoryStore fixture, not a runtime storage fallback, and do not prove actual Redis/Upstash or hosted Logto operation.

## Base, patch and protocol provenance

Preserved the supplied provenance directory without modification:

`/var/folders/ll/s836stz50mg85d4h0g4xc8jm0000gn/T/anywork-cybergrid-directory-7orgbj3x/`

Independently verified the patch SHA-256 against PROVENANCE.json:

`1b569fa296150cbcc0e6a3e02dcc2b5ce2e2d991215d8655282a381ec6ef5137`.

Using a temporary external `GIT_INDEX_FILE`, read the exact upstream base, checked and applied the supplied patch into that index, and compared `git write-tree` to the exact candidate tree. Both produced:

`ba2326bfd441c3579d3e8445d0c2f20a214f5bf2`.

No worktree checkout, HEAD change or product edit was used. The complete diff is seven files, 200 insertions/6 deletions. SDK, service, identity, CORS, Redis and crypto source are unchanged from the base. A local object comparison against upstream `50a12e0d7b58e3f8dd84b9d9a97fe650faaac691` also found no changes in the relevant config/directory/identity/service files relative to the selected base. This does not adopt unrelated newer upstream changes.

## Acceptance boundary

No push, deploy, runtime environment update, real self-hosted OAuth, Upstash/Redis request, existing account/session access, native UI or business-data access was performed. This report is external to the repository as requested; no review commit is needed. Product HEAD stayed at the exact accepted candidate and `git status --short` remained empty after all checks. Cloud deployment, configured public pins, actual self-hosted login and license/distribution gates remain the orchestrator's separate acceptance work.
