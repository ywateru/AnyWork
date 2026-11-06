# Harness delivery boundaries

The user requests both a second functional agent and extraction of the official conversation UI. Neither a cosmetic skin nor a separately started engine satisfies this goal. The design contract is [the integration document](../../deepseek-harness-integration.md).

## Modules

| Module | Inputs | Outputs / owner | Task |
| --- | --- | --- | --- |
| Host transport | configured local Harness URL and host authentication | official RPC and per-client multiplexed streams, host retains execution | backend |
| Agent adapter | native session/model/history/control contracts | existing AnyWork RPC/events, stable host session identity | backend |
| Discovery/API integration | real workspace catalog, session catalog and live state | selectable agent, existing/history sessions, same-session control and rich assets | backend |
| Conversation extraction | pinned official UI source + existing normalized messages | attributed message/tool/status views, existing shell and composer preserved | UI |
| Source export | tracked source and trusted archive manifest | reviewed product files only; reference/worktree data excluded | backend |

## Creation and call paths to verify

| Path | Verification requirement |
| --- | --- |
| CLI/server config → adapter registration → `/api/plugins` → Agent selector | configured agent appears; unavailable host yields actionable error |
| native Harness workspace/session → discovery → Store → session list | imported history retains original IDs, directory scope and execution status |
| AnyWork create → real host workspace/session creation → Store | creates exactly one real host session and can be continued on host |
| session open → native history → normalized events → extracted view | user/assistant/tool chronology and attachments survive hydration |
| native stream → adapter → runtime → persisted events → SSE → active view | incremental output, completion, permissions and error state update live |
| existing Composer → message API → adapter → original host session | same engine/session receives the message; no duplicate runner or permission override |
| cancel / permission response → adapter → native host | exact in-flight execution/request is affected; stale IDs fail visibly |
| disconnect/reconnect → snapshot cursor + stream → cache | no duplicate messages/tools, lost approval or replayed prompt mutation |
| metadata/settings → native model catalog | no accidental Codex model/goal/plan/fork calls on Harness sessions |
| rich result/attachment → preview admission and file delivery | selected-session resources are viewable within existing file boundaries |
| AnyWork shutdown / UI close → adapter close | disconnect client only; original host keeps running |
| source export → published archive | forced-tracked `ref/` and `.worktrees/` fixtures are still excluded |

Backend and UI work proceed in disjoint worktrees. An independent reviewer prepares the real host and checks committed deliverables. The primary agent coordinates source acquisition, contract decisions, review fixes and final merge/checks. Current npm Harness and reference revisions must be recorded together so verification does not silently mix incompatible protocol generations.
