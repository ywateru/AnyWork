# Native IPC preparation fixture — author evidence

Base: `aed458033f20636447d174a64f5507cc1eaa00f2` (v0.1.22). This correction changes only Unix test fixtures and test-only registration. Production account admission, service launch, identity/token/capability checks, 30-second preparation deadline, explicit retry behavior and external-service ownership are unchanged.

## Diagnosis and limits

The Intel release job `130019822102`, run `42870372544`, failed after 32.88 seconds in the authenticated `desktop_start` preparation assertion. This matches the production manager's 30-second readiness loop plus bounded HTTP work. The old fixture launched `#!/usr/bin/env python3`; the production launch plan prepends several directories to PATH. It discarded child stderr through the normal production output reader, so the job contains neither the interpreter selected by that shebang nor child exit/startup/request evidence. The unmodified exact test passed locally in 0.68 seconds on ARM macOS.

Consequently, **the exact remote v0.1.22 cause is not established**. Neither PATH shadowing nor an ephemeral-port collision is claimed as that job's proven cause. The fixture releases a temporary port before its managed child binds it; this race remains and now has a deterministic bind-failure classification. No longer timeout, automatic business retry, production diagnostic expansion or bypass was introduced to mask it.

## Correction

The fixture preflights Python and its exact standard-library dependencies using isolated mode, reads that successful interpreter's absolute path, then launches it through an explicitly quoted `/bin/sh` wrapper with `exec`. Python runs with `-I -u`; neither the manager's PATH ordering nor Python environment/site customization can select another interpreter. `exec` preserves a single owned child PID and the existing manager termination path.

The disposable child records fixed startup stages, exit classifications and authenticated/unauthenticated info and ticket-request counts atomically in its own temporary directory. Its stderr stays in that same fixture directory; assertion diagnostics expose only fixed markers, bounded counters and presence flags. They never expose a real service's output, headers, tokens or environment. The original IPC test keeps all signed-out/interrupted/reauthorization rejection, account snapshot, owned-service, no-ticket, token preservation and shutdown assertions, and now requires a ready child and successful authenticated info requests.

The helper is behind `cfg(all(test, unix))`; Windows and shipped application behavior do not gain a Python/helper dependency. No files in the installed application, current service, user workspace, real account or cloud configuration were accessed or changed.

## Evidence

- Full Native library suite: **45 passed, two existing ignored**, 30.70 seconds on ARM macOS. The additional duration is an intentional negative test of the unchanged real 30-second startup failure deadline.
- A controlled PATH shadow causes the old `/usr/bin/env python3` resolution to run an impostor and exit 87. The fixed fixture starts under that same shadow without running the impostor, passes real authenticated HTTP verification, and terminates/reaps the owned PID with the port closed afterward.
- Controlled startup error exits 73; a deliberate in-child bind collision exits 74. Both retain their exact fixed stage, exit-code evidence and safe stderr marker; no info or ticket request succeeds.
- A real child returning 401 is rejected by manager preparation with zero authorized info/ticket requests. Manager shutdown preserves this externally owned service and its selected token.
- A real owned child startup failure remains unauthorized and closes. It reaches the existing error state, preserves the generated token, and recovers only after an explicit second preparation command with a corrected fixture. Preparation never mints a browser ticket.
- Native Clippy with tests and `-D warnings` passed. Its binary test target used a read-only `TAURI_CONFIG` pointing to the existing root UI build because this isolated worktree has no generated UI distribution; no UI source/output was changed. Formatting and diff checks passed.
- Release-profile rerun of the exact IPC test was started separately and is pending as of this initial report; its outcome will be reported before cache handoff. Intel acceptance remains a fresh immutable release-CI requirement; local ARM results are not an Intel result.

Logs: `/tmp/anywork-native-ipc-preparation-baseline.log`, `/tmp/anywork-native-ipc-preparation-fixed.log`, `/tmp/anywork-native-ipc-preparation-clippy.log`, `/tmp/anywork-native-ipc-preparation-release.log`.
