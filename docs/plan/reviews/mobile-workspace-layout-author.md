# Android connected workspace layout — author verification

2026-11-16. Base: `15f5c3faff20dfa85fb1f092cf686fe62afec492`. Scope is the existing bundled Android workspace UI, after connection through the real MobileApp → App → NativeTransport call chain with synthetic native replies. Persistent login belongs to a separate lane.

## Cause and minimal correction

`web/src/mobile/main.tsx` imported style/codex/agent-os/documents/conversation styles but omitted `desktop.css`, which the ordinary Web entry loads between agent-os and documents. Despite its filename, this sheet owns the current shared App navigation layout, session rows, Agent image bounds and light/dark image selection. Mobile CSS is an incremental override, so it cannot supply that missing baseline.

The supplied phone screenshot was reproduced using a synthetic signed-in account, connected computer, Codex images and multiple sessions: “新会话” wrapped onto three lines, the search icon/input stacked, both light/dark Agent images appeared at intrinsic size, and unstyled details markers/gaps dominated the list. The new regression failed on the original source with a measured 72px label height instead of one line. This is a bundled entry stylesheet omission, not an account/transport failure or a request for a new visual design.

The fix loads the same shared stylesheet in the mobile entry, before mobile overrides. It does not change `desktop.css`, shared App/controller code, account DTOs or Native code. In the mobile scope only:

- Navigation and directory toggles retain the intended left alignment, overriding the generic `.mobile-client button` centering.
- The old 64px target was incorrectly attached to `.session-item`; SessionSidebar actually renders `.session-row`. The corrected selector restores the existing mobile row target above the shared 38px narrow-screen baseline.
- Directory heading/toggle and filter/add controls accommodate 48px touch targets without overflowing their old desktop-sized slots.

The screen structure remains the existing mobile design:

```text
< 工作区 / computer                        通知  设置
  新会话
  搜索会话
  所有 Agent                              v
  会话                               筛选  +
  v 工作目录                               +
    [18px Agent] 单行省略会话标题          时间
    ... independently scrolling session list ...
```

## Fixtures and regression boundaries

`e2e/mobile-native.spec.ts` now has an optional mixed-workspace fixture: 25 sessions, two directories, long Chinese/English titles and all five branded Agent identities. Existing tests keep their original single-session fixture. No real account, Agent, computer API, production coordination service or saved credential is contacted.

Two new cases cover:

1. Connected list at 320/360px light and 412px dark: horizontal new-session label/search, bounded and loaded Agent images, exactly one Codex theme image, 64px rows, 48px controls, list scrolling, directory expansion, search/clear, Agent filtering and opening/closing the real create-session dialog without issuing POST. Native top/bottom insets are applied once: chrome starts at 24px and the list ends at viewport height minus 24px.
2. Connected history/composer, 740×412 landscape, injected native IME inset, file document and terminal. Composer stays above the 280px IME boundary, the session list stays hidden in conversation mode, tools remain available and the document has no horizontal overflow.

These are added to the existing mobile-native spec, already collected by `e2e/mobile.config.ts` and the mobile CI gate; no assertions are skipped and no production gates are weakened.

## Executed verification

- TypeScript: `node <root>/node_modules/typescript/bin/tsc --noEmit` from `web/` — PASS.
- Full mobile development-entry suite with installed Chrome: **33 passed**. It includes native bridge, approval/question identity, receipt/replay guards, save/share/PDF, dirty-file navigation, terminal, four destructive-contrast cases and image-portal rotation/IME checks.
- Actual **MOBILE production entry** build using `web/vite.mobile.config.ts` — PASS. A private wrapper changes only Vite cache location, and CLI `--outDir` points outside the worktree. This builds `mobile.html`, not the ordinary Web entry.
- Against Vite preview of that production output: **6 passed** — both new connected-layout cases plus full App upload/save/share/back, dirty-file back, terminal/native Channel and pending-approval back/identity cases.
- Relevant Prettier and whitespace checks — PASS.

The first complete dev pass had 32 passes and one new fixture failure because the create-session dialog exposes “关闭”, not “取消”. The locator was corrected, preserving the close/no-POST assertions; the final full run passed all 33. The original-source CSS regression remains recorded separately, rather than being confused with that fixture correction.

Actual production output under `artifacts/mobile-workspace-layout-author/dist-mobile/`:

| Entry asset                  | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `assets/mobile-DJgsUBCs.css` | `da26c24bc67631305be0d7ae173f917e9138fb95e8b9ee63f1da0e4567f9339a` |
| `assets/mobile-CKzmDhlQ.js`  | `b59177689376947854a47a1aa2e1ba52b5e12e2ac0d08b65390a04108f5e5921` |

## Reproduction and evidence

All private evidence is under root `artifacts/mobile-workspace-layout-author/`, not committed or served publicly. `playwright.dev.config.ts` and `playwright.built.config.ts` point at this isolated worktree, private outputs and port 3427. They use the installed Chrome channel; no browser or dependency installation was required. The built configuration uses `vite preview` against the private MOBILE dist. Reviewers can replace its worktree/output/port paths with their own.

Commands used (from repository root unless noted):

```sh
node node_modules/@playwright/test/cli.js test --config artifacts/mobile-workspace-layout-author/playwright.dev.config.ts
# From this worktree's web/:
node <root>/node_modules/vite/bin/vite.js build --config <root>/artifacts/mobile-workspace-layout-author/vite.private.config.mts --outDir <root>/artifacts/mobile-workspace-layout-author/dist-mobile --emptyOutDir
# Production MOBILE preview, only cases independent of /src runtime imports:
node node_modules/@playwright/test/cli.js test --config artifacts/mobile-workspace-layout-author/playwright.built.config.ts --grep 'connected workspace|full App uses|native back protects dirty|terminal reaches|native back leaves approval'
```

- `before/`: original-source failing trace and `workspace-320-light.png`, reproducing the supplied phone screenshot.
- `dev-final.log` / `dev-final-all/`: full mobile suite result and screenshots.
- `built-final.log` / `built-final/`: production-MOBILE screenshots for 320/360/412 list states, Agent filtering, conversation, landscape, IME, document and terminal; bounds JSON attachments cover the exact measured controls/insets.
- `bundle-binding.json`: entry CSS/JS hashes and the mobile input file hashes, binding the private bundle to the reviewed source.

No APK, AVD or physical phone was operated in this lane: the failure was reproduced and corrected in the actual bundled MOBILE build, with native bridge/inset fixtures. Actual phone activity remains coordinated through Nash. This report does not claim fresh Native/physical-device acceptance. Independent review remains required before merge/release. There were no production, host, Agent, credential, publisher or deployment mutations.
