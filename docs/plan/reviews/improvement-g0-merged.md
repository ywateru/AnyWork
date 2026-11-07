# G0 merged-source local verification

Date: 2026-11-07. Integration worktree: `codex/improve-g0-merged`, source at `fc3d14897b86670472cfa47b0ce622c4df5a7e3c`. Root main includes the accepted event-scope, file-save and release/container safeguards plus this test-only correction; subsequent root changes at this checkpoint are documentation only. Version remains 0.1.12. No production restart, release, native message or real account test was performed.

## Result and command boundaries

All registered local check stages have successful evidence after the specific corrections below. This is not a claim that the original `scripts/check.sh` invocation completed successfully in one run.

1. Initial full check passed desktop UI build, Rust format/Clippy/workspace tests, server/Web builds, 317 Web unit tests, and the HTTP/integration stages through desktop IPC. It stopped at one obsolete exact-response fixture in desktop-host HTTP: expected global poll JSON omitted the new `has_more` field. That run had 19 successful desktop-host cases and one fixture failure.
2. Test-only correction `fc3d148` retained the old event/cursor/authentication assertions, added strict complete-field/boolean checks and strengthened replay cursor checking. All 20 real isolated desktop-host HTTP cases passed. A different reviewer independently passed poll/watermark/replay/authentication and SSE replay cases (2 cases).
3. The previously unexecuted tail was run separately: goal editor 3, goal mode 6, review API 13, source export 4, release version 3, publisher 26, release CI 10 and container smoke-script 7 tests passed. Publisher mutations in these tests are mocked; they did not publish anything.
4. Full desktop/mobile browser regression passed **611 cases**, with **one existing intentional skip**, in 12.7 minutes. The subsequent updater command initially lacked the local `PLAYWRIGHT_CHANNEL=chrome` setting and could not locate bundled Chromium. A targeted rerun with that environment setting passed all updater UI checks; no browser assertions were weakened and the full browser suite was not needlessly repeated.
5. Separate format and bilingual site checks passed, independently run by the file/schema reviewer. Site checks covered English/Chinese at 1440/1024/768/390/320 widths, language negotiation/manual preference/deep links, release metadata ordering and DMG/ZIP fallback.

Workspace Rust results in the initial merged run: server **126 passed / 4 native tests ignored**, desktop **34 passed / 4 ignored**, SDK **5 passed**, Codex **3 passed**; workspace doc tests passed. The file HTTP cases actually exercised case and Unicode aliases on this macOS filesystem. These are local results, not Linux/Windows filesystem or physical crash acceptance.

Ignored integration artifacts hold the detailed logs: `artifacts/g0-merged-check.log`, `artifacts/g0-remaining-check.log` and `artifacts/g0-updater-check.log`. Accepted source reviews remain the authority for each module's boundaries:

- [Event scope](improvement-event-scope.md)
- [Conditional file saving](improvement-file-consistency.md)
- [Release and container safeguards](improvement-delivery-gates.md)

## Open gates

- Actual clean Docker build/run remains required. The local host lacks a working Docker daemon; seven mocked smoke-script cases are not a substitute. The new Checks container job must produce source/Web identity, authentication, non-root and persistence evidence at the pushed exact commit before I22 is closed.
- Live release authorization/publication boundaries were not exercised. No tag or new version is authorized by this verification record.
- I05a remains an isolated, blocked schema candidate pending token-boundary correction and exact-commit independent re-review. It is not included in the local merged-source results above.
- Full I05 backup/restore and the remaining G1—G4 issues remain open. This G0 verification does not complete the continuing improvement objective.
