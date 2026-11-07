# Native dsh and WorkBuddy history — independent review

Accepted combined developer tip: `8672aabda888021774415d6fe4322608762de754` (product changes through `8e9268594ef1a5d9bf8db3ebe3791eef0a5b6f46`; final commit updates the existing carrier regression test). The combined branch includes the shared scope helpers and all Harness reader/profile/concurrency follow-ups. Merge this branch once, without also merging the original Harness worktree commits.

No blocking findings remain for [the persisted-history contract](../tasks/shared-agent-history.md). This accepts passive discovery and history reading, not the separately open installed WorkBuddy creation, message delivery and native collaboration acceptance gate. The reviewer changed only this report. Verification used temporary servers, stores, profiles and an out-of-tree Web build. Installed native history was inspected read-only for aggregate counts; no real prompts, native restarts, credentials/account-store reads or native configuration changes were performed. The production service and tunnel were left untouched.

## Contract and source review

- `--agent-scope all` explicitly enables cross-project Codex, dsh and WorkBuddy discovery. Default workspace isolation and the Codex-only meaning of legacy `--codex-scope all` remain intact. Desktop service launch explicitly requests the generic scope. A deleted historical cwd remains readable in all-project history mode; file APIs retain their independent canonical-directory checks.
- Scope means the current OS user and selected native profile, including local rows from previously used accounts. The implementation does not infer an active account from authentication stores. Root/profile selection, native Agent/session identities, titles, cwd, timestamps, archives and root/child separation are retained.
- dsh metadata scans use bounded headers and revision caches; bodies are lazy. Supported on-disk history is the verified current v4 format, including concatenated Zstandard frames. Canonical generation selection rejects unknown or mixed generations rather than choosing older content. A custom live endpoint/discovery does not silently read the default HOME profile without an explicit history-root binding.
- WorkBuddy reads selected columns from its local SQLite catalog in read-only/query-only mode and lazily projects the pinned 5.9.3 JSONL layout through the existing live projection. Hidden quick-ask, deleted and remote rows are excluded. Known project/account-partition roots and ACP aliases are bounded; unsafe IDs, traversal and symbolic-link paths are rejected. Native credential/account stores are not consulted.
- Offline history, saved tool detail and unavailable model/composer metadata do not acquire an execution writer. Source failures retain previously imported data. Torn final data produces an explicit notice; incomplete WorkBuddy snapshots cannot prune old events. Complete native branch reconciliation removes only stale passive events with no pending request identity, preserves live/pending rows, emits `history/reset` and wakes connected clients.
- Passive catalogs skip attached runtime sessions. Native event identities reuse the existing projections; indexed replay lookup preserves source-key precedence and legacy Harness keys. Live refreshes are bounded, both Agent scans run concurrently, and optional live phases cannot keep a passive list request waiting for the old multi-second host timeout.

## Findings closed during verification

1. The old replay lookup performed an expression scan for every imported event. An independent baseline using the real Store implementation took approximately 4.7 seconds to insert 3,000 synthetic events, with each successive 1,000 slower. The replacement uses the existing separate source/Harness indexes, retains earliest-event and source-key precedence, and passes the 6,000-event semantic/performance regression. Actual first-open HTTP measurements below include database hydration, not only parsing.
2. A syntactically valid WorkBuddy resend notice pointing to a missing parent could return an empty branch and silently prune a previously loaded body. The reviewer reproduced this through HTTP. The final reader rejects unresolved branch chains; repeat HTTP verification retained the earlier answer with `history_notice`. Valid replacement branches still replace abandoned passive rows and leave other Agent history unchanged.
3. The previous carrier test expected a cold composer read to fail. The new contract deliberately returns safe unavailable settings without attachment. The updated test asserts the unavailable composer/models responses and unchanged native-get/mutation counts; the complete carrier regression now passes independently.

## Independent verification

| Check | Result |
| --- | --- |
| Exact combined source/status review | clean developer tip `8672aab`; no uncommitted product changes |
| Server Rust suite | 112 passed, 4 explicit native opt-in tests ignored |
| Server Clippy, all targets, warnings denied; workspace formatting | passed |
| Desktop launch-plan regression | passed; includes generic and legacy all-project flags |
| Isolated HTTP history acceptance | passed for both Agents: cross-project/removed cwd, offline bodies, idempotence, tool detail, safe models/composer, malformed/torn data retention, legacy Codex-only scope, restart and generic scope |
| Additional reviewer HTTP branch acceptance | valid replacement removes abandoned passive content, repeated opens are stable, other Agent content is unchanged; unresolved fork retains cached body with notice |
| Fresh out-of-tree Web build and PWA generation | passed; production `web/dist` unchanged |
| Desktop/Android Chrome: shared offline history, existing sidebar Agent filter and Harness rendering | 28 passed; final-tip offline-history subset repeated separately |
| Full deterministic WorkBuddy CDP carrier regression | passed, including existing history/tools/children/models, send/queue/approval/error/detach behavior; native preload remains a substitute fixture |
| Installed WorkBuddy explicit read-only unit | 8 metadata rows, 8 transcript files, 20 turns, 207 normalized events |
| Installed dsh explicit read-only parser aggregate, Harness tip `8487c39` (included unchanged in combined branch) | 46 logs: 22 roots, 24 children; 28,257 durable rows, 14,197 projected events, no incomplete tails |

The reviewer also ran an isolated real HTTP server against the explicit installed native source roots, with temporary HOME/data/plugins, disabled Codex discovery, no live descriptors and no mutation requests. It discovered **22 dsh root sessions and 8 WorkBuddy sessions**, including **4 archived dsh roots**. All 30 root bodies opened successfully, with no history notices and stable event exports after repeated reads. Children were not duplicated in the root catalog. Root bodies produced 10,670 dsh events and 207 WorkBuddy events; the larger parser aggregate above includes child logs too.

Final debug-build measurements on this machine:

| Operation | Observed time |
| --- | --- |
| Actual native catalog list | 61 ms |
| Largest dsh root: 2,777 imported events, first open | 1,536 ms |
| Same dsh root, repeated open | 41 ms |
| Largest WorkBuddy body: 117 imported events, first open | 207 ms |
| Same WorkBuddy body, repeated open | 10 ms |

These are local observations rather than a cross-platform latency guarantee. History size/record limits and version support are documented in [Harness persisted history](../../harness-persisted-history.md) and [WorkBuddy persisted history](../../workbuddy-persisted-history.md). Saved Agent-filter preferences are preserved, so an existing Codex-only filter still requires selecting All Agents or the desired Agent.

Independent artifacts and immutable test binary: `/private/tmp/anywork-history-review-server`, `/private/tmp/anywork-history-independent.py`, `/private/tmp/anywork-shared-history-review-dist`, `/private/tmp/anywork-shared-history-review-browser`, `/private/tmp/anywork-shared-history-review-browser-final`. Browser service used port 3282; HTTP fixtures used ephemeral ports. Root owns the final merged checks and authorized local deployment with explicit generic history scope. No version bump or GitHub release is part of this change.
