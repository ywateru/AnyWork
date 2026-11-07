# I04 independent conditional-file-save review

Reviewed exact candidate `9e14b96758565509c6cfd38fa4f5526701109031` on 2026-11-07 in its isolated worktree. Contract: [G0](../tasks/improvement-g0.md); implementation scope/evidence: [conditional text saves](../../file-edit-consistency.md). The reviewer did not implement this candidate or modify product code.

## Result

**Initial result at `9e14b96`: changes requested. Follow-up `629992a` is now independently accepted for source integration; see the final section.** The revision/precondition protocol, publication strategy and Web response-generation protection address the main intended problems, but the mutex does not identify equivalent filenames on the tested case-insensitive macOS filesystem. This is within the promised AnyWork coordination boundary, not the documented arbitrary external-writer CAS limitation.

## Blocking finding

### B1 / P1: equivalent filename aliases bypass the shared destination mutex

`save_file_with` canonicalizes the parent but appends the caller's unnormalized basename to form both the lock key and destination. On this host, `case-race.txt` and `CASE-RACE.TXT` refer to the same file, while their `PathBuf` mutex keys differ. Two AnyWork requests can both pass the final digest check and both return 200, overwriting one accepted result with the other.

Independent real-HTTP reproduction used the existing temporary HTTP fixture and this worktree's debug server, two fixture sessions, one 524288-byte baseline and its exact revision. A barrier released two concurrent writes, one through `case-race.txt` and one through `CASE-RACE.TXT`, using different 524288-byte submitted contents and the same expected revision. **The first attempt returned `[200, 200]`.** The temporary filesystem was separately confirmed case-insensitive. Expected result under the G0 contract is one success and one conflict. No native task/account/production path was used.

Required fix: coordinate writes by actual destination identity under host filesystem alias semantics, including existing case/Unicode aliases and create-path handling, without following an unsafe final symlink or introducing unlink-before-replace. A conservative shared parent/directory lock is one possible correctness-first choice; blindly lowercasing all filenames is not a portable filesystem identity algorithm. Preserve current canonical parent alias handling. Add isolated concurrent alias regressions that conditionally exercise the filesystem's actual behavior, including canonical-equivalent Unicode names where supported, and verify original data/temp cleanup.

## Nonblocking observations

- **N1 / response validation:** Workspace treats any truthy `result.revision` as successful save evidence and does not check `ok === true` or the digest format. A malformed response such as `{ok:false,revision:"invalid"}` can mark submitted text clean even though it is not a valid contract response. Comparison similarly accepts any truthy revision. Existing malformed-response browser coverage checks only an omitted revision. Recommend strict runtime response validation and additional malformed type/shape cases, or narrow the documentation's broad malformed-response guarantee. An additional independent desktop-browser probe intercepted only the temporary fixture PUT and returned `{ok:false,revision:"invalid-but-truthy"}` without writing the backend: Save became disabled and no error appeared although the disk retained its prior content. The draft remained visible. No production malformed response is alleged.
- **N2 / untested late publication faults:** temporary-file failure injection occurs before publication. Parent-directory fsync and post-publication failure behavior is carefully coded as uncertain, but not actually fault-injected by the submitted tests. This limitation is explicitly documented and is not itself a blocker. Future tests should verify that UI comparison is required and the published bytes are not treated as known absent.

### Visual follow-up

Independent desktop (1440×1000) and Pixel 7 (412 CSS-pixel width) screenshots used long filenames and unbroken local/latest content. Both had document scroll width equal to viewport width; the comparison text wrapped, explicit adoption/discard buttons remained within the content column, the file close control remained visible, and the existing browser suite successfully clicked comparison/save actions. No new blocking layout problem was observed. **N3 / nonblocking:** the floating copy/Save toolbar overlaps the upper-right first line of the conflict banner on both sizes; reserve a separate toolbar row or vertical space. The Pixel file tree consumes substantial width, but can be hidden with the existing file options. Screenshots are local ignored artifacts under `artifacts/file-review/desktop-conflict.png` and `pixel-conflict.png`; they contain only fictional fixture data and are not published. This is screenshot inspection, not a physical-device or screen-reader acceptance.

