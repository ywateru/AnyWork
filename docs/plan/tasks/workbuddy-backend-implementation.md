# WorkBuddy backend implementation notes

Candidate implementation targets the unchanged WorkBuddy Desktop 5.9.3 preload (`__wbInvoke`) through its existing trusted renderer. It uses only fixed native channels and JSON data; no current-conversation subscriptions or global replacement. Reads can touch the shared Conversation pool/LRU and cold history can use native lazy loading, as described in the root integration contract. Polling reconciles native snapshots every 500 ms; it does not promise delivery of every intermediate token.

- Native Rust CDP carrier with private descriptor, loopback/no proxy/no redirect endpoints, browser instance ID, app version/profile/preload checks. Models, list/get/create metadata are projected to whitelists inside the renderer before return.
- Shared-host dispatch keeps Harness and WorkBuddy ownership external. Codex imported refresh is explicitly scoped and invalid batches fail before deletion. Other Agents retain their own workspace scope and lifecycle.
- Native root create/list/requestEntries/model settings/send/cancel and exact pending responses map into existing events. One-time permissions only; unsupported plan/account/payment interactions remain waiting for desktop action. Reconnect invalidates local pending IDs before reporting interruption, never replays a mutation, and binds redelivered requests to a fresh generation.
- Child snapshots become auxiliary, read-only sessions bound to parent/projection references. Native child history/tool details are read through the parent; children cannot start independent engines, submit messages, interrupt, change settings or enable goals. The UI gates their full composer using Agent + auxiliary, with `read_only` composer metadata also provided.
- Attachments preserve exact session references. Embedded images materialize in session-scoped uploads; tool detail reads use the exact native tool call ID.
- Existing local queue owns normal AnyWork queued messages; explicit steer delegates native `queueDelivery: 'steer'`. Unknown deliveries remain uncertain. AnyWork shutdown closes only its CDP connections.

Validation commands:

```sh
cargo test --locked --offline -p anywork
cargo clippy --locked --offline -p anywork --all-targets -- -D warnings
cargo build --locked --offline -p anywork
PLAYWRIGHT_CHANNEL=chrome node scripts/workbuddy-carrier-test.mjs
```

The carrier test launches a private Chromium renderer with deterministic native preload substitute. It exercises the real CDP/Web/API/Store paths and is explicitly **not** installed WorkBuddy runtime acceptance. It uses no external account/model and never touches production services. Chrome and the repository Playwright dependency are required.

Native read acceptance is an explicit opt-in test, never automatic discovery of production profiles:

```sh
ANYWORK_TEST_WORKBUDDY_DESCRIPTOR=/absolute/private/isolated/host.json \
  cargo test --locked --offline -p anywork \
    workbuddy::tests::isolated_native_desktop_read_contract -- --ignored --nocapture
```

Initial evidence: 89 unit tests passed; Clippy and build passed. Actual isolated installed WorkBuddy CDP/version/profile/list/model read contract passed (0 conversations, 3 public model entries; no raw model records or credentials printed). Deterministic real-CDP integration passed before the follow-up tool-detail enhancement; rerun this command for the exact reviewed commit. Actual installed app create/history/send/cancel/approval/image/reconnect acceptance remains a separate independent gate; a fresh signed-out host returning an unexpected create result must not trigger automatic creation retries.


Follow-up review fixes:

- All fixed native calls reject `__wbError` and legacy `errorCode` inside the renderer before public projection or mutation confirmation. Native message/source text is never returned; only a known code and the adapter's fixed operation name cross CDP. The user is directed to inspect desktop initialization/account status without treating every `UNKNOWN` as an authentication error. No mutation retries occur.
- Each pending interaction occurrence has a fresh local nonce, in addition to peer generation and conversation identity. Reusing a native tool/pending ID in a later turn cannot make a previous button valid again.
- Rejected sends invalidate snapshot status deduplication so authoritative native state replaces the optimistic `starting` state without generating synthetic turn events.
- Real-CDP deterministic integration now covers errors for list/get/create/models/send/cancel/approval/model/effort settings, no raw native error secret disclosure, no false turn lifecycle/cancel/approval success, and old permission rejection across consecutive turns on the same peer. Actual installed native write acceptance is still a distinct gate; the isolated fresh profile currently fails native create with `no user id`, and is not retried or worked around with a fabricated account.
