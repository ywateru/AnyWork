# Independent WorkBuddy acceptance

State: runtime preflight in progress; implementation review waits for committed candidates. Verifier: harness_verify, independent of developer agents.

Use [the integration contract](../../workbuddy-integration.md) as the acceptance boundary. Verify the actual installed artifact and an isolated native runtime wherever possible, not just mocked proposed methods. Preserve the running user's WorkBuddy, Codex and AnyWork processes, existing credentials and prompts. Do not edit installed artifacts. Account for WorkBuddy's global deep-link registration before isolated launch: config/userData selection alone is insufficient OS isolation.

Record each observed layer separately: source contract, protocol fixture, installed preload runtime, native conversation creation/history, same-desktop delivery/approval and full AnyWork end-to-end. A fixture must never stand in for unverified native support. Use deterministic local model responses for actual prompts and only isolated sessions; no real cloud/model traffic or user-session prompts. Keep unavailable gates explicit and report evidence-backed limitations.

Review committed backend/UI/launcher results in their worktrees. Verify cross-Agent catalog persistence/scope, strict discovery and target identity, message exactly-once/uncertain behavior, rich events/resources, approval generation isolation, native models and honest unsupported controls. Reject any global subscription/current-set changes that alter the desktop's own event ownership. Do not approve publication or mark the goal complete solely because unit tests pass.
