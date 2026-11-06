---
id: message-replay-race
scope: snapshot and live-event consistency discovered during release verification
status: in-development
depends-on: [sidebar-agent-filter]
---

Full CI on v0.1.8 passed the new Agent filtering cases but exposed an existing intermittent message projection bug: one completed assistant article contained the entire document-preview answer twice. This is product evidence, not an ambiguous navigation locator; retain the strict single-link assertion.

## Contract

- A history/snapshot fetch and a live event replay must converge to the same canonical item text and identity. Late or replayed deltas must not append text already represented by the snapshot.
- Preserve valid repeated text and consecutive identical delta chunks. Do not deduplicate by matching text content, suppress errors, select the first duplicate, or delay tests merely to hide a visible completed duplicate.
- Preserve turn/item IDs, live updates, existing history, cache switching and cross-session isolation. Do not send real prompts or change installed hosts during development/acceptance.
- Add a deterministic regression for the actual observed event/snapshot ordering, then independently review and test the committed change. Also investigate the separate 1.5px desktop overview geometry failure; if measurement timing is responsible, take a coherent settled layout measurement without weakening containment.

The orchestrator-created `task/release-018-ci` worktree owns the fix. Developer commits product/tests; independent verifier reviews stable commits. Root handles merges, full checks and authorized deployment. v0.1.8 and its assets remain immutable; a product correction ships as v0.1.9 after acceptance.
