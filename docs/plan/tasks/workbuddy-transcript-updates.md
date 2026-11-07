# WorkBuddy visible transcript and native update delivery

User report: internal injected context is rendered as a user message; a prompt reaches native WorkBuddy and produces a response, but AnyWork does not update. Investigate the actual installed 5.9.3 boundary and fix the established projection/synchronization contract.

## Required behavior

- Match native visible conversation content. Hide native injected system/context blocks using verified native display metadata/semantics, preserving actual user text, attachments, tools and assistant output. Do not blindly strip strings from arbitrary user-authored text.
- Follow the same native request after send and during desktop-originated execution. Read the canonical native snapshots without changing desktop selection/subscribers, starting another engine or retransmitting prompts. Report pending/running/completed and replies through existing events with stable identities.
- Already imported passive context rows must disappear after authoritative reconciliation without losing live/pending/user rows. Preserve branch safety and cached history on partial/failed reads.
- Corroborate envelope and refresh semantics from shipped code and passive current-runtime evidence. Keep actual observations separate from fixture guarantees. No real prompts or native application restarts for testing.
- Test the failing native-shaped envelopes end to end through adapter, Store/history/SSE and browser as appropriate; include incremental replies, repeated polls, offline/live transition and retained user text resembling internal tags.

Developer investigates/implements in an isolated worktree and commits. A separate verifier reviews exact commits and reproduces acceptance. Root owns docs, merged checks and AnyWork-only local deployment after ensuring no owned task is interrupted. No release/version/public website changes in this follow-up.

Status: investigating.
