# Desktop workspace layout live adoption

Date: 2026-11-10 (Asia/Shanghai). This is author evidence for the reviewed local Mac adoption after the production UI checks in [the author report](desktop-workspace-layout-author.md). Independent artifact and live verification passed separately.

## Candidate and exact changes

The Native release was built from immutable source `fa40ba19b5a3e7936d36e224f7cc2b62d47c363c`, with the matching public source offer. Build environment cleared inherited `VITE_`, `ANYWORK_` and `WORKBUDDY_` overrides. The production UI assets matched the reviewed build: `index-Fw6iJxXD.js` and `index-Cz8FTTSK.css`.

The fresh private candidate copied the prior accepted application resources and changed exactly three files: `Contents/MacOS/anywork-desktop`, `Contents/Resources/artifacts/anywork-source.tar.gz` and `Contents/_CodeSignature/CodeResources`. No server or business Web build ran. Signing used the app root without deep re-signing; strict deep verification passed. The server, provider, business Web files, Info.plist and all other bundle files retained their accepted bytes and modes. Source comparison against the prior installed source also showed no changes to Rust crates, business Web, Cargo inputs or build-desktop/Info/Bundle inputs.

| Artifact | SHA-256 |
| --- | --- |
| New Native executable | `4b042c31c5d04435839c0b4b6d1195877122123d26c296f2ebc5f98838aae063` |
| Matching source offer | `a1913b458f36a9214b08774effdea6a80ca491cca8e6439c5a3ae21b29e1520c` |
| Unchanged server | `8af12e2a147f692a9ccc2f930da71da125cacc7b1930cba1464d043976d90f34` |
| Unchanged cloudflared | `c647bfd58ab7fa562d47061853321eb78b7205b110a45fff8f3c53196f3986a5` |

## File-only adoption

Root checked the actual Native window was signed out with remote access off, then gracefully quit it. A fresh, expiring approval bound the independently reviewed script, common/build helpers, operation metadata, baseline and candidate. The adoption ran once and completed at 16:59:58.

The script backed up only the three changed program files, durably journaled each replacement, and atomically replaced those files inside the installed bundle. It did not rename or replace the application directory, server executable or Web resources. Ten isolated filesystem contract tests covered the exact delta and unchanged server inode, refused approval, running Native, replay prevention, copy failure and file rollback, unknown changes, symlink parents, prior pending files, and uncertain app-open outcomes.

The existing external service remained PID 28102 throughout. Post-checks verified its executable bytes, device/inode, exact process identity, arguments, working directory, entire environment fingerprint, listener, manager configuration, selected bearer bytes and permissions. Independent metadata checks retained all 108 original session-ID hashes, with 109 current IDs and unchanged schema. No service stop/restart request, process signal, environment substitution, data migration or database restore occurred. Configuration and business data were not rewritten by this operation.

The installed full file tree and strict signature matched the reviewed candidate. New Native PID 19611 ran the exact expected executable and hash. The durable adoption receipt reached `complete`; its SHA-256 is `1d6900d317f4550d1d508392546f6edb7446612124ace7b8a54e7f10b38ba8e8`.

## Actual Mac acceptance

Root inspected the actual installed Mac window: two columns, the saved local address, existing runtime workspace, primary open action and new working-principle explanation were present. Root clicked “复制本地地址” in the actual WKWebView, and the window displayed “本地地址已复制”. At 17:09:01, an immediate RAM-only comparison after a fresh click confirmed the OS clipboard exactly matched the saved bare local root address. Only the success boolean was reported; no clipboard contents were printed or persisted. The production clipboard API therefore worked on this Mac, and no Rust clipboard fallback was needed. Original clipboard contents were not read.

Root did not log in, enable remote access or open the real workspace during this acceptance. The operation changed the local Native UI only; it did not publish an installer, redeploy the website or change cloud services. The local bundle remains ad hoc signed, and this evidence does not claim a public signed/notarized release or physical mobile acceptance.
