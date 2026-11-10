# Desktop onboarding merged-system checks

Date: 2026-11-10. Product changes accepted by the [independent review](desktop-onboarding-independent.md) were merged into `main`, with Native `87102db` / `88fea9b`, UI `aefd304` / `adaea57`, and publisher heading compatibility `0cba889`. The full check began at `0cba889`; the only tracked change during execution was the independent report, merged as `bad2a34`. Product code and test inputs remained unchanged.

`PLAYWRIGHT_CHANNEL=chrome ./scripts/check.sh` completed successfully on the Mac workspace:

- Production desktop UI and business Web builds passed.
- Workspace formatting, all-target Clippy with warnings denied, Cargo tests and the native build passed. Rust tests totalled 275 passed with seven existing optional tests ignored, including two desktop download/installation cases.
- Web unit tests: 350 passed in 37 files.
- All interface, history, service, account configuration, source export, publisher and release-gate scripts in the full check passed, including the real isolated desktop host HTTP tests.
- Browser regression: 647 passed in 19.3 minutes. One existing desktop-specific reference-layout case was skipped in the Android browser project; no new case was skipped.
- Desktop updater UI regression passed, including quiet failures/download, deferral, preferences, confirmation, stale-version rejection and explicit installation fixtures.

Separate merged-source `npm run format:check`, bilingual site build and the complete website browser script also passed. These checks did not use a real user OAuth session, enable remote access, install a package, stop the current service, or establish physical mobile/public-network acceptance.

Source implementation is complete with no open blocking findings. Exact-source GitHub Checks, immutable installer publication, Vercel deployment and independently reviewed local artifact adoption are subsequent delivery gates; this report does not claim those outcomes in advance.

The subsequent v0.1.17 source `a8a76f6` did not pass those remote gates: Checks run `42813746837` found a newly deprecated Rust atomic API on Linux stable and initialization failures in three Windows Python transport fixtures. Container and Android passed. No tag was created and the local v0.1.17 candidate was not adopted. The [release compatibility task](../tasks/release-compatibility-018.md) tracks the corrective source work and a fresh exact-source candidate; these remote findings do not retroactively change the Mac results above. An expired Vercel CI session credential was also refreshed separately; durable unattended publishing needs a dedicated deployment token rather than a CLI session token.
