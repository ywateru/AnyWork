# Native onboarding v0.1.19 candidate — independent review

Current local outcome: the original `aab58841` operation below was abandoned after a pre-submission metadata check stopped it without installation. A separately reviewed ownership-copy correction and fresh `05917a0d` operation completed the local update. See the final adoption section; no old approval was reused. The earlier candidate bindings below remain historical evidence.

## Candidate verdict

Accepted artifact and update script for fresh private operation `aab58841-9ac0-408b-a78f-9c413fe74aa8`, frozen source `a738372dc1536847972f8dc3ea602bb18abb723b`, official version **0.1.19 / build 20**. This is preinstallation evidence. The permanently abandoned v0.1.17 and v0.1.18 operations and approvals are not reused.

Actual adoption remains gated on successful exact-source CI, fresh operator computer-use confirmation of signed-out/remote-off state, operator exit of Native only, and a new expiring approval bound to all evidence. No approval or apply action was issued by this reviewer. Opening Native and verifying the real introduction must follow separately; script success alone is not GUI acceptance.

## Exact-source CI result

Independently watched [Checks run 42831979308](https://github.com/ywateru/AnyWork/actions/runs/42831979308) read-only to completion, then made a fresh API read confirming its head SHA exactly equals `a738372dc1536847972f8dc3ea602bb18abb723b`, status `completed`, conclusion `success`. Android, container, Windows Native and server-web all succeeded. Server-web completed at `2026-11-10T14:43:32Z`; its complete check script, formatting and final website checks passed. The watcher exited zero. No CI rerun, cancellation or other mutation occurred. This satisfies the candidate's Checks gate; fresh local approval, adoption and GUI acceptance remain separate.

## Frozen bindings

| Evidence | SHA-256 |
| --- | --- |
| Update script | `b63236f517970029913e276b4c2316ea529417bc8a7022219d051dd8a01a9bd9` |
| Public export helper | `f66544260a2203c05da722210f848e4b06363fe16b0aaf55a90076d269844fc8` |
| Candidate manifest | `857f2164136da26559873a670bfa50559948b17644c576211502241ae3fbea5c` |
| Baseline capture | `020eee5b423800c93f9fd00a51cb8174303444166bd89b27edaa31ffe3643079` |
| Runtime capture | `b85c7156040c835efcb7653a38f051c4cbc19a74e4227d706393e547451ca6d7` |
| Official source evidence | `a8ac84f7897b0ea144399849b2ba2b0d4210f0e83f459829a81ef15671dcd948` |
| Build receipt | `e744ef9a581898d2ff1ebf1811a33db03c4fcbcca413394118c4018bfeb04067` |
| Signed Native executable | `3364c40db0a0e3f97385d6f70e4346e9b770da319c181af040f518dd4e7a21fc` |
| Combined source offer | `71df74cbfb6567225a29210a6217fdedcd2762e7eaf89b1aae4289c0dfe53f16` |
| Retained server executable | `8af12e2a147f692a9ccc2f930da71da125cacc7b1930cba1464d043976d90f34` |

## Independent checks

- Rehashed the full review index and validated candidate/intent/evidence bindings. Compared the new update script with the previously reviewed control implementation: only operation ID, frozen source and required version differ; the public helper is byte-identical. Reran all **14 isolated contract tests**, including single-use execution, rejected/expired approvals, partial failure and separately approved rollback, unknown-byte rejection, cross-process lock, reconciliation evidence tampering, process-environment terminator parsing and safe source re-export.
- Recomputed the entire candidate manifest: **454 entries**, same inventory as baseline, exact changes limited to Native executable, combined source offer, Info.plist and CodeResources. All other content/mode/ownership/xattr records match. Candidate Info.plist bytes equal frozen Git; compared with the installed original, only version/build fields differ. Independently passed `codesign --verify --deep --strict`.
- Independently derived all **736 official source members** from immutable Git objects and compared every member's bytes with the combined archive and official-export evidence. The corresponding public build-source files also match frozen Git. Verified original retained server-source archive byte-for-byte, reviewed helper identity, and controlled full re-export with identical member-byte hashes in disposable files. The public README explains local Native/new versus retained server/Web provenance and complete versus inner-only source export.
- Verified signed Native/source hashes, production UI output hashes, package/Cargo locks and preparation-script binding against the build receipt. This local candidate retains the original server/Web files and does not claim to install the full official release bundle.
- Independently checked live baseline and runtime without business-body reads: PID **28102**, original server file identity/inode, exclusive **3210** listener, process start/argv/environment/cwd hashes, configuration/token hashes and absence guard, schema/version, and all **109 prior hashed session IDs** match. Current count was 109; future retention uses the prior-ID subset rather than a fixed count. New capture records independently match the prior unmodified baseline/runtime except capture timestamps.

The reviewed script holds an exclusive lock, requires fresh expiring separate apply/rollback approvals, stages on the same filesystem, writes durable submission state before individual replacements, and writes CodeResources last. It never renames the app directory, touches the retained server, signals/stops/restarts a service, or launches Native. It verifies complete final bytes/signature, preserved identities and runtime before a receipt. Reconciliation verifies all evidence bindings and never repeats replacements; partial or unknown outcomes require explicit review and, where applicable, a separate rollback approval.

This review did not exit/launch Native, log in, enable remote access, open a real workspace, mutate CI, or change an installed file. Production business data bodies were not queried.

## Local adoption followup: stopped attempt and fresh operation

The original `aab58841-9ac0-408b-a78f-9c413fe74aa8` apply stopped before durable submission with `STAGED_FILE_DIFFERS`. Independent read-only inspection confirmed `bound-awaiting-go`, no submission timestamp or receipt, all 454 installed baseline entries unchanged, Native absent at that inspection, and the retained service/runtime/configuration/schema/109-ID guards unchanged. Its one private staged Native file matched candidate bytes and every recorded field except group ID: actual `20`, expected `80`. `shutil.copy2` had not preserved ownership. The original four private backups also had group 20 rather than the baseline's group 80. The operation was permanently abandoned and its approval invalidated; it was never retried.

Root authorized a minimal private-script correction and fresh operation **`05917a0d-62ed-4ac8-8912-64019e9907de`**. The copy helper explicitly preserves source UID/GID without following a destination symlink, and backup capture/use now checks full recorded metadata rather than only byte hashes. Fresh backups were captured from the unchanged installed originals with the corrected copy function. The new candidate reuses the exact previously reviewed signed Native, combined source offer and full bundle content; no product recompilation occurred.

| New operation evidence | SHA-256 |
| --- | --- |
| Corrected update script | `8d7016fbb2a41a3e5ae5c4b685faf5339b6b2ccebd696b6ad1f20e519ccf3d0b` |
| New candidate manifest | `c877265b9ef9e5dec2855cd70ebab9e2d28899030f7d1f110c77b3254cc6f828` |
| Fresh baseline | `20cf1be62608f4f618459805997958d0dc9d286048dc842f4b1b9599c6dde5b9` |
| Fresh runtime capture | `b56419ec232b80469539531fdefd1bf607111740135ae051e7fee6e2b39b7702` |
| Reuse/build receipt | `beb5798e50d1921721cbae9e47778b189d49797e6cb35546a161c09bbd72a982` |
| Completed installation receipt | `835e67de4d6ab14d03e47bc9d7626ca11c40748d2a1ae0a1a480c3fca1544a02` |

The helper, official source, signed Native and combined source byte hashes remain those in the earlier table. The new receipt binds the original reviewed build receipt `e744ef9a581898d2ff1ebf1811a33db03c4fcbcca413394118c4018bfeb04067`.

The reviewer independently passed **16 synthetic contract tests**, including real different-group copying with modes and custom extended attributes, complete apply and partial-failure rollback fixtures with different ownership, and denied ownership change with zero installed replacements. Independently copied all four actual candidate components into disposable private files: bytes, mode, UID/GID and xattr records exactly matched. All four fresh backups also match the original full metadata. Every one of the new candidate's 454 entries has the same content/metadata as the prior accepted candidate; controlled corresponding-source re-export and strict deep signature validation passed again.

After fresh root computer-use confirmation, Native exit and a new exact approval, the author executed this new operation once and recorded completion. The reviewer then independently verified the completed intent and receipt hash, the installed whole bundle against the candidate, all preserved baseline identities, strict deep signature, Native hash `3364c40db0a0e3f97385d6f70e4346e9b770da319c181af040f518dd4e7a21fc`, and unchanged PID **28102**, port 3210 listener ownership, process/environment/argv/cwd identity, configuration/token hashes, schema/version and all 109 prior session-ID hashes. No business-body queries were used.

Root subsequently launched Native and reports fresh actual computer-use confirmation of the new introduction screen. Root additionally verified PID **33894**, executable `/Applications/AnyWork.app/Contents/MacOS/anywork-desktop` and the same Native hash. This GUI/process observation is root evidence; the independent reviewer did not launch or visually operate the app. No login, workspace open or remote-enable action was performed as part of this update.

This local installation updates Native to source a738 / 0.1.19 build 20 and retains the existing older server/Web and server inode. It is separate from the formal v0.1.19 release workflow: that later Intel Mac release job failed a database-lock lifetime test after Checks had passed, and no public Release was published. The official source/tag must remain immutable; a product ownership-release fix requires a new version. That release correction does not authorize replacing or restarting the retained local business service.
