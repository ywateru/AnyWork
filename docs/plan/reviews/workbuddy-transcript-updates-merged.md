# WorkBuddy transcript and updates — merged checks and local deployment

Accepted product `1f72424` and carrier/browser coverage `b65922a` merged at `323a405`; independent review report was cherry-picked as `c9df708`. [Independent review](workbuddy-transcript-updates.md) has no open blockers. [Implementation and evidence](../../workbuddy-transcript-updates.md) documents the native undefined-cursor and generated-input contracts.

Merged validation passed:

- Rust workspace formatting and Clippy with warnings denied; **157 tests passed**, eight explicit opt-in tests ignored (115 server, 34 desktop, five Codex adapter, three SDK bridge).
- Debug and optimized server builds.
- Web typecheck and fresh out-of-tree Web/PWA build. Its content matches the already served frontend; PWA identity remains `anywork-eb75d7e2f8bbc5b8`.
- Comprehensive shared-history HTTP acceptance, all 25 service integration cases and all 14 editing cases.
- Extended WorkBuddy CDP carrier using the actual served Web UI, Bearer HTTP and SSE: null-sensitive snapshots, same-key dirty-cache repair, Web and desktop incremental replies/completion, metadata-only hiding, idempotence and detach ownership.
- Four desktop/Android browser cases for offline dsh/WorkBuddy history. The independent review separately verified actual pagination, single send and offline completion/reconnect/reload against a native-shaped preload fixture; no Web API responses were mocked.

An initial out-of-tree build invocation used a workspace selector from inside the workspace directory and failed before building; it was corrected to the direct Web script. Final typecheck, build and all validation above passed. Existing Vite chunk-size advice remains unchanged by this backend correction.

On 2026-11-07 the tested optimized binary replaced only the local AnyWork service at `http://127.0.0.1:3210/`. The pre-restart gate found no active owned task. Existing arguments, all-Agent scope and served Web assets were preserved. A private SQLite backup, previous binary and sanitized deployment evidence remain in ignored `artifacts/workbuddy-transcript-baseline/` and `artifacts/workbuddy-transcript-c9df708/`.

Post-deployment acceptance retained all **101 sessions**: 71 Codex, 22 dsh and eight WorkBuddy. The access token, native application processes and Cloudflare tunnel process were unchanged. The affected WorkBuddy body now contains all **three** completed user turns; visible input lengths are **5 / 8 / 8**, with the generated context removed from both visible text and raw input. A repeated full paginated history read returned identical event identities and contents. No native prompt, desktop selection change, native restart or native data write was used for acceptance.

The source version remains 0.1.10. This follow-up does not publish a release or claim completion of the separately open installed WorkBuddy native creation/message/collaboration acceptance gate. The actual native observations here are passive; new-send and streaming acceptance use the isolated deterministic carrier and real AnyWork Web/service stack.
