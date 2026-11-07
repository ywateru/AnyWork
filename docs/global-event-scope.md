# Global event visibility and scan cursors

The authenticated global event endpoints multiplex only sessions visible under the running service's current scope. This matches `/sessions` and single-session access: owned sessions stay inside workspace, while external Codex uses `codex_scope` or `agent_scope` and external Harness/WorkBuddy uses `agent_scope`. Archive status does not itself revoke access. Unknown/deleted sessions fail closed. Reusing a database after narrowing from `all` to `workspace` must not expose formerly imported out-of-scope payloads.

## Bounded scan contract

`GET /api/events/poll?after=N` scans at most 500 global rows and returns `{events,cursor,has_more}`. `cursor` is the highest **scanned** sequence, even when no event in that page is visible. `has_more` reports another stored row beyond that scan, independently of visible count. Clients drain while true, using the returned cursor. Omitting after establishes the current global watermark without replay. Negative/malformed cursors are rejected. Cursor values do not identify or reveal hidden session payloads; they are global monotonic sequence numbers.

Filtering resolves current session metadata before parsing each event body. The Store scan propagates database and visible-data decoding errors, rather than masking them as an empty page. Missing session rows are skipped while advancing. Existing foreign keys normally prevent such orphan rows; fail-closed scanning also handles old/corrupt fixtures. Malformed hidden event bodies need not be parsed. Invalid session metadata fails the scan, because its visibility cannot be established.

`GET /api/events?after=N` performs the same scan for SSE. Visible events retain the existing id/data shape. When hidden rows advance beyond the last visible event, the server emits a named `cursor` frame with an id and **no data field**, then continues scanning or waits. This cannot become a fake AgentEvent in older fetch-based clients, which dispatch only data frames. Updated clients ignore named extension frames. Reconnecting old clients may re-scan a hidden tail, but cannot receive its payload. Per-session event endpoints retain their separate scope checks and format.

## Web polling compatibility

The Web client consumes nonnegative safe-integer response cursors, never regresses below an already processed event, and uses `has_more` even when the events array is empty. When connecting to an older server without cursor/has_more, it retains the existing last-event sequence and 500-event draining behavior. A has_more page that makes no progress fails explicitly rather than looping. Visible events already below the processed cursor are not dispatched again.

## Verification

- `cargo test --locked -p anywork`: bounded scanned pages, hidden corrupt payloads, archive visibility, orphan rows and visible-data failures, plus existing global ordering tests.
- `python3 scripts/event-scope-test.py`: isolated actual Rust HTTP service and SQLite fixture, all→workspace restart, all three native Agent scopes, legacy codex-only all, owned/unknown/relative paths, a full hidden 500-row page and its continuation, SSE data-free checkpoints, auth and invalid cursors. No native engine/account is used.
- `npm test -w web -- apiCursor.test.ts`: scanned cursor draining, legacy fallback, regression/no-progress protection, cursor validation and named SSE extension isolation.

The server's `ANYWORK_BINARY` can point the HTTP test at the exact isolated candidate. Root registration in the full check pipeline is tracked separately from this module contract.
