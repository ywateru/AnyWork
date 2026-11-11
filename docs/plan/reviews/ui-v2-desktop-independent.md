# UI v2 desktop independent review

Date: 2026-11-11. Result: **pass**. No candidate findings requiring a blocking or non-blocking follow-up.

Candidate: `4be6ef378074487d8c2736f2f63a01eb4a36b899`, reviewed in `/Users/water/work/2026/any-work/.worktrees/ui-v2-desktop`. HEAD matched the supplied candidate and tracked files were clean before and after verification. The verifier did not alter author code.

## Source and integration review

- The desktop candidate stays within its assigned UI/E2E/updater-test paths. `useWorkspacePreparation` and Native source are unchanged. An independent TypeScript AST extraction confirms `useAccountController` is byte-identical to its parent. The controllers remain mounted above page navigation, preserving default-remote attempt ownership and the current grant across navigation.
- The shell uses `brand.ts`'s canonical `web/public/icon.svg` import. The local panel contains one readiness status, its open action, saved-snapshot loopback address, copy action, first-open explanation and directory. There is no address disclosure or additional address card. The only console title is in the titlebar; sidebar remote access is navigation without a duplicate status summary.
- Config editing uses separate draft and saved state; polling does not overwrite a dirty draft. All settings-to-other-page navigation uses the same continue/discard confirmation, including titlebar back. Successful saves update only the submitted config field group. Native snapshots drive the public address, never an unsubmitted port or browser handoff ticket.
- Unknown local/account observations disable new actions rather than inferring readiness. Unknown remote state removes the switch, and malformed activity does not become zero. Activity disclosure starts collapsed. Remote shutdown confirmation keeps the existing remote action controller and rejects a changed owner; manual shutdown and failure paths keep the established default-once Native command.
- Stop remains restricted to an owned service and invokes the existing Native refusal boundary. An external service has no stop action. Update controls suspend on unavailable updater observations; install stays explicit, checks the prepared version again, and retains Native busy/unknown refusal rather than inventing an idle result.

## Independently executed checks

| Check | Result |
| --- | --- |
| `npm run build -w anywork-desktop-ui` | Passed, including TypeScript no-emit check |
| Desktop project: `desktop-v2.spec.ts` and `desktop-tunnel.spec.ts` | All 20 cases passed on isolated port 3325 and `/tmp/anywork-ui-v2-independent-desktop/e2e` |
| `desktop-overview.spec.ts` selected actual 960 × 720, 800 × 620 and 390 × 844 layout flows | All 3 passed: intro → account → preparation failure/retry → console → settings; no horizontal overflow and primary console controls in viewport at desktop sizes |
| `PLAYWRIGHT_CHANNEL=chrome node scripts/desktop-updater-test.mjs` | Passed: quiet download/error, defer/preferences, explicit confirmation, stale version rejection, unknown suspension, Native busy refusal and install |
| `PLAYWRIGHT_CHANNEL=chrome node desktop/ui/scripts/account-entry-check.mjs` from repository root | Passed: retry, separate official account screens, pending cancel race, identity/reauth and safe enable-stage controls |

The 20 behavior cases cover default remote after login, manual-off persistence, failure without blocking local open, portal actions preserving remote failure, pending enable with settings/logout, signed-out late results, unsupported platform, live activities rather than historical clients, malformed/unknown status, keyboard disclosures, fresh status after preparation, settings drafts/save/discard, external reuse, owned stop cancel/focus/refusal and no writes on unknown observations. They run the built UI against a strict synthetic Native bridge. They do not exercise real cloud credentials, OS IPC, service stop or update installation.

## Visual review

Actual built desktop UI was captured in Chrome without a prototype wrapper. The following screenshots were inspected: canonical logo, local panel information hierarchy, remote summary, sidebar reduction and narrow wrapping are consistent with the v2 design. Settings scrolling at 800 × 620 remains usable and does not create horizontal overflow.

- [Console 960](ui-v2-desktop-previews/console-960.png), [800](ui-v2-desktop-previews/console-800.png), and [390](ui-v2-desktop-previews/console-390.png).
- [Settings 800](ui-v2-desktop-previews/settings-800.png), with privacy disclosure deliberately expanded by the keyboard/layout test.

## Verification limits

The existing `test:account-entry` npm workspace shortcut resolves its fixture dist path relative to the workspace directory and therefore fails with an extra `desktop/ui` prefix; the same working-directory assumption exists in the parent version. The established root-level Node invocation above passes. This is a pre-existing test-entry limitation rather than a regression in the reviewed UI candidate.

Merged-system checks, full project E2E and release checks remain the integration gate. This independent review does not claim hardware, real-account remote transport or a production update installation was exercised.
