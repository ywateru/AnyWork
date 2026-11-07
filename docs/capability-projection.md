# Effective capability and readiness contract (G1 / I07)

Status: implementation boundary under the authorized improvement goal; independent contract review of `fb48eae` found no blocking issues. Not current runtime support or expert/product approval. See the [support matrix](support-matrix.md) for actual accepted Agent/topology/platform limits and [message operations](message-operations.md) for delivery uncertainty.

## Problem and authority

Manifest capabilities are declarations, and existing `/plugins.available` means a configured entry, not liveness/login/writability. They remain useful compatibility metadata but cannot authorize all conversation actions. Current composer/model/edit guards contain important additional checks and must be retained. WorkBuddy's descriptor validation, exact instance/version/preload/allowlist checks and auxiliary read-only restriction remain mandatory; a unified projection cannot turn its experimental native writing into formally accepted support.

The initial delivery adds a versioned additive server projection without activating new UI behavior. Later clients consume it consistently. Introduce no new tenant model, native queue synchronization, login bypass, arbitrary native invocation or unsupported fallback. `capability_projection_v1` is a protocol version, not a native feature claim.

## Two scopes and orthogonal state

Integration catalog projection describes enabled registration, interpretable configuration, known installation information and setup reasons. It does not return a global `writable=true` for all sessions. Keep legacy `available` documented with its old configured-entry meaning; new clients must not use it as a readiness proof.

Session projection is authenticated and follows current session/workspace/Agent scope. Bind it to Agent, topology, native version/instance when known, thread/session, auxiliary/archive state and the observation generation. Return a revision, observed time/expiry, source and explicit stale/unknown state. Never expose socket paths, descriptors, account identities, credentials or native/provider raw objects as diagnostics.

Readiness fields are orthogonal: enabled, configured, transport reachable, identity verified, readable and writable may each be true, false or unknown. Use an explicitly named `transport_reachable` field for raw transport evidence; the support matrix's broader `reachable` definition includes identity verification and is not interchangeable with it. A disconnected host can have readable persisted history; a registered plugin can have unknown login and unreachable execution. Experimental/support-evidence labels are separate from runtime readiness and include their version/topology scope. Becoming reachable never upgrades an experimental adapter's acceptance level.

## Per-action projection

For each applicable action return a typed `supported: yes | no | unknown`, `allowed_now: boolean`, stable `reason_code`, safe explanation, owner, limitations and evidence source. `supported=yes` means known implemented support for the bound topology, not guaranteed success; `allowed_now` reflects current observed prerequisites. Busy/archive/disconnect is distinct from permanent unsupported. Unknown or stale support/readiness must not silently become permission in the new client. Projection is advice, never command authorization: command handlers recheck actual policy/state under the existing gates.

Minimum action inventory for the complete I07 integration:

| Family | Actions and owner distinction |
| --- | --- |
| Session/history | history.read, session.create/connect/fork; cached read differs from native control |
| Input/control | message.start/steer, interrupt; execution belongs to native, submission identity to AnyWork |
| Native requests | approvals.respond, questions.respond; only actual unresolved occurrence/turn |
| Settings | model.set, effort.set, tier.set, plan.set; distinguish supported-but-busy from unavailable |
| Goal | get/create/edit/pause/resume/clear separately; native owner, no GET→all-writes inference |
| User edit | message.edit with actual thread/history constraints and no-native-CAS limitation |
| Local queue | enqueue/edit/pause/resume/delete/steer; AnyWork owner, not desktop native queue synchronization |

The additive server module may initially expose catalog/session actions whose policy it can prove, leaving other actions explicitly unknown. It must not invent supported actions to fill this table. Full I07 is not accepted until all first-party command/UI consumers share the completed contract.

## Observation and side effects

Reading capabilities must not create/resume/rebuild a native thread, instantiate an execution process, send prompts, change model/goal/policy or invoke a mutating probe. Derive the initial projection from known adapter policy, configuration metadata, persisted history and already-existing trusted runtime observations. Checking descriptor structure is only configuration evidence; runtime-map membership alone is not a live-connection proof.

Authorize the session with `app.session` before reading its projection sources. Do not call the catalog sync/import paths, `api::sessions`, shared-host synchronization or persisted-history import merely to answer this endpoint: those paths can write local state. Session status and an Arc in the runtime map cannot manufacture a fresh native observation; without trusted instance/generation/time evidence keep relevant readiness unknown. Do not infer Codex follower topology from `external` alone. Evaluate offline history/local queue actions separately from native writability, and approvals/questions require a current unresolved occurrence plus trustworthy generation evidence rather than a manifest alone.

