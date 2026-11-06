# Merged WorkBuddy experimental integration checks

Product merge: `c079f74` on local `main`. This report records merged-system checks separately from the independent [backend](workbuddy-backend.md) and [UI/launcher](workbuddy-ui.md) reviews. The underlying feature remains experimental: actual installed native writing and same-desktop collaboration are not accepted yet.

| Check | Result |
| --- | --- |
| Web TypeScript and formatting | passed |
| Web unit suite | 308 passed |
| Out-of-tree Web production build | passed; production `web/dist` preserved |
| Rust workspace formatting, Clippy with warnings denied, tests and build | passed; native opt-in tests remain explicitly ignored in the automatic suite |
| Launcher tests | 11 passed |
| Source export / version checks | 4 / 3 passed |
| Existing service integration scripts | all 11 passed |
| Full WorkBuddy Chromium/CDP carrier fixture | passed; deterministic native preload substitute |
| Desktop updater UI | passed |
| Complete desktop/mobile browser coverage | 577 distinct cases passed, 1 platform skip; 6 PWA cases passed after correcting the isolated build, as recorded below |

Service integration scripts cover integration, service-control, editing, discovery, shared-control, desktop-bridge, desktop-ipc, desktop-host-http, goal-editor, goal-mode and review. They used temporary fixtures and their own services. Browser checks use a separate temporary server and `/private/tmp/anywork-workbuddy-main-dist`, with output in `/private/tmp/anywork-workbuddy-main-e2e`; no production service or Web output is replaced.

The initial 578-case browser run finished with 571 passes, 1 platform skip and 6 failures. All failures were the desktop/mobile PWA-update, offline-shell and deferred-syntax-cache cases. The orchestrator's out-of-tree build had run Vite but omitted the normal `web/scripts/pwa.mjs` step, leaving no Service Worker or app-version metadata. This was a test-artifact preparation error; product source and assertions were unchanged. After generating PWA assets in the same temporary build, all 6 affected cases passed in a fresh run on port3249. Initial traces and logs are retained; the corrected run is recorded in `/private/tmp/anywork-workbuddy-main-pwa-e2e.log`. No full-suite single-run pass is claimed.

Equivalent isolated production preparation and the affected-case rerun:

```sh
npm run typecheck -w web
npm exec -w web -- vite build --outDir /private/tmp/anywork-workbuddy-main-dist
node web/scripts/pwa.mjs /private/tmp/anywork-workbuddy-main-dist
ANYWORK_E2E_PORT=3249 \
ANYWORK_E2E_WEB_DIR=/private/tmp/anywork-workbuddy-main-dist \
ANYWORK_E2E_OUTPUT_DIR=/private/tmp/anywork-workbuddy-main-pwa-e2e \
PLAYWRIGHT_CHANNEL=chrome npx playwright test \
  --grep 'updates are nonblocking|syntax assets cache only after use|PWA keeps the shell'
```

The unchanged installed WorkBuddy 5.9.3 passed isolated preload/list/public-model and native get/create error-projection checks during independent acceptance. Its fresh signed-out repository rejects creation for a missing user ID, and its partial catalog is not accepted as a complete empty result. No native prompt was sent. Native history, text/image sending, approvals, cancellation, reconnect and desktop collaboration must still be accepted with a normally initialized dedicated WorkBuddy configuration. A local model alone does not remove that upstream account prerequisite.

Both implementation worktrees were clean and removed after their independently reviewed commits merged. Original WorkBuddy PID46809, AnyWork PID25254 on port 3210 and the pre-existing tunnel PID46384 remained running. No version bump, publication or production replacement is part of this source integration.
