# UI v2 production independent acceptance

Date: **2026-11-12, Asia/Shanghai**. Result: **pass**. No blocking or non-blocking findings in the reviewed public Web entry, source offer, immutable Release metadata or download links.

Accepted version: **0.1.26**. Exact deployed and tagged source: `c8fcb717f835bd903cf8c2d4bf37ff26fd240e8f`.

- [Stable Release v0.1.26](https://github.com/ywateru/AnyWork/releases/tag/v0.1.26), published at 2026-11-12 11:04:03 Asia/Shanghai.
- [Exact-source Checks](https://github.com/ywateru/AnyWork/actions/runs/43141374588), [Release workflow](https://github.com/ywateru/AnyWork/actions/runs/43143859381) and [post-release website deployment](https://github.com/ywateru/AnyWork/actions/runs/43145655894) completed successfully for that source.
- Formal [account entry](https://anywork-tau.vercel.app/app/), [English downloads](https://anywork-tau.vercel.app/en/), [Chinese downloads](https://anywork-tau.vercel.app/zh/) and [source offer](https://anywork-tau.vercel.app/source) independently checked.

## Actual public browser checks

Fresh isolated system Chrome contexts rendered the real production pages at **1440×960** and **390×844**, with Chinese locale and no persisted user grant. Both entry and hosted-page screenshots were visually inspected.

| Surface | Independent result |
| --- | --- |
| Formal `/app/` | One canonical brand and one login title, single content column, no empty sidebar or repeated outer bar; no horizontal overflow; AnyWork itself collects no credentials |
| Actual login button | Reaches `https://auth.x.aixgg.com/sign-in` at both widths, through the production OAuth entry |
| Hosted login | Canonical icon loaded; main button background `rgb(23, 23, 23)` and white text; usable single-column form, no horizontal overflow; original Logto pale background and footer remain |
| Runtime errors | No page errors during either public entry-to-hosted flow |

No username or password was entered, no hosted login form was submitted, and no real account or device data was accessed. The browser checks exercised the public OAuth entry only. They did not authenticate a user or establish a remote workspace connection.

The deployed `/app/icon.svg` returns HTTP 200 with `image/svg+xml` and is byte-identical to the committed canonical `web/public/icon.svg`. SHA-256: `2e697e060d2129a9f5126fe9f280daf6d11b05ab91a1aa680a47dc182c2ebdbd`.

## Build identity, coordination health and source offer

- `/build.json` independently returned HTTP 200, `Cache-Control: no-store`, source `c8fcb717f835bd903cf8c2d4bf37ff26fd240e8f` and version `0.1.26`. A final read after Release completion confirmed the same exact identity.
- `https://anywork-cybergrid-selfhost.vercel.app/healthz` independently returned HTTP 200 and `ok`.
- Formal `/source` and `/anywork-source.tar.gz` serve identical archive bytes. Independent read-only archive inspection compared **all 790 public source files** with the exact commit's Git objects: every byte matches. The archive has 791 entries including `SOURCE_MANIFEST.json`.
- The checked source-offer archive SHA-256 is `1f5ea6b719eb9b317352b50ec20233f9824eec5167a95845e76c53e82baf8638`. This is the deployed exact-source offer; separately built Release archives may have different packaging metadata.

## Immutable Release and download checks

After the existing publisher and Release workflow completed, the verifier ran the authorized read-only command `python3 scripts/publish.py --verify-existing v0.1.26`. It returned `verified: true`, the expected full source SHA and the formal website. No publishing, workflow retry, tag or configuration mutation was invoked by the verifier.

| Gate | Independent result |
| --- | --- |
| Stable version/tag | Published, non-draft, non-prerelease `v0.1.26`; tag resolves to the exact accepted source |
| Asset inventory | Exactly **20 expected assets**, nonempty and uploaded, with exact immutable download URLs and SHA-256 metadata |
| Checksums | Exactly **19 entries** in downloaded `SHA256SUMS`, covering every other asset; every entry agrees with its GitHub asset digest |
| Updater manifest | `latest.json` version `0.1.26`, exactly **5 targets**: `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`, `linux-x86_64`, `linux-aarch64` |
| Updater signatures | Target URLs point to the matching immutable artifacts; downloaded `.sig` files agree with manifest signatures and bind to version `0.1.26` |
| Installer availability | All six installer HEAD sizes agree with published asset sizes, including both macOS DMGs |
| Formal release metadata | `/release.json` advertises `v0.1.26` and all 20 asset names, sizes and URLs agree with the immutable Release |
| Bilingual downloads | `/en/` and `/zh/` embed `v0.1.26`, include all six installer links, and every declared asset link points to the corresponding exact Release asset |

The verifier also saved the Release API response, updater manifest, checksum file, both final language pages and formal release/build metadata, then independently parsed their counts, target set, digests and download links into `release-check-summary.json`.

## Local UI evidence and acceptance limits

The short-height correction was independently accepted at committed `148f380b1fa7404b2d7f3cb0d37cf9e6ad8e5ee2` before merge; see [short-height review](ui-v2-web-short-height.md). The unchanged full sidebar suite passed all 6 Desktop/Android cases in 44.2s; Android 390×480 passed in 19.9s under its original 45-second timeout. The independent list measured 192px with 6734px content and a first trusted native touch advance of 145px. Short-height device/account menus, switch cancellation, safe-exit cancellation/focus and confirmed logout passed. App's 86 pre-render statements remained byte-identical to the previously accepted Web candidate.

Device-directory and connection ownership evidence uses real AccountHome/AccountStore with synthetic OAuth/Grid/remote-transport boundaries. It does not demonstrate an authenticated production device listing or real encrypted remote session. Public Release verification compares published digests, downloaded metadata and installer HEAD responses; it does not download and rehash every large installer or install an update. CI and desktop/mobile browser projects do not imply physical mobile, cellular-network, hardware or installed-upgrade acceptance. Existing service processes and user data were not operated on by this verifier.

## Evidence and operational note

Independent evidence is retained in the main checkout's ignored `artifacts/ui-v2-independent-production/`: `public-check.{json,log}`, four `entry-*`/`hosted-*` screenshots, `site-source-check.json`, `site-source.tar.gz`, `source-route.tar.gz`, `verify-existing.log`, `release.json`, `release-run.json`, `release-check-summary.json`, `latest.json`, `SHA256SUMS`, `final-build.json`, `final-site-release.json`, `final-{en,zh}.html`, `acceptance-status.json` and `final-report-draft.md`. Earlier correction evidence remains in `artifacts/ui-v2-independent-short-height/`.

The first direct Node public request encountered ECONNRESET; the complete browser run passed through the machine's existing proxy route. That initial network-path failure did not exercise a product failure.

Root reports that the initial Vercel attempt failed because the previous GitHub-secret token expired; an existing CLI refresh restored authentication, the existing secret was synchronized, and the original workflow retry succeeded. Root also reports the replacement OAuth token's **eight-hour lifetime**. This deployment credential lifetime needs durable follow-up and is recorded separately from acceptance of the deployed UI. The verifier did not inspect or change that private credential flow, and no token material is retained here.
