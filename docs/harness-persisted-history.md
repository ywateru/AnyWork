# Harness persisted history

AnyWork passively reads the current supported Harness v4 history, independently of the shared execution host. It does not open a session write lease, invoke create/resume, start Harness, answer permissions or change native files. Root histories retain `harness-<native-id>` IDs, so returning live control attaches to the same conversation. Native child logs stay out of the root sidebar.

## Storage evidence

The pinned official source is `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`. Relevant contracts are `packages/session/session-persistence-jsonl/src/{index,format,zstd}.ts`, `packages/session/session-format/src/filename.ts`, `packages/session/session-projection-cache/src/{index,spec}.ts`, `packages/workspace/workspace/src/index.ts` and `packages/attachment/attachment-local/src/{store,file-store}.ts`. No extracted source or user history is bundled.

The standard data root is `$DSH_HOME`, or `~/.dsh`, used with no explicitly selected host. An explicit `--harness-url` or `--harness-discovery-file` can select another profile, so default local histories are disabled in that case. Bind its native data directory explicitly with `--harness-history-root /absolute/profile-root` (`ANYWORK_HARNESS_HISTORY_ROOT`); this is the directory containing `sessions`, `storages` and `attachments`, not a project directory. The override also works without any host. Launch credentials and descriptors carry no authoritative data-directory identity and are never used to guess it. Its known catalog is `sessions/<project>/<native-id>/session.v4.jsonl.zstd` (plaintext `.jsonl` is also supported). The numerically highest canonical generation is authoritative. Current v4 is supported; older generations requiring migration and unknown future generations fail explicitly rather than being interpreted using a guessed schema. Mixed plaintext/compressed generations, duplicate native IDs and symlink paths are refused. A session header must match its native directory identity and contain the actual absolute cwd.

`storages/workspace.json` unit `workspace` version 2 supplies archive membership. `storages/session_projcache/sessions/<native-id>.json` versions 3–7 can supply the native title, only when immutable lifecycle fields match the header and the title row uses version 1. An absent/stale/malformed disposable title cache falls back to previously known title or the explicit generic Harness title; it never causes a cache rewrite. Projection rows are never used to fabricate conversation bodies.

## Listing and opening

Catalog refresh reads bounded header frames and metadata, caching unchanged headers by size/mtime. It does not parse every conversation body each time the sidebar polls. A valid local history can be listed while its original directory has been removed, provided all-project scope is explicitly enabled. Existing workspace-only boundaries remain in force otherwise.

Opening lazily decodes the selected log and applies the same durable event projection used by the live adapter: user text, assistant answers/reasoning, tool calls/results, native turn IDs, sequence IDs and times. Non-user contextual injections remain excluded. Imported events use the same `harnessEventKey` as later live replay; re-opening or reconnecting cannot append duplicate users or tools. Persisted logs alone never produce actionable permission requests or claim that an execution engine is running.

Compressed histories consist of independently committed Zstandard frames: the first holds only the header and each later frame holds a native batch. Every complete frame is decoded separately, with checksum, window and output limits. Complete malformed JSON, invalid sequences and invalid compressed structure fail. Only an unfinished final frame or final JSONL row is omitted; the history response includes a notice and retries that tail on the next read without repairing native files. The reader bounds each body to 128 MiB and 100,000 durable records, and catalogs to 10,000 session entries.

Images/files are resolved only through validated SHA-256 attachment references under `attachments/v1/objects` or `attachments/v1/files`. Size and digest must match; arbitrary paths and URLs are never followed. Verified bytes are copied only into AnyWork's own per-session preview directory. Missing native attachment bytes are explicitly identified as unavailable; the source file is never changed.

Local metadata is observed before the optional live catalog overlay. That live phase is capped at 750ms, so a stale descriptor cannot indefinitely hide the passive catalog. Each failed/partial source retains prior imports; it never deletes another Agent's sessions. Active AnyWork runtimes retain their authoritative state instead of being overwritten by disk observations.

## Verification boundary

Focused Rust tests cover both encodings, multi-frame batches, highest-generation selection, torn tails versus corrupt committed rows, checksums/window bounds, lifecycle-bound cached titles, idempotent offline/live event identity, attachments, symlink rejection and explicit-host/profile binding. Fixtures are synthetic and have no model service.

An explicit read-only opt-in test also parsed this machine's actual native corpus on 2026-11-07: 46 v4 compressed logs, 22 root histories, 24 child logs, 28,257 durable rows and 14,197 normalized events, with no incomplete tail. This establishes the observed local format and projection compatibility, not new message sending or shared control acceptance. It prints counts only and never modifies native histories:

```sh
ANYWORK_TEST_HARNESS_NATIVE_HISTORY=1 cargo test -p anywork \
  harness::persisted::tests::native_history_read_only_aggregate -- --ignored --nocapture
```
