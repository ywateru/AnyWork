# Independent I07a capability projection review

Reviewed exact source: `b374fe31c019d5989b7b9c7f943acf010e173e0b`.

Verdict: **PASS for the additive read-only server module; no blocking findings.** This does not accept full I07, Web activation, native observations, native command execution or I02/I03 delivery integration. No implementation files were modified during this review.

## Source findings and boundaries

- The only new session route authorizes through `app.session` before reading scoped event/queue/configuration sources. The path uses Store cache reads, not session discovery, catalog refresh, history import/synchronization, `ensure_runtime`, composer/model readers or a native RPC. It does not consume runtime-map membership as liveness. Catalog additions preserve all existing legacy fields and meanings.
- Native version/instance/generation, transport reachability and identity observations remain explicitly unknown. A valid descriptor is configuration only. External Codex does not get guessed follower/shared-engine capabilities. Local timestamps expire after five seconds and are not presented as native freshness evidence. There is no purported native observation cache whose stale identity could retain permission.
- All native-dependent actions remain denied. In particular, the existing enqueue/resume/steer command paths can prepare a runtime, so `local_queue.enqueue/resume/steer` correctly use `anywork_then_native` and `allowed_now=false`; this module does not pre-advertise I02's future pure local admission. Pending local edit, pause and eligible local removal use actual local guards; held edit, archive and WorkBuddy child restrictions are reflected. Removal of an uncertain queue row explicitly does not cancel native execution.
- `history.read` is scoped cached reading, including an empty cache, not native history completeness. The actual cache-only poll route exists independently of synchronizing conversation/model paths. Reading one cached event does not prove that every later event decodes; the module documents the limited evidence and propagates a failed cache/queue read instead of fabricating readiness.
- Custom native actions stay unknown despite manifest declarations. Known adapter restrictions, stored busy reasons and per-action ownership remain separate from readiness. WorkBuddy keeps the experimental 5.9.3 policy label even with valid or changed descriptors. An unresolved persisted approval is not enough to establish a current native occurrence.
- New projections omit raw descriptors, private paths, executable/environment fields, cached/queue bodies and credentials. Existing command handlers retain their guards; a projection revision is not command authorization. No Web consumer or delivery journal changed.

## Independent execution

All execution used this isolated worktree's `target/debug/anywork`, temporary private HOME/workspace/data/plugins, ephemeral loopback ports and deterministic fake hosts/plugins. No real account history, installed native app, production server or Web build output was accessed. Fixture servers/children were stopped by cleanup.

| Check | Result |
| --- | --- |
| `cargo build --locked --offline -p anywork` | Passed. |
| `cargo test --locked --offline -p anywork capabilities::tests` | 7 passed, 0 failed. |
| `cargo clippy --locked --offline -p anywork --all-targets -- -D warnings` | Passed. |
| `ANYWORK_BINARY="$PWD/target/debug/anywork" python3 scripts/capability-projection-test.py` | 6 passed. Real HTTP checks complete private-database snapshots, auth/scope, no spawned process/probe/RPC on repeated reads, configuration changes and an existing fake runtime. |
| `ANYWORK_BINARY="$PWD/target/debug/anywork" python3 scripts/plugin-catalog-test.py` | 2 passed; old catalog behavior retained alongside the additive field. |
| Additional independent private HTTP harness | 4 scenarios passed as detailed below; two successful cases on the first run, two after correcting reviewer fixture setup. |
| `cargo fmt --all -- --check`, `git diff --check` | Passed. |

Additional cases used real HTTP and the production Store, not a replacement reducer:

1. Across managed/external Codex, Harness, WorkBuddy, custom/disabled integrations, archive and child sessions, enqueue/resume/steer stayed denied with the correct owner. A real `queue take` moved the item into the editor, changed the projection revision and disabled edit/removal eligibility; restore and local pause worked without any spawn/RPC/probe.
2. Changing the persisted thread, archive flag and status changed binding/advice/revision without producing native readiness. A reread after the prior five-second expiry refreshed local timestamps while retaining unknown native state and unchanged database contents.
3. A structurally malformed first cached Event (`{}`) in a visible session returned an error with no successful action projection. The same corrupt payload outside scope returned 403 before reading it; an unrelated visible session remained readable. No private corrupt payload was copied into diagnostics.
4. Empty cached history remained explicitly locally readable. An uncertain local queue row was removable but neither editable nor steerable; custom model support stayed unknown. The actual cache-only poll route returned the empty event list without database mutation or native contact.

The reviewer's initial negative harness used a nonexistent `/poll` URL and attempted invalid JSON under existing JSON-expression indexes. Those fixture setup errors were corrected to the real `/events/poll` route and valid JSON with an invalid Event structure; the corrected two scenarios passed. They were not product assertion failures.

## Remaining gates

Root merged regression remains required. Real native version/generation/closure observation, positive native `allowed_now`, typed legacy-error migration, common Web consumption and desktop/Pixel controls remain follow-up work. No Linux/Windows native integration or real WorkBuddy write acceptance was exercised or inferred from these controlled tests. No blocker requires an implementation change in this candidate.
