# Read-only capability projection module (I07a)

Status: source `b374fe31` passed [independent exact-commit review](plan/reviews/improvement-capability-projection.md) at `1bfd268` and is merged; [bounded merged regressions](plan/reviews/improvement-capability-merged.md) passed at `2942baa`. This is the additive server module of the [projection contract](capability-projection.md), not completion of I07, a Web activation, or native writing acceptance. Actual supported versions/topologies remain governed by the [support matrix](support-matrix.md).

## Inputs, outputs and authority

`crates/server/src/capabilities.rs` owns the typed policy reducer and local-read projection. Existing command handlers remain the authority and retain their native identity, version, busy, archive, auxiliary, input and permission checks. No request can present a projection revision to bypass them.

| Entry | Additive response |
| --- | --- |
| Authenticated `GET /api/info` | `capability_projection_v1: true` |
| Authenticated `GET /api/plugins` | Each unchanged legacy entry adds `capability_projection` with version, revision, configuration metadata, unknown installation/transport/identity, local observation metadata and evidence label |
| Authenticated `GET /api/sessions/{id}/capabilities` | Version, revision, session/thread/Agent/topology binding, readiness, observation metadata, support evidence and the 26 named action projections |

Existing `capabilities`, `available`, `setup_hint`, identity and plugin protocol fields remain unchanged. In particular, legacy `available=true` still does not prove installation, native connection, login or writability. The catalog exposes no global `writable=true` claim. Custom commands are considered interpretable configuration when nonempty; their installation remains unknown without executing or looking up the command.

`Support` is `yes`, `no` or `unknown`. Each action includes `allowed_now`, stable `reason_code`, a safe explanation, owner, limitations and policy source. `yes` denotes an implemented adapter/local policy, not successful native execution or a new native-version acceptance claim. `session.create` in a session projection is marked inapplicable (`no`, `session_creation_scope`); creation is a workspace/integration action and is not authorized by this endpoint.

Readiness booleans use JSON `null` for unknown. `transport_reachable` is deliberately distinct from the identity-verified meaning of `reachable` in the support matrix. Cached-read `readable=true` proves only that the scoped local event-cache query succeeded, including an empty cache; it does not prove native history completeness or native control. The native `writable` field is unknown except for the positive archive/WorkBuddy-auxiliary read-only restriction. Missing configuration is not proof that a still-running native process is unwritable.

## Pure reads and conservative native state

The session route calls `app.session` first, including current workspace/Agent scope validation, before touching queue, event or configuration sources. It reads one existing cached event and existing local queue state. It never calls catalog synchronization, history import, shared-host synchronization, `ensure_runtime`, composer/models readers, process creation, transport probing or any native RPC. It does not read the runtime map or use a stored status as liveness evidence.

There is currently no trustworthy runtime observation with a bound native instance, generation and expiry that this module can consume. Consequently:

- `native_version`, `native_instance`, `generation`, native observed/expiry times, transport reachability and identity verification remain `null`; `native_state` is explicitly `unknown`.
- Every native-dependent action has `allowed_now=false`, including when a real fixture runtime Arc already exists. Persisted unresolved approval/question events do not establish a current occurrence/generation and cannot enable responses.
- `CodexManaged` is derived from an AnyWork-owned session mapping. External Codex is `codex_external_unknown`; neither follower nor shared-engine identity is guessed from `external`, a socket path or an Arc. Therefore even follower's pause-only distinction remains unknown here until there is a trustworthy topology observation.
- Harness/WorkBuddy labels identify the applicable built-in adapter policy, not a connected gateway/renderer. Their known unsupported goal/plan/tier/edit/fork operations remain `no`. Unobserved custom plugin operations remain `unknown` despite declared capability strings.
- A stored busy status may explain a denied setting/start action (`stored_busy`); it cannot turn support into permanent `no` or idle into permission. Effort support is evaluated separately but is still denied without native evidence.
- WorkBuddy execution is always labelled `experimental` with its 5.9.3 policy scope. A valid descriptor and changes to its instance do not promote it to verified or accepted. Descriptor/private-path/version/preload/allowlist and auxiliary command protections are unchanged.

