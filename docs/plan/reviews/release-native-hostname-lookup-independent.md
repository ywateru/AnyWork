# Native hostname lookup and Intel Checks — independent review

Task: [release-native-hostname-lookup](../tasks/release-native-hostname-lookup.md).

Accepted exact author commits:

- Native test fixture: `4036185610fa460067c53ee12382c47b060b892f`, based on v0.1.23 source `c36b87632b459db0249c8edf703abc4b31f1863b`.
- Intel pre-tag Checks: `3afcae110bbffdd6d0858193c2386e31946d4b7b`, based on the same source.

Both commits were cherry-picked onto task-doc baseline `bf0643b` in the independent review worktree. The combined Native source tree is identical to the Native author's exact commit, and `ci.yml` is identical to the CI author's exact commit. Review verdict: **PASS**, with no blocking finding.

## Failure evidence and cause limits

The v0.1.23 exact-source Checks succeeded, but formal release run `42883321694`, Intel job `130065151572`, failed: server 193 passed; Native 41 passed, four failed and two existing ignored. Three failures directly printed `stage=starting`, zero info requests and no stderr/startup/bind error. The owned-retry failure printed only the service-verification error and did not directly expose its stage. The deliberate startup/bind error test passed. The log is `/tmp/anywork-release-023-intel-job.log`. No Release was published, and this correction does not move or retry the immutable tag.

Static inspection confirms that Python `HTTPServer.server_bind` performs the real TCP bind and then calls `socket.getfqdn`, which uses `gethostbyaddr`. Constructor activation/listening occurs only after that method returns. The fixture records `starting` before construction and `ready` afterward. This is an unnecessary synchronous resolver dependency within the observed silent-start interval.

The deterministic control proves the mechanism using the unmodified standard `ThreadingHTTPServer`: an observed real kernel bind precedes entry to an event-controlled resolver, construction remains incomplete until explicit release, then the constructor finishes. Cleanup releases and joins the thread and closes the socket in `finally`; the isolated process has an outer five-second limit and kill-on-drop protection. It performs no real DNS lookup or fixed startup sleep.

**The remote Intel Python stack/resolver state was not captured.** The control proves a mechanism consistent with the diagnostics, not that DNS was the unique actual cause of those remote failures. The existing ephemeral-port reservation-to-bind window also remains unchanged and observable through bind-error diagnostics.

## Native scope and contract

The correction changes only Unix test helpers and their author report. Production account admission, manager/process/HTTP verification, browser handoff and deadlines are unchanged. The original IPC test is unchanged.

`FixtureServer` remains a `ThreadingHTTPServer`. Its sole override calls `TCPServer.server_bind`, preserving real socket binding and reuse behavior, then supplies a fixed synthetic `server_name` and the actual bound `server_port`. Activation, threading and the HTTP request lifecycle remain inherited. The fixture has no use for a resolved FQDN.

The actual child positive control replaces `getfqdn` with a function that raises if called. It still executes the PATH-shadow check, authenticated info request, missing/wrong/selected Bearer cases, exact owned PID termination and closed-port assertion. Therefore a regression to the old resolver-dependent binding method fails the real child path. Existing startup/bind error classifications, unauthorized external-service preservation, generated-token retention, no-ticket preparation, unchanged 30-second startup failure and explicit retry remain tested. The owned-retry failure assertion now adds safe startup-stage diagnostics without weakening its result.

## Intel pre-tag gate

Structured YAML comparison independently confirms that the new unconditional `macos-native` job matches the release Intel runner `macos-15-intel`, deployment target `14.0`, Node 22, stable Rust and 60-minute job deadline. Prerequisites run in the same order: `npm ci`, production Web build, desktop UI build, then the identical locked release-profile build and test commands for `anywork` and `anywork-desktop`. It uses the runner's Python as release does, with no interpreter override.

All prior Checks jobs and top-level settings are unchanged; `release.yml` has no diff. The new job/steps have no condition or continue-on-error. The existing exact-source gate requires the trusted aggregate Checks run to finish successfully, so failure of this unconditional Intel job cannot authorize tag creation. Existing release tests and installer/DMG verification remain in place. Cache reuse does not skip either build or tests and is not itself acceptance evidence.

Actual execution of this new Intel job remains a fresh exact-source CI requirement. This review did not dispatch or mutate CI.

## Independent verification

- Complete Native library on the final fixture source: **46 passed, zero failed, two existing ignored**, 30.65 seconds. This includes the new standard-library resolver control, the forbidden-DNS real child, original IPC preparation, external-service preservation and the full 30-second failure/explicit-retry path.
- Native Clippy including tests with `-D warnings`: **passed**. A read-only `TAURI_CONFIG` reference to the existing root UI distribution satisfied the binary test target; no UI build/output was changed.
- Structured workflow comparison using Ruby's YAML parser: **passed**, including unchanged previous jobs/release and Intel build/test parity.
- Offline release authorization regression suite: **10/10 passed**; version/signature boundary suite: **3/3 passed**.
- Formatting, diff checks and exact author-tree comparisons: **passed**.

Native logs: `/tmp/anywork-native-hostname-review-tests.log` and `/tmp/anywork-native-hostname-review-clippy.log`. The author separately reports complete release-profile Native tests passing 46 cases with two existing ignores; the independent Native execution above used the debug profile on ARM macOS. Neither is presented as an Intel CI result.

No installed application, existing service, real account, remote access, user workspace or business content was touched. The reviewer used a separate Cargo cache and disposable fixture processes. Root must still integrate both accepted commits and pass complete exact-source Checks, including the new Intel job, followed by all release and publication gates on a fresh immutable candidate.
