# Web phone presence diagnostics: independent review

Reviewed frozen diagnostic commit `b67da93b9381ab85278cc769be7b0fdeb578fe9f` and continuous-browser-gate follow-up `6e36f197049c67355c26879a489efc91c5c5a70c`. Result: **accepted for safe diagnostics; no blocking product finding**. This is not a claim that the user's initial unknown presence has been fixed. That diagnosis still needs the affected page's new fixed stage/code and, when available, bounded HTTP status.

## Product and privacy contract

The screenshot's wording and controls belong to `web/src/AccountApp.tsx`, including when an older Android launcher opens the Web console in a Custom Tab. This review covers that Web path, separately from the accepted Native SDK recovery fix.

`accountPresence.ts::presenceFailure` allows only fixed stage/code values and integer HTTP statuses from 400 through 599. It does not render exception messages, upstream response bodies, received URLs, subjects or credentials. Account-record failures are distinguished from configuration, host-token authorization, console exchange and directory failures. The installed vendored SDK supplies the finer stages; the UI supplies a bounded fallback.

`AccountApp` clears the diagnostic on successful refresh and when starting a new directory effect. Cleanup aborts the former owner and suppresses its late result. An unsuccessful query retains unknown and disables Open workspace. The patch does not change login, token ownership, SDK authorization, configured endpoints, session exchange or polling policy.

The public connectivity anchor uses the validated HTTPS Grid root and the exact SDK configuration path, `/api/v1/console/auth/config?clientId=...`, with the configured SPA client ID URL-encoded. It opens a separate tab with `noreferrer`; application tokens are not put in its URL, request body or Authorization header. Public reachability is explicitly distinguished from account authorization. An ordinary navigation can still send that origin's own ambient cookies if a real browser has them; neither the link nor these fresh-context tests establishes a universal cookie prohibition.

## Independent focused verification

The unmodified frozen diagnostic files passed:

```sh
npm exec -w web -- vitest run src/accountPresence.test.ts src/accountGrid.integration.test.ts
```

Result: **23 tests passed in two files**. This includes allowlist redaction and actual vendored SDK HTTP classification: unreachable/timed-out configuration acquires no token or exchange, while a failed directory read does not replay the exchange POST.

The frozen browser script also independently passed all ten scenarios. After the gate follow-up, the final script was independently run again through its named root npm entry:

```sh
PLAYWRIGHT_CHANNEL=chrome \
  ANYWORK_ACCOUNT_PRESENCE_OUTPUT_DIR=artifacts/mobile-web-presence-independent/gated-final \
  npm run test:e2e:account-presence
```

Result: **10 scenarios passed: eight Pixel 7 phone emulations and two English desktop scenarios**. These load actual `AccountApp`, the installed Logto client and the actual vendored Grid SDK; only grants/storage and HTTP responses are synthetic. Coverage includes healthy presence, configuration network/binding failures, token failure, exchange rejection, directory network/shape failures, account-record failure and explicit-refresh recovery. The phone diagnostic screenshot was also inspected for readable wrapping.

All eight failure scenarios actually click the public link and assert a new-tab HTTP 200, GET, exact origin/path, a sole `clientId` query field, no request body, and no Authorization, Cookie or Referer in `allHeaders()` for the fresh fixture. They also verify `window.opener === null`. Public success leaves the original diagnostic and disabled target intact. No private synthetic grant or response body is displayed.

A separate unauthenticated GET of the current default production public URL returned **200**, with no redirect and a matching client binding. Only fixed metadata was retained, not its response body. This establishes host-side public reachability only; it does not establish connectivity on the affected phone's network, authenticated production exchange, real device presence or a native Android provider's behavior.

## Continuous gate and final scope

At frozen `b67da93`, `npm test` included the new Vitest files but did **not** invoke the standalone browser script. The existing general/mobile Playwright suites did not invoke it either. The script's original default Chrome channel also differed from CI, which installs bundled Chromium. These were concrete validation gaps, sent to the author and corrected in the follow-up.

The follow-up adds root `test:e2e:account-presence` and invokes it directly from `scripts/check.sh` beside the existing e2e commands. The `server-web` Checks job installs bundled Chromium before running that script, and `set -e` propagates failure. The browser script now defaults to the Playwright bundled browser, permits an explicit local channel, closes its server/browser in `finally`, and allows an isolated evidence directory. Thus this coverage is a persistent required gate rather than a local-only command.

The local machine did not have the matching bundled Chromium executable; the independent run explicitly used installed Chrome. CI's bundled-browser execution was verified by its configuration and has not been executed remotely by this review. Lightweight shell syntax, changed-file formatting and `git diff --check` also passed. No broad regression, native application test, deployment or remote write was performed.

Accept these diagnostics for website deployment while keeping the existing v0.1.34 release binaries and 20-asset metadata unchanged. Do not describe this acceptance as locating or fixing the reported phone's root cause. No real login, user credential/account store, original session or device was accessed. Local synthetic screenshots, JSON and command evidence remain ignored under `artifacts/mobile-web-presence-independent/`.