Explicit diagnosis/connect is a distinct user action. It may perform only documented bounded read-only handshakes for that diagnostic mode; actual native creation/control remains a separate command with its own capability and operation semantics. Do not disguise the current side-effecting composer/models cold-runtime path as pure diagnosis. Existing creation/resume behavior is not changed merely by adding this read-only endpoint.

Cache observations by exact native instance/version/topology/thread identity. Connection closure, identity/version change and relevant native/session changes invalidate applicable fields. Missing, failed or expired evidence is unknown/unavailable rather than a fallback `true`. Safe read-only history evidence may remain useful after control disconnect. Existing native command guards still arbitrate races after projection; clients cannot present a revision to bypass them.

## Typed critical errors

Preserve the legacy `{error: string}` envelope and add controlled `code`, HTTP status, recovery actions, delivery disposition, correlation ID and optional operation ID. Keep I04's explicit 428/409/503 and the `/connect` history-only compatibility response while adding typed reasons. Do not classify new errors by English/Chinese substring matching, strip native envelopes into arbitrary text or return private native details.

Required initial categories include unsupported operation, not configured, host unreachable, authentication required, incompatible protocol, unavailable/ambiguous owner, history only, busy, archived, read-only child, state conflict, storage unavailable, delivery unknown and invalid request. Map only native codes whose meaning is controlled by the adapter. An unclassified transport failure after dispatch is unknown, not proof of rejection. Language changes must not change status/code/disposition.

`delivery_state` distinguishes not sent, accepted, unknown and not applicable. A generic retry hint never authorizes another message; I02's stable-ID/state rules remain authoritative. Recovery actions must distinguish checking status, connecting/configuring, explicitly resuming known-undispatched work and asking the user to inspect native state. Unknown delivery has no automatic resend action. Preserve narrow existing guards such as owned Codex's verified missing-empty-rollout fallback; do not broaden them to arbitrary not-found text.

The first error module can cover explicit typed boundaries incrementally. It must not translate every old anyhow error into a guessed category or silently change all 400 responses to retryable 500. Document unmigrated legacy paths and their limits.

## Web and state ownership follow-up

Use one consumer for new-session setup, primary/child composers, model/settings, add menu, goal banner and edit eligibility. Distinguish loading/unknown/stale/unsupported from busy or disconnected. Keep rich drafts/attachments on every denied/late action. New-protocol unknown denies the action; older servers get an explicit compatibility state rather than treating absent fields as permission. Label WorkBuddy experimental independently of connection status. Shared-native permission policy must not be presented as a fictitious AnyWork override or sandbox promise.

The existing “recheck connection” action currently refreshes plugin configuration; either label it accordingly or connect it to the separately defined read-only diagnostic. Native settings/edit capabilities already have positive guards; preserve them when consolidating data sources. Tool-spawn-derived `canInteract` does not itself prove the child is currently writable.

Queue responses/UI must clearly identify `owner=anywork`, native synchronization false and handoff disposition. Local pause only pauses local dispatch; deleting a local uncertain row is not native cancellation. After native accepts a queued message, distinguish handed off/queued natively from started executing. Do not add native import/edit/cancel without native IDs and proved capabilities. Native goal state and history edits retain native authority; local UI locks/gates are not cross-device CAS. The follower's supported goal pause can stop execution and must disclose that side effect.

## Delivery sequence and acceptance

1. Additive server projection: typed policy/observation model, scoped pure-read endpoint and catalog fields. No broad command rewrite or UI activation in this module.
2. Typed errors on critical command/adapter/SDK paths, coordinated with I02/I03 rather than a second delivery journal.
3. Unified Web consumption and owner labels, including fail-closed unknowns and original draft/late-response guards.
4. Combined independent verification of server enforcement and actual UI behavior; documenting a capability is not implementing it.

Use fake-only controlled integration tests for uninstalled/misconfigured plugins, valid-but-dead descriptors, unknown login, readable-offline history, incompatible versions/instances, WorkBuddy auxiliary/archive cases, Codex follower pause-only versus shared-engine support, custom unknown plugins and busy model/effort differences. Assert scope isolation, no spawned processes/native mutation on reads, expiry/invalidation, safe errors independent of message language, no secret fields, explicit legacy compatibility and both desktop/Pixel controls. Direct HTTP command tests must demonstrate guards; hiding a button is insufficient. Real native writing/support acceptance remains separately gated in the support matrix.
