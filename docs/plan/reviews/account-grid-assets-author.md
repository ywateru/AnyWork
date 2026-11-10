# Native configuration GET and hosted Agent images: author evidence

Date: 2026-11-10. Scope: initial public Native coordination configuration request, safe diagnostics, and static Agent image paths. This report does not claim a connection-renewal fix or deployment; those are separate delivery gates.

## Observed causes

Public read-only GETs returned 200 for both Grid health and the Native configuration. All three issuer/clientId/resource fields exactly matched the current public self-hosted binding. This does not prove the cause of the user's earlier request failure, but rules out a permanent mismatch in the configuration observed during this check. Previously the SDK made one configuration GET (35-second timeout) and both transport errors and validation errors collapsed into the same `GRID_CONFIG` diagnostic.

The reported root image URL `/agents/codex-light.png` returned404, while `/app/agents/codex-light.png` returned200, image/png,8353bytes. `AgentIcon` used absolute `/agents/` paths but the website assembler places the Web bundle and its images under `/app/`. Inline vector icons do not require the failing image request.

Native publishes the Logto device index only after configuration validation, resource token, registration and gateway publication succeed. A failed enable therefore leaves the browser without an openable installation; login alone intentionally does not advertise access. The browser polls every20seconds after successful publication.

## Changes

- Initial unauthenticated configuration GET: at most three attempts, eight seconds each,250ms/750ms delays,25-second upper bound. Only transport/timeouts and HTTP408/429/500/502/503/504 retry. Validation/schema/binding and permanent rejected requests fail immediately.
- Fixed `GRID_CONFIG_UNAVAILABLE` diagnostic distinguishes exhausted temporary failures from invalid/mismatched configuration. Underlying errors, URLs, bodies and credentials never cross the diagnostic boundary.
- No retry was added around OAuth, registration, port publication or directory writes. The pinned SDK can fetch configuration again inside registration; this scoped change does not claim to harden that separate step.
- Agent images use Vite `BASE_URL`, matching local `/` and hosted `/app/`. Assembly also publishes the identical bundled bytes at root `/agents/`, so existing public image links and cached older application image URLs work. CSP is unchanged.

## Author checks

| Check | Result |
| --- | --- |
| Native library |51 passed,4 existing external tests ignored |
| New actual SDK/loopback regressions |3 tests, including10 response/binding cases, stalled requests and refused connections |
| Native clippy all targets |passed with warnings denied |
| Agent image rendered/base tests |3 passed, both deployment bases and all bundled Agent images |
| Frontend deployment tests |7 passed; actual image bytes at root and app paths, stale alias removal, exact source offer preserved |
| Web `/app/` build and TypeScript |passed |
| Desktop UI build and rendered bridge regression |passed, including both configuration diagnostics and arbitrary-error redaction |

The rendered UI check uses an owned temporary static HTTP server, synthetic Tauri bridge and headless Chrome. It performs no OAuth, Keychain, user workspace or real cloud-account actions. No installed application, existing service, user grant or deployment was modified by this lane.