The top-level observed/expiry times refer only to the current local read. Their validity interval is 5 seconds; they are never native freshness evidence. Re-read after expiry rather than reusing advice as permission. Revisions hash the typed non-secret binding, readiness, action policy and support evidence, excluding read timestamps. Archive, auxiliary, configuration and relevant queue eligibility changes alter advice/revision. A descriptor instance change that leaves configuration interpretable cannot preserve a claimed native identity, because no such identity is asserted. Connecting trusted observations and their generation/closure/version invalidation is a separate follow-up; this module does not manufacture an observation cache or a journal.

## Queue and state ownership

Cached history, local queue pause and eligible local queue deletion are independent of native reachability. Editing a pending local queue item is available only when the scoped session is not archived/WorkBuddy auxiliary and no local queue editor already holds an item. Native-dependent enqueue/resume/steer remain denied in this projection without current native evidence. Existing command behavior has not been changed by this advisory protocol.

Queue actions disclose `AnyWork queue only; no native queue synchronization`. Removal additionally states that deleting an uncertain local row does not cancel native execution. Native handoff, operation IDs, queue editing idempotency and native queue import are not implemented here. Native goal and history ownership are unchanged; message editing continues to disclose the absence of a cross-client native CAS transaction.

## Errors and compatibility limits

This module is additive: legacy clients ignore new fields and continue through existing handlers. No first-party Web consumer has been switched to it. Native commands may therefore remain usable through legacy clients while this conservative advice denies them; enabling a new consumer requires the separate observation and compatibility work in the main contract.

Projection reads propagate existing `ApiError` behavior for scope, storage and malformed saved-state failures; they do not return fallback ready values or empty-success projections. The broader typed critical-error migration, including removal of substring-based legacy status classification, remains open. Authentication still runs in the existing API middleware. Raw descriptors, executable paths, manifest environment, credentials, account/native objects, cached conversation bodies and queue bodies are absent from the new projection.

## Developer evidence and remaining validation

All checks below ran in the isolated capability worktree on macOS, with a private Cargo target, temporary SQLite/data/home, ephemeral loopback ports and deterministic fake plugins. No real native Agent/account was invoked or read, no production service was contacted, and no shared Web artifacts were built.

- `cargo test --locked --offline -p anywork capabilities::tests`: 7 passing. Covers unsupported versus busy/unknown, external Codex topology uncertainty, offline local actions, archive/auxiliary/queue edit invalidation, approval occurrence uncertainty and secret-free catalog projection.
- `python3 scripts/capability-projection-test.py`: 6 passing. Real Rust HTTP proves auth/scope before projection sources for all three built-ins; repeated catalog/session reads preserve the entire private database and spawn no execution process/contact no fake native host; valid-but-unreachable and incompatible/removed descriptors stay unknown; explicit all scope permits cached reads. A deliberately started fake Codex runtime is present in the last case, but repeated reads make no additional initialization/input/settings calls or process spawns and still report unknown native readiness. Existing stored requests do not enable approvals/questions.
- Existing `scripts/plugin-catalog-test.py` preserves exact old values/auth/availability assertions and extends its exact response-key expectation for the one additive field.
- Isolated server build, Clippy all server targets with warnings denied, Rust formatting, Python compilation and diff checks are required before the candidate commit.

Independent source/HTTP review passed, including four extra actual-HTTP scenarios for queue/editor guards, changed bindings/expiry, corrupt visible versus hidden cached events and uncertain local removal. Root registered the HTTP script and passed merged Rust/API regressions. No UI, real-native writing, fresh native observation, diagnosis, complete typed-error migration, full I07 or I10 acceptance is claimed. Root owns central check registration and status documentation.
