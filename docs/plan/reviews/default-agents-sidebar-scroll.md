# Default Agents and sidebar scrolling — independent review

Accepted product commits:

- `f80f9175fd5517b6f86ce23607c772a849ddb69f`: default integration registration, connection metadata/chooser and WorkBuddy discovery-path compatibility.
- `53a8029b4acbcda95f0c61d4732a57ca872c430d`: bounded sidebar scrolling and contained accessible row labels.

No blocking findings remain. Review and checks used the developers' isolated worktrees and temporary fixture services; no production host, prompt, account configuration or tunnel was changed by this review. This report accepts the two requested fixes, not the previously open native WorkBuddy writing/collaboration acceptance gate.

## Contract review

The catalog always registers Codex, DeepSeek Harness and WorkBuddy, including the no-HOME case. Availability describes a configured entry that may be attempted, not a live connection. Catalog projection whitelists public fields and does not connect to either native host. Missing/invalid discovery leaves the integration visible with an actionable setup hint. Native command and descriptor validation remain in place. The new-session chooser preserves deliberate selection, blocks unavailable creation including keyboard submission, supports older catalogs without availability metadata, and can recheck after setup. Request sequence and server-identity guards prevent stale catalog replacement.

The WorkBuddy launcher observes both supported DevToolsActivePort locations before launch, accepts only a changed file, rejects ambiguous fresh entries and symbolic-link paths, and retains browser identity, renderer, local-only transport and no-replace descriptor ownership checks. It never terminates the desktop during launcher cleanup. Source compatibility tests use a fake bundle only; no installed-app write was attempted.

The sidebar fix gives each session row a containing block for its absolute accessible label. This addresses the actual document-overflow source rather than hiding the page. Sidebar/list minimum-height constraints and list overscroll containment keep scroll ownership local. Root overscroll behavior applies only while a conversation shell exists; login/body scrolling is not globally locked, and the sidebar itself remains unclipped so anchored menus stay usable.

## Independent verification

| Check | Result |
| --- | --- |
| Web typecheck in both exact-commit worktrees | passed |
| Fresh out-of-tree Web builds, including PWA generation | passed |
| Agent selection/sidebar unit tests | 8 passed |
| WorkBuddy launcher isolated tests | 15 passed |
| Isolated real-server default catalog tests | 2 passed |
| Server Rust tests | 91 passed, 2 explicit native opt-in tests ignored |
| Sidebar browser run: boundary/short/empty plus existing filter/menu/draft coverage | 24 passed across desktop and Android Chrome |
| Default-agent browser run: disconnected/legacy/stale-initial-catalog plus existing filter coverage | 24 passed across desktop and Android Chrome |

The two browser runs repeat the same 18 existing filter cases: there are 30 distinct accepted browser cases, with 48 successful executions. Sidebar coverage includes 80 directory groups, actual wheel and CDP touch gestures at both list boundaries, the final visible chat, invariant document height/scroll position, fixed controls, empty short windows and anchored menus. Independently inspected short desktop/mobile screenshots show no viewport overflow or blank area. Headless Chrome does not render native Safari elastic scrolling; explicit scoped overscroll styles were checked in addition to the measured geometry and gestures.

Independent artifacts: `/private/tmp/anywork-scroll-review-dist`, `/private/tmp/anywork-scroll-review-results`, `/private/tmp/anywork-default-agents-review-dist`, `/private/tmp/anywork-default-agents-review-results`. Browser services used ports 3261 and 3262. Production `web/dist` was preserved.
