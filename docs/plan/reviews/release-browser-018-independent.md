# v0.1.18 browser failure — independent trace review

## Verdict

Task: [mobile menu synchronization](../tasks/release-mobile-menu-synchronization.md).

Checks run `42820324352` failed for frozen source `f77299569e8a8109c43d3813c263cdcfa2eba339`. The failure is a concrete test synchronization race, not a failed directory-order assertion and not established external infrastructure instability. Do not retry this unchanged source as a known transient failure. No v0.1.18 tag or release was created. The accepted but unadopted v0.1.18 local Native candidate has been permanently abandoned without GO or apply. A fixture fix requires a new immutable release candidate; this review authorizes no replacement local installation operation.

## Evidence

Independently read the retained Playwright trace at `/tmp/anywork-release-018-browser/panels-menus-directory-gro-89d77--rather-than-alphabetically-android-web/trace.zip`, including action logs, DOM snapshots, network events and the final screencast. The failing case is `e2e/panels-menus.spec.ts:291`, Android Web directory grouping.

The initial service handoff, session creation, navigation and initial message-composer assertion succeed. After the first mocked reload, sidebar helper call `kcek@18463` checks for an open sidebar at monotonic time approximately `514953 ms`. Click `kcek@18467` starts at `514993 ms`, resolves the overview's `.mobile-menu` button at `515026 ms`, then logs that the element is not visible at `515054 ms` and repeatedly thereafter until the 30-second test deadline. No directory-group ordering assertion has started. Mocked list/session polling continues returning promptly throughout the wait, and the captured DOM contains the expected initial `zeta`, `alpha`, `middle` group order. The screencast shows the fully loaded conversation and its separate visible conversation sidebar button.

The source explains the stale target: the sidebar helper immediately checks `.sidebar.open` and clicks the accessible name `会话列表` without waiting for the reloaded conversation to finish loading. During this interval, that name resolves to the overview `.window-tabbar .mobile-menu`. When the selected session arrives, `.codex-shell > .main.has-session > .window-tabbar { display: none }` hides this retained DOM element; the conversation header supplies a different `.conversation-sidebar-toggle`. The click's actionability loop continues waiting on the retained hidden element. This is sufficient evidence of a fixture race; it does not require a product sorting change.

## Required correction

Synchronize the directory test with the loaded selected-conversation surface after each reload before requesting the sidebar. Keep real clicks and directory-order assertions; do not force clicks, skip cases or expand the deadline. Review the author's committed minimal change and actual targeted regression evidence before allowing a new release candidate. Native startup authorization, gateway behavior and the local installed service are outside this fix.

No runtime, account, installed bundle or frozen main source was changed during the independent trace review. The earlier candidate artifact report records preinstallation byte acceptance only; this CI failure blocks its adoption.

## Accepted fix and independent regression

Accepted exact author commit `a23d48809aeeb6ca660ecbb00694283a9bf2246c`. Its only executable change adds the existing message-editor-visible assertion after each of this test's two reloads, before calling `sidebar()`. This waits for the selected conversation rather than the temporary overview, preventing selection of the subsequently hidden menu element. Group order, newest-chat order, archived exclusion, post-activity reorder and reload coverage remain intact. There are no product, timeout, skip or forced-click changes.

Independently ran the exact committed directory-order test twice in each project: **4/4 PASS** across actual Chrome desktop and Android Web emulation. The reviewer used a separate owned port `3297`, disposable workspace/data/fixture processes, real local browser-ticket/cookie authorization, and the immutable production Web build exported from frozen f772 source. Its asset names match CI (`index-BWUHNMXg.js`, `index-DPJX8MUf.css`). The approved server fixture dependency was the earlier merged debug build, not a claim of a new f772 server compilation. The launcher omits HOME/USERPROFILE/CODEX_HOME and uses its own namespaced Codex data directory plus fake Agent binary. No real account or installed service was involved.

The author separately reports three passes of the original Android case. Independent results are under `/tmp/anywork-mobile-menu-independent-results`. The temporary reviewer configuration was removed and the owned listener was confirmed closed after the run. This source acceptance permits creating the new version's candidate; full trusted CI/release checks remain required before publication. It grants no local installation authorization.