## Contract inspection

- Reads calculate SHA-256 from the same bounded bytes decoded as UTF-8, preserving Unicode, CRLF and trailing newlines. Save distinguishes omitted precondition (428), explicit null create-only, valid exact digest and malformed digest. Unknown JSON fields/types fail extraction. Conflict uses stable 409/code and does not truncate the original.
- The writer uses a unique same-directory create-new temporary file, writes bytes, preserves ordinary permission bits, fsyncs the temporary, rechecks bytes, then renames the existing destination. No unlink/truncate fallback exists. Create-only uses atomic hard-link publication and fails if the destination exists. Unsupported hard-link filesystems fail safely. Unix parent fsync follows publication; uncertainty is explicitly returned when rename/sync outcome cannot be confirmed.
- Final symlinks and special files are rejected; canonical parent boundaries prevent ordinary traversal and escaping parent symlinks. Unix no-follow/nonblocking reads avoid following a swapped final symlink or blocking on FIFO. The documented external parent-directory, external writer, hard-link identity, ownership/ACL/xattr and multiple-process limits are accurate scope restrictions, rather than a claim of native cross-process CAS.
- Temporary-file Drop cleans normal write/check/publication failures; crash leftovers are explicitly documented. Create-only's temporary second link can remain after a crash, but does not authorize overwriting another destination. No real crash-durability claim beyond the stated platform scope was inferred.
- Workspace preserves draft state after a conflict/transport error, keeps the original expected revision until explicit adoption, offers draft copy, latest comparison and explicit discard. Save success uses the captured submission, so typing during a pending request remains dirty. Request owner identity includes API/session/path/view generation; a new generation prevents old save/comparison results from mutating an A→B→A view. Existing tests exercise these through the actual React UI and isolated backend, not just reducer snapshots.
- Deliberately closing/navigation/refresh draft persistence is not provided and is stated explicitly. Windows/Linux behavior, network filesystems and post-publication sync fault injection remain open; they are not silently declared supported by macOS tests.

## Independent verification

| Check | Actual result |
| --- | --- |
| `cargo test --locked -p anywork files::tests -- --nocapture` | 8 passed |
| `python3 scripts/file-consistency-test.py` | 4 passed, real isolated authenticated HTTP |
| `PLAYWRIGHT_CHANNEL=chrome ANYWORK_E2E_PORT=3278 ANYWORK_E2E_OUTPUT_DIR=test-results-independent-file npx playwright test e2e/file-consistency.spec.ts` | 14 passed across desktop Chrome and Pixel emulation |
| Independent same-revision case-alias concurrent HTTP writes | First attempt reproduced two successful overwrites; blocking B1 |
| Temporary filesystem alias check | `case.txt` and `CASE.TXT` resolve to the same existing file |

The eight unit cases genuinely assert conflict/original preservation, normal temp cleanup, prepublication failure and concurrent same-spelling writes. HTTP cases add JSON contract, cross-session canonical-parent aliasing, auth, size/type/path limits and create collisions. They did not cover equivalent final filename aliases; passing those suites therefore does not disprove B1. Browser cases genuinely assert draft contents, dirty save behavior, explicit rebasing and stale-generation isolation; they do not establish arbitrary success-response schema validation or physical-device acceptance.

No root target/dist mutation, product implementation edit, real account/token-file/native task access, service restart, publication or external write occurred. Existing target/Web output belongs to this isolated worktree. Actual production and native applications were not tested.

## Follow-up acceptance

Re-review the exact follow-up commit after B1 and its regression are added. Retain the documented non-CAS/cross-platform boundaries. Root should register the HTTP script in the merged check pipeline, run merged-contract checks, and record independent acceptance before marking I04 resolved. This review does not close other G0 or continuing improvement issues.


## Independent follow-up review: 629992a

Reviewed exact follow-up `629992a8f9056bb863530ee25f97f71b8f2ff793`. **Pass for source integration: B1 and N1/N2/N3 are resolved; no open source-review findings.** The earlier sections retain the failures and limitations of the initial candidate, not new failures against this follow-up.

