# I01 global-event scope independent review

- Reviewed candidate: `cda8452eeb9e2f92dc11c8778122710d6aed783a`.
- Review date: 2026-11-07.
- Contract: [G0 global event cursors](../tasks/improvement-g0.md#global-event-cursors), [global-event visibility](../../global-event-scope.md).
- Reviewer did not develop this candidate and did not modify product implementation. All service instances, SQLite fixtures, ports, binary output and Vite cache were isolated to the review worktree or temporary directories. No production service, native engine, account or release was accessed.

## Findings

No blocking findings.

**P3 / non-blocking — reconnects can repeat the already-scanned hidden tail.** `Api.streamPath` retains the scanned polling cursor only for the lifetime of that invocation (`web/src/api.ts:93`); `SessionHistoryCache.connect` persists only delivered event sequences (`web/src/sessionHistory.ts:239`). Named SSE cursor frames intentionally do not become AgentEvents (`web/src/api.ts:154`). Consequently, after disconnection, a current client can rescan hidden rows after the last visible event, just as a legacy client can. This does not expose hidden data, skip a later visible message, cause a backward event callback, or prevent the bounded-page drain. The 1.5-second reconnect delay also prevents an immediate reconnect spin. The module document currently calls out this rescan only for old clients; clarify that it also applies to current reconnects, or consider a separate cursor-progress callback as a later performance improvement. This is not an I01 delivery blocker because the requested bounded scan and within-stream cursor guarantees hold.

## Implementation and integration assessment

| Boundary | Evidence and assessment |
| --- | --- |
| Authenticated routes → scope | `/api/events` and `/api/events/poll` are inside the authenticated API router (`crates/server/src/main.rs:399`). Both use `scoped_event_page` (`crates/server/src/api.rs:784`), which applies the same current metadata predicate as the session list. Owned sessions remain workspace-bound; external Codex honors Codex/all-Agent settings; external dsh and WorkBuddy honor the all-Agent setting. |
| Current session metadata → Store scan | `Store.scoped_events` joins events to current session rows before decoding visible payloads (`crates/server/src/store.rs:784`). Orphan rows advance without disclosure, hidden malformed payloads are skipped, visible corruption/database errors fail closed, and returned event sequence comes from the database row. Archive status does not widen or revoke scope. |
| Bounded scan → polling response | At most 500 event rows are processed per HTTP page, with one lookahead row for `has_more`. Cursor advances across hidden rows; no-after establishes the current watermark without replay. Negative/malformed global cursors fail. A full hidden page can return zero events and still allow continuation. |
| Scan → SSE | SSE emits visible events only, then a named `cursor` frame without any `data` field when the scanned cursor is beyond visible data (`crates/server/src/api.rs:828`). After a drained page it waits for notification or the 15-second timer; pending notification is registered before scanning. Default SSE starts at the existing watermark. |
| Poll/SSE → actual Web transport | An independent temporary Node harness compiled the candidate `web/src/api.ts` with the installed esbuild, then used the actual `Api` class against the candidate Rust HTTP service. For polling, only the hostname routing selector was mapped to the isolated loopback service; authentication, fetch, JSON responses and scan logic were real. It observed `after=0 → after=500` across a hidden page, then exactly the five allowed fixture-session events. Direct SSE delivered the same five allowed events and no fake checkpoint event. |
| Web cursor → cache lifecycle | Cursor tests cover hidden-page continuation, safe-integer validation, non-regression, duplicate suppression, legacy response fallback and no-progress rejection. Existing session-cache lifecycle tests confirm reconnect resumes from the last delivered global sequence while retaining history. The reconnect rescan limitation is recorded above. |

## Actual verification

All commands ran from `.worktrees/improve-event-scope` on the exact candidate. Installed dependencies were read through the existing node_modules link; Vite cache was redirected to this worktree and removed after verification. No running-service assets were built or overwritten.

| Verification | Actual result |
| --- | --- |
| `CARGO_TARGET_DIR="$PWD/target" cargo test --locked --offline -p anywork` | **118 passed, 4 ignored**, no failures. Ignored tests are explicit native/history acceptance and were not enabled. Includes Store bounded-page/order, hidden corrupt payload, orphan-row and failure-closed coverage. |
| `CARGO_TARGET_DIR="$PWD/target" cargo build --locked --offline -p anywork` | Passed; candidate binary produced in this worktree. |
| `ANYWORK_BINARY="$PWD/target/debug/anywork" python3 scripts/event-scope-test.py` | **4 passed** against the actual Rust HTTP server. Covers all→workspace restart, three Agents, 501 consecutive hidden rows, owned/unknown/relative paths, archived visibility, cursor/watermark/has_more, auth and invalid cursors, visible SSE data and data-free checkpoints. |
| Vitest with isolated cache, `apiCursor.test.ts` and `sessionHistory.test.ts` | **24 passed**, including 8 cursor transport cases. Legacy polling keeps its 500-event fallback; `has_more` without progress fails rather than looping. |
| `tsc --project web/tsconfig.json --noEmit` | Passed. |
| Independent real Web Api → Rust polling + SSE probe | Passed for both transports; zero hidden payloads or checkpoint AgentEvents. Probe lived in `/private/tmp/anywork-i01-independent-review.py`, with its Node harness and isolated server removed after execution. |
| Independent no-after SSE watermark probe | Passed. Opened authenticated SSE with no `after`, inserted one new visible fixture event and issued an owned-session title PATCH to wake the stream; its first data frame was that new event, without historical replay. No engine was started. Probe: `/private/tmp/anywork-i01-default-sse-review.py`. |

The temporary probes supplement the committed regression suite and are evidence from this review, not maintained repository test coverage. Full merged-system/browser/release acceptance is outside this isolated candidate review and remains the root integrator's responsibility.

## Conclusion

**PASS** for I01 at `cda8452eeb9e2f92dc11c8778122710d6aed783a`, with one non-blocking reconnect-performance/documentation observation. The candidate meets the current visibility, bounded scan, cursor-continuation, old-reader safety and legacy-polling contracts. This verdict does not mark G0 or the broader improvement goal complete.
