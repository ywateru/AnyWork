# Unified Web production deployment report

This is the Web publisher's deployment and live verification report. It records the approved static production publication and checks against the formal domain. It does not replace independent review or authenticated Native/mobile acceptance.

## Published identity

| Field                             | Recorded value                             |
| --------------------------------- | ------------------------------------------ |
| Formal homepage                   | <https://anywork-tau.vercel.app/>          |
| Formal account/device entry       | <https://anywork-tau.vercel.app/app/>      |
| Frozen source                     | `113ddba1433e6437f73bdfebc6a4ea1d6e2fa74f` |
| Application version               | `0.1.13`; no release/version bump          |
| Deployment                        | `dpl_4oLgPXaayTg2SLBwPETAEqpKVxor`         |
| Operation                         | `31796362-a34d-477b-b371-dcbb052b559b`     |
| Previous production deployment    | `dpl_CV59TUfcxyfELrRyHUvHELcmkoT8`         |
| Project                           | `prj_LpMd1SfQU8GokkNUIJZk9wfJIELK`         |
| Team                              | `team_2ljUqxKg8oifxof0IT3yayWz`            |
| Submission time                   | `2026-11-10T13:03:15+08:00`                |
| READY observation                 | `2026-11-10T13:03:37+08:00`                |
| Formal alias provider observation | `2026-11-10T13:07:54+08:00`                |

The provider's alias record bound `anywork-tau.vercel.app` to the deployment above in the expected project. Its deployment record was `READY`, target `production`, with operation, source, configuration and artifact metadata matching the reviewed candidate. The formal domain's `/build.json` independently returned the frozen source and version above.

## Submission and artifact evidence

The reviewed publisher rechecked the previous formal alias binding and public build before submission. It durably recorded `submitting` before executing exactly one pinned Vercel CLI `50.28.0` production submission. The resulting operation is `observed` and `READY`; no second upload or retry was submitted. Provider reconciliation remains read-only for this operation.

The upload contained 446 files and zero server functions. Only the sanitized prebuilt output and project binding were uploaded; local CLI credentials, environment secrets, dependency installations and private operation records were outside the upload.

| Reviewed item             | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| Upload collection         | `6644fac07270833d21fb6e8aee1c23c9d01bfce23edfde24c922a31db99ecd80` |
| Public configuration      | `7902059c9e6cd3a40709347bce82d917fc346b691b539798b39274af4459d58c` |
| Exact-source archive      | `b34588b2adde46285b73328569fb0980a869e58ac197fa557c08fe3529daeca8` |
| Candidate artifact record | `e5b33c94cfbcf6c665f7b058bde0f95ecfc0421f4fc9cf81e7ed5632f1d5d840` |
| Reviewed publisher        | `5749d3f8d5382f1b7644ccdfc864bdaf7364831347b087c32b22c29632186623` |

The operator's private evidence directory is `~/.config/anywork-cloud/frontend-unified-31796362-a34d-477b-b371-dcbb052b559b/`. It contains `intent.json`, `candidate-artifact.json`, `submit-receipt.private.log`, `live-alias-check.json`, `live-bytes-check.json`, `live-browser-check.json`, and the consolidated `production-receipt.json`. The consolidated receipt records the hashes of the individual evidence files and screenshots. These private records are not part of the public source or static upload. The older completed publishing operation was not reused or modified.

## Checks against the formal domain

All twelve checked routes returned HTTP 200: `/build.json`, `/`, `/zh/`, `/en/`, `/app/`, `/app/callback`, root and `/app/` variants of both `agents/codex-light.png` and `agents/codex-dark.png`, `/source`, and `/anywork-source.tar.gz`.

- All four agent image responses had the PNG signature and `image/png` content type. Their complete byte hashes matched the reviewed static files, addressing the reported missing image path rather than accepting an HTML fallback with status 200.
- Both source download routes matched the exact reviewed source archive hash above.
- The checked responses included `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Their CSP used the approved self-hosted Logto endpoint `https://auth.x.aixgg.com` and CyberGrid endpoint `https://anywork-cybergrid-selfhost.vercel.app`.
- `/build.json` served source `113ddba1433e6437f73bdfebc6a4ea1d6e2fa74f`, version `0.1.13`.

Fresh isolated Chrome contexts exercised the actual formal domain at widths 1440 and 390. At each width the account entry and Chinese/English homepages rendered without page exceptions, failed network requests, broken loaded images or horizontal overflow. The account entry displayed login and registration, with no server-address/token fields. A synthetic obsolete `ra.connection` entry was ignored and caused no request to its synthetic address. The bilingual public-installer limitation note was visible. No real browser profile, user SSO session, credentials or account data were used.

Screenshots in the private evidence directory:

- `live-app-1440.png` and `live-app-390.png` — formal account entry.
- `live-home-zh-1440.png` and `live-home-zh-390.png` — Chinese homepage.
- `live-home-en-1440.png` and `live-home-en-390.png` — English homepage.
- `live-home-zh-1440-top.png` and `live-home-zh-390-top.png` — unscaled top-of-page inspection crops.

The publisher visually inspected the account entry and Chinese homepage at both sizes. These screenshots show public entry pages and a clearly labeled homepage device demonstration, not authenticated live device discovery.

## Validation limits and remaining platform evidence

This production check establishes deployment identity, static response bytes, security headers and public entry rendering. It did not perform production login/registration, same-owner device discovery, encrypted workspace access, sustained authorization renewal, logout, account switching or Native disable against the public deployment. Independent authenticated integration results must identify their own exact Native build and environment; they cannot be inferred from these public page checks.

The implementation's isolated browser regression evidence remains separate: the frozen broad run recorded 570 passes, one existing skip and one test-only completion-toast assertion failure. A test-only correction then passed the affected case in both desktop and Android-web projects against the same frozen production assets. This is not a claim of a single clean 572-case run. Unit/type/build/site and Android build/lint/unit gates were recorded separately before publication.

Chrome's 390-pixel viewport is responsive Web evidence, not physical Android evidence. No modern physical Android phone, cellular network, real-device Custom Tab login/return flow or device installation was exercised by this publisher. Emulator or synthetic-account results from another reviewer must be reported separately and do not establish physical-device acceptance.

The Web publication did not publish a new Native installer, install or restart a Mac client, change the user's running service, or complete the full public Web-to-Native workflow. Existing public installers remain the earlier release and do not yet include this account connection update; the deployed bilingual download note states this limitation. A privately built updated Native candidate and its isolated tests are not a public Native release. Full public Native acceptance and installer publication remain separate actions.

The independent reviewer was notified of the exact production deployment for separate live acceptance. This report records the publisher's evidence only; no independent approval is asserted here.