- **B1 resolved with actual filesystem/HTTP evidence:** the lock is now process-wide and held through path resolution, both revision checks, temporary writing, publication and directory synchronization. It does not guess filesystem equality from lowercase/Unicode strings. This conservatively serializes unrelated saves, an explicit throughput tradeoff. The updated real HTTP suite passed all six tests without skipping the case or NFC/NFD equivalent-name cases. Each alias group performs ten 512-KiB existing-file races and an absent-file create race, verifies `[200,409]`, exact winner bytes, conflict JSON and cleanup. Separately, the reviewer ran **12 rounds each** of case-equivalent and NFC/NFD-equivalent names with **1-MiB** contents over two actual HTTP fixture sessions. `os.path.samefile` confirmed both groups alias on this host; all 24 additional races returned one 200/one 409 and retained exactly the successful submitter's bytes, with no leftover temporary files.
- **N1 resolved:** save success requires `ok === true` plus a lowercase SHA-256 revision string; comparison and initial read use the same revision-format guard. The actual browser malformed-success matrix covers false/missing/nonboolean ok and invalid/nonstring/null/uppercase revisions, and malformed comparison cannot replace the baseline. The reviewer independently repeated the original `{ok:false,revision:"invalid-but-truthy"}` response injection on both desktop and Pixel views: an error appeared, the draft remained visible and Save remained enabled/dirty, with no backend write.
- **N2 resolved at the intended abstraction:** the real save path now accepts an injected directory-sync function for deterministic testing. Create and update both publish bytes, then a forced sync error yields 503 / `file_save_uncertain` / `delivery_state:uncertain`, keeps published bytes and removes the temporary entry. A repeated create remains conflict. Browser coverage makes a real successful fixture PUT, replaces its delivered response with 503 uncertain, then proves draft retention and explicit comparison/adoption. This verifies the application outcome contract; it does not simulate a physical power cut or establish untested filesystem durability.
- **N3 resolved and visually rechecked:** tools now occupy their own normal-flow row. Independent fresh desktop (1440×1000) and Pixel 7 (412 CSS-pixel width) long-name/long-content screenshots were opened and inspected. Both have a **12-pixel gap** between toolbar bottom and conflict banner top, no document horizontal overflow, wrapped comparison text and visible adoption/discard/close controls. Local ignored evidence is under `artifacts/file-review-fix/desktop-conflict.png` and `pixel-conflict.png`. Pixel remains narrow with the optional tree open, but the controls remain usable; no new blocking layout issue was found.

| Independent check on the exact follow-up | Result |
| --- | --- |
| `cargo test --locked -p anywork files::tests -- --nocapture` | 9 passed, including post-publication sync injection |
| `python3 scripts/file-consistency-test.py` | 6 passed; actual case/Unicode cases ran, no skips |
| Additional 1-MiB real HTTP equivalent-name concurrency | 24/24 rounds: one success, one conflict, exact winner bytes |
| `PLAYWRIGHT_CHANNEL=chrome ANYWORK_E2E_PORT=3278 ANYWORK_E2E_OUTPUT_DIR=test-results-independent-file-fix npx playwright test e2e/file-consistency.spec.ts` | 18 passed across desktop Chrome and Pixel emulation |
| Independent malformed-success browser reproduction | Both sizes rejected, preserved draft and kept dirty state |
| Independent screenshot/layout inspection | Both sizes: separate toolbar, no horizontal overflow; 12-pixel banner clearance |

The 25-case existing integration suite was reported by the developer and not unnecessarily rerun by this reviewer; the direct changed-contract HTTP/browser layers were run independently as listed. Only this review document was edited. The extra port-3281 screenshot fixture service was explicitly stopped after verification; no production service, root target/dist, account/key file, native Agent task or external publishing endpoint was touched.

Root should integrate the exact accepted candidate and review, run merged G0 contract checks, and register the focused HTTP script. The process-wide lock coordinates only this AnyWork process. Arbitrary external writers/multiple server processes, physical crashes, Windows/Linux/network-filesystem behavior and real Android devices remain explicitly outside this review's tested guarantee. Those limits remain visible and do not convert this source pass into a claim of portable native CAS or full I05 recovery.
