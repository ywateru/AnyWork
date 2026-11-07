# dsh and WorkBuddy history parity

User request: list dsh and WorkBuddy historical sessions in the sidebar like Codex, including existing native histories rather than only newly created AnyWork sessions.

## Required behavior

- Discover the current user's existing native dsh and WorkBuddy history passively, even if no shared execution endpoint is available. Confirm actual storage formats from pinned source or shipped-artifact evidence; use native read-only catalog interfaces where available and verified file readers otherwise. Never start a second engine or modify an installed application's data.
- Preserve stable native Agent/session identities, real titles, directories and timestamps, archive state and parent/child distinction. Root history appears in the same sidebar, with existing Agent icons/filter/search/directory ordering. Native children remain associated with their parents rather than duplicated as root chats.
- List and open persisted conversation history while the host is closed/disconnected. A disconnected host disables execution controls with actionable reconnection information; it must not prevent reading valid history. When live host access returns, reuse the same session and reconcile without duplicate events, lost history, fake running state or replayed commands.
- Keep the existing explicit directory boundary. Introduce a backwards-compatible generic Agent history scope for all-project discovery; preserve legacy Codex-only scope behavior. The desktop's all-project history mode and this user's local service should explicitly enable all-Agent history. Validate file operations against the selected session root, never history-supplied arbitrary paths.
- Scan only known native catalog roots or explicitly configured test roots; no recursive whole-HOME scanning. Use read-only DB/file access, handle concurrent writes/truncated tails safely, reject symlink/path traversal outside verified roots and avoid credentials/account databases. A failed/partial source retains previously imported records and cannot delete another Agent's data. Missing native history is a valid absence, not a fabricated session.
- Bound discovery time and avoid full-history parsing on every list refresh. Read conversation bodies lazily. Import idempotently with stable source identities; preserve shared-host pending interactions and live runtime ownership. Reports must distinguish actual installed-history observation from isolated fixture coverage.

```text
known native catalogs ── passive scan ── normalized sessions
                                             │
shared host live list ── same native IDs ──────┤
                                             v
                              Store → sidebar Agent filters
                                             │ open
                         persisted body / shared live history
```

## Delivery ownership

WorkBuddy developer owns WorkBuddy storage reader plus shared catalog/history/scope integration and desktop launch scope changes. Harness developer owns dsh persisted readers and Harness sync changes; coordinate interfaces before editing shared files. Independent verifier reviews committed changes separately. Root owns docs, merges, merged tests and authorized local service deployment. Tests use isolated stores/hosts; production history may be inspected read-only for aggregate acceptance, but no native prompts, application restarts or data writes are permitted. No version bump or GitHub publication is part of this request.
