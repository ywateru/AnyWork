# Independent account Web re-review 03

Reviewed exact W4 fix candidate: `8f0b58e46f37a45cf5738de7d78cae3b400c5127`. Previous review: [account-web-02](account-web-02.md). Reviewer is separate from the implementation author. Scope is the private browser-state helper, its CLI integration, safety tests and related documentation; account/transport product code is unchanged from the previously reviewed fix.

## W4 resolution

**Resolved.** The cloud-check CLI validates credentials before launching a browser. The helper enumerates the project's actual Git worktree roots with NUL-delimited Git output, resolves those roots, and rejects an absolute normalized candidate inside any root. It rejects symlinks in the complete traversed path, nonregular files, wrong-owner files and group/other permissions; the immediate destination directory must be owned by the current user and not writable by group/others. Existing state is opened without following a leaf symlink, bounded in size, parsed behind fixed sanitized errors and checked for unchanged file/directory identity. Windows is explicitly refused by this POSIX private-file verification helper rather than silently weakening checks.

An exclusive sidecar lease prevents simultaneous refresh-state owners. Playwright receives the parsed state object, never the file path. Checkpointing creates a fresh exclusive mode0600 temporary file in the verified directory, writes and fsyncs it, rechecks identities, atomically renames it and fsyncs the directory. It does not write OAuth state to the destination first and chmod later. Changed destination/parent identity fails closed without writing through the replacement. Cleanup only removes the helper's identified temporary/lock objects. An abandoned lease after process termination requires operator reconciliation; the helper does not guess that another grant owner has stopped.

The same context's current storage state is checkpointed in `finally`, including when a post-refresh UI assertion fails. The original failed check remains a rejection/nonzero CLI result. Browser, parse, filesystem and checkpoint errors are converted to fixed messages; neither secret-bearing exceptions nor sensitive URLs reach output. Checkpoint failure also remains nonzero. The CLI prints success only after the helper's checkpoint and cleanup complete.

No new blocking or non-blocking finding was established in this corrective scope.

## Independently executed evidence

- `node --test web/scripts/private-browser-state.test.mjs`:8 tests passed. Fake credentials only. Tests cover every injected worktree root plus actual Git-root CLI rejection, relative/public credential paths, writable destination directory, leaf/ancestor symlinks and nonregular input; stricter owner-only input; exclusive concurrent ownership; observed mode0600 temporary/final files and atomic inode replacement; rotated state persisted after a failed assertion while failure remains; destination/parent replacement refusal; parse/browser/checkpoint redaction; and CLI exit1 with fixed stderr and no secret/path output. The source UID checks were inspected; the test runner did not change ownership of real files or require elevated privileges.
- `npm run format:check`: passed.
- No real OAuth credential file, refresh grant, browser profile or cloud resource was read or changed for this W4 re-review. No browser was launched by the safety suite. The product transport/account source did not change, so repeating cryptographic, unit and real OAuth integration tests was unnecessary for this narrow correction.

## Combined Web source acceptance

**pass — Web source** for exact candidate `8f0b58e46f37a45cf5738de7d78cae3b400c5127`. W1–W4 are closed across the recorded reviews.

Previous independently executed evidence remains separate and applicable to unchanged product code:323 unit tests/typecheck;22 actual browser/Rust assertions; genuine late-ACK reproduction now continues with HTTP200; and fresh DEV hosted official login plus owned-state immediate replay with Account/Grid200, zero alerts,1440/390px layout and dialog behavior. This W4 suite uses fake credentials and does not represent a new OAuth success or establish long-lived grant renewal.

Production readiness remains separate: supported native enrollment and rename preservation, full grant→Grid discovery→encrypted workspace→disable/logout acceptance, phone/cellular access, Logto production entitlement/fees, new-user email/default-role acceptance, CyberGrid distribution permission, and final merged exact-source publication gates must retain their independent status. This source pass does not authorize purchase, deployment or publication.
