# Self-hosted CyberGrid deployment evidence

Author/operator evidence, observed **2026-11-10 00:44–00:46 Asia/Shanghai** (UTC 2026-11-09 16:44–16:46). This report covers the coordinator deployment and read-only infrastructure checks. Independent product/recovery review is in `account-selfhost-materialize-01.md`; Native/Web encrypted business acceptance is a separate gate.

## Deployed identity

| Field | Verified value |
| --- | --- |
| Alias | `https://anywork-cybergrid-selfhost.vercel.app` |
| Vercel project | `anywork-cybergrid-selfhost` / `prj_QEkGqB1XuC8AbtRGZaNSsMD1otvX` |
| Deployment | `dpl_29SDBhEjHTkMmXw13KmS1aXNpFpb`, `READY`, production target |
| Operation | `5ff54297-9f30-41b7-a931-c14738e483a9` |
| Fixed upstream | `2bd6729c6bbee90ed2926410caca883a0a100890` |
| Adapted CyberGrid source | `c923cc232e74e4aff78fa3c82916ce9fb9a283b5` |
| Patch SHA256 | `1b569fa296150cbcc0e6a3e02dcc2b5ce2e2d991215d8655282a381ec6ef5137` |
| Uploaded artifact SHA256 | `aa53c54c1306560a12bdb7c35f2a71e91c31aff42474647f1cbe7fd3edb5cd10` |
| Node runtime | Project `22.x`, function `nodejs22.x` |
| Dedicated Redis namespace | `anywork:selfhost:v1` |
| Final upload helper revision | AnyWork `7220ed17f14536422457713029df717b99c5a2fe` |

Provider deployment detail matched project, production target and all operation/source/upstream/patch/artifact/configuration metadata. The provider alias API points to the same deployment. CyberGrid source identity is independent of the AnyWork Native/Web product source `75726758a4c9ffd7e7da4fb45e115bba92803650`; later upload-helper changes do not change that product build.

The fixed base plus tracked patch/provenance in `integrations/cybergrid` reproduces the adapted tree. No upstream push or license change occurred. The original CyberGrid license and notice bytes remain in the source offer and function artifact.

## Build and recovery

The pinned Vercel CLI is **50.28.0**. `vercel pull` and `vercel build --prod` ran in a private isolated exact-source clone. The root working tree's `web/dist` and running user services were not changed. Upload staging contains only `.vercel/project.json` (project/org binding only) and checked `.vercel/output`; no checkout, `.env`, provider auth, management state or builder diagnostics were uploaded.

The builder emitted 48 `filePathMap` references to tracked notice/license/public files. A private portable staging copy materialized each exact Git blob at its original function target, retained file modes, and removed the map. The receipt binds every source blob, target path, SHA256 and before/after function-config hash. The final artifact passed known bootstrap, management-token, Upstash and Vercel credential byte scans with **zero matches**. Runtime Upstash credentials are injected separately as encrypted environment variables.

The real pinned CLI client, with network transports blocked and a synthetic token, reproduced the old artifact's missing-reference failure. It then hashed the portable artifact successfully (**792 file-list entries**, zero network attempts), and the iterator stopped at `hashes-calculated` before entering upload. Author checks: 5 materialization, 9 prebuilt and 20 deployment tests passed; independent review reran these and checked all 48 blob/mode mappings and unchanged nonmapped files.

Two preceding intents remain unchanged:

- `473b8b93-6a4e-432e-b9f0-abb6dff437ac`: first CLI failure, no retained diagnostic; original cause remains unknown. Multiple complete inventories found no deployment. Project Node26 was deliberately corrected to22; this is not claimed to prove the first cause.
- `a808bfce-c797-4642-b950-49bcac43fb58`: retained private diagnostic explicitly reports missing `server/notices/manifest.json`. CLI source locates this failure in local prebuilt hashing before deployment upload. Complete author and independent inventories found no deployment; both old states remained byte-identical during independent review.

After independent source/artifact/receipt/state review and explicit operator GO, a separate deployment-only state used the single stable final operation above. It saved a durable intent before mutation and received a reconciled READY deployment. The old states and per-operation diagnostics were preserved; no generalized automatic retry or overwritten unknown intent was introduced.

## Live read-only checks

All requests below use the exact alias above. **The API prefix is `/api/v1`**; `/console/auth/config` without that prefix is a static404 and is not the configuration API.

| Request/check | Observed result |
| --- | --- |
| `GET /healthz` | 200, `ok`, no-store |
| `GET /api/v1/auth/config?appId=<Native ID from selfhost-public.json>` | 200; exact self-hosted issuer/resource/Native client; `memory-v1` |
| `GET /api/v1/console/auth/config` without query or special headers | 200; exact self-hosted issuer/resource/SPA client; same coordinator epoch |
| Native config with SPA ID | 400 |
| Native config with unknown application ID | 404 |
| Console config with official frontend Origin | 200, exact `Access-Control-Allow-Origin` |
| Console config with `http://localhost:5173` / `http://127.0.0.1:4173` Origin | 200, exact corresponding ACAO |
| Console config with untrusted Origin | 403, no ACAO |
| Approved console exchange OPTIONS preflight | 204, exact ACAO |
| Runtime production environment | 10 variables, all encrypted; zero `LOGTO_MANAGEMENT_*` variables |
| Upstash exact namespace metadata | Read-only Lua returned boolean1 for public epoch equality and initialized marker |
| `/`, `/console/`, `/console/callback/`, `/docs/`, `/admin/`, `/console/console.css` | 200, no-store; HTML/CSS CSP pins self-hosted issuer |

The public config handler awaits the real Redis store. The separate Upstash check returned only a boolean, never the seed or user content; it accessed only the dedicated self-host namespace. No Redis reset, global key inventory or Cloud Development namespace read was performed.

The pinned public application directory contains only the reviewed AnyWork SPA and Native IDs/types. There is no runtime Management M2M or management HTTP dependency. The user-supplied all-scope M2M remains provisioning-only in the repository-external bootstrap state.

## Evidence and limits

Private evidence is stored under `~/.config/anywork-cloud` with0600 permissions: `selfhost-grid-live-proof.json`, `coordinator-materialized-state.json`, two earlier preserved states, independent inventory snapshots, per-operation CLI diagnostics and the materialization receipt. They are not source/upload artifacts. Public config and synthetic login credentials remain separate files so GUI tests do not load bootstrap state.

This infrastructure proof performs no user OAuth exchange, device registration, tunnel business request or physical mobile test. It does not substitute management JWTs for user resource JWT evidence. Self-hosted Logto currently supports username sign-up and login with a user-entered credential; no email connector was added and no email delivery is claimed. The Native/Web business chain and homepage rollout remain gated by their own acceptance; this coordinator deployment did not publish the AnyWork homepage or update installed user services.
