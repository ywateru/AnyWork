# WorkBuddy shared desktop integration contract

Status: experimental implementation merged locally after independent code acceptance; native writing acceptance remains open in the [investigation](plan/analysis/workbuddy.md). Supported target under investigation is WorkBuddy Desktop 5.9.3. This document must not be interpreted as a shipped capability claim. See the [launcher guide](workbuddy-launcher.md), [backend review](plan/reviews/workbuddy-backend.md) and [UI review](plan/reviews/workbuddy-ui.md).

The unchanged installed application's isolated preload, conversation-list boundary and safe public model projection have passed actual runtime checks. A fresh signed-out profile cannot create a local conversation: its native repository requires an account user ID before creation. A custom local model does not remove this prerequisite. Complete the application's normal account setup before attempting real creation; AnyWork does not provide a login bypass. Text/image delivery, approvals and cancellation have protocol-fixture coverage but still require acceptance against a normally configured native desktop. Never equate those fixture results with completed native interoperability.

## Ownership and transport

AnyWork connects to an already running WorkBuddy desktop, never another CodeBuddy CLI, Harness instance, PTY owner or daemon stdin. The candidate transport uses a persistent local CDP connection to WorkBuddy's existing trusted main renderer and invokes its existing `__wbInvoke(channel, context, ...args)` preload boundary. The verified namespace is `wb:conversations:<method>` (nested repository: `wb:conversations.local:<method>`); invoke it with an undefined context and separately serialized method arguments. Methods and side effects are recorded in the investigation.

An optional explicit launcher may set the application's built-in `WORKBUDDY_REMOTE_DEBUGGING_PORT` for its next launch and publish a private descriptor. It must not patch/re-sign the app, terminate an existing instance, steal its single-instance lock, read model account credentials or start an independent agent. If the chosen profile already runs without the entry, provide actionable setup guidance; do not silently claim connection. Tests launch only isolated profiles with OS integrations accounted for. Production sessions remain untouched.

Accept loopback endpoints only; disable redirects/proxies, validate the WorkBuddy target and version/preload shape, keep descriptors private (Unix owner, directory 0700 / file 0600, no symlinks), and redact debugger URLs/tokens. CDP is privileged even on loopback: setup instructions must describe this local trust boundary. Do not expose raw CDP, arbitrary JavaScript evaluation, account or authentication methods through the Web API. Adapter evaluation templates are fixed code plus JSON-serialized data.

Event subscriptions in the actual desktop are per webContents, not per CDP client. AnyWork must not change the desktop renderer's `current` conversation set, dispose its existing subscribers, replace globals or hijack global events. If notifications cannot be observed without these changes, use verified read-only snapshots over the persistent connection and reconcile stable native IDs. Unsupported or unsafe capabilities fail before a mutation.

## AnyWork backend

Use an in-process Rust adapter and `RpcProcess::bridge`, retaining existing normalized conversation events. Keep `Runtime.desktop` specific to Codex. Provide a small shared-host dispatch boundary for Harness and WorkBuddy rather than duplicating Codex owner/control logic or introducing a broad rewrite.

- Availability and registration come from a valid configured/discovered desktop entry, not the presence of an application directory.
- Discovery imports native root conversations with stable `workbuddy-<native-id>` identifiers, actual cwd/title/times/archive/status, and `external=true`. Preserve desktop ownership. Apply the generic explicit `--agent-scope all` for cross-project histories; the default remains workspace scope and legacy `--codex-scope all` does not grant other Agents arbitrary directories. Passive disk history is documented in [persisted local history](workbuddy-persisted-history.md).
- Refresh imported sessions **per Agent**. A successful Codex scan cannot delete Harness or WorkBuddy imports; partial/failed discovery cannot delete another Agent's rows or manufacture an empty successful catalog.
- Creation calls the existing desktop's native create once and stores its actual identifier. Opening/importing history must not create a conversation, send a prompt or switch the desktop's current conversation.
- Translate native user/assistant/tool/child/attachment/request records with stable IDs and chronology. Snapshot and live updates must not duplicate items, replay mutations or lose unresolved interactions. A detached connection reports disconnected and reconnects by rereading state, without automatic prompt retransmission.
- Message input carries text and supported rich attachments to the same native conversation. Cancellation and permission/question responses target exact native identities; stale responses fail visibly. An AnyWork disconnect does not cancel the native turn or close the conversation globally.
- Model catalog/settings come from WorkBuddy. Never fall through to Codex model, plan, goal, fork, review, edit or thread mutation APIs. Expose only independently verified capabilities; reject unsupported operations before accepting associated messages.
- Existing server-local queue behavior can be reused only after native busy/read/steer semantics are checked. Queue metadata remains scoped to its original Agent/session.

## UI

```text
New chat / Agent chooser
  [Codex] [DeepSeek Harness] [WorkBuddy]  (only configured/discoverable backends offered)
Sidebar
  [Agent filter: All Agents v]
    All Agents
    Codex
    DeepSeek Harness
    WorkBuddy                    unavailable label when absent
  project
    [native Agent icon] title              running / needs input
Conversation
  existing transcript / tools / child agents
  existing composer with native supported controls
```

Use the existing generic identity/filter components. WorkBuddy's official teal SVG is locally bundled, sanitized and accompanied by source/checksum/attribution. Preserve brand color on both themes and do not relabel unknown agents. Agent filtering is presentation-only and must not change selected conversation, drafts, panels or active streams. No redesign of the established shell is required.

## Acceptance

Develop implementation in isolated worktrees; an independent reviewer verifies the committed result. Cover coexisting Agent imports, scoped directories, native IDs, history/live reconciliation, text/attachments, busy/queue behavior, cancellation/approvals, native models, unavailable/unsupported paths, reconnect and disconnect ownership. Verify the actual installed application's boundary independently, not solely a mock of the proposed envelope. Keep any unverified runtime gate explicit. No version bump, release or deployment is authorized by this implementation contract itself.
