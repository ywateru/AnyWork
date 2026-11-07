# Default Agents and sidebar scrolling — merged checks

Product merged to local `main` at `056b574`, following the [independent exact-commit review](default-agents-sidebar-scroll.md).

Merged validation passed:

- Web TypeScript, Prettier, all 309 Web unit tests, and a fresh out-of-tree Vite production build including PWA generation.
- Rust workspace formatting, Clippy with warnings denied, workspace tests, and debug/release server builds. Explicit native opt-in tests remain ignored.
- 2 isolated real-server catalog cases, 15 launcher cases, 25 service integration cases and 14 editing integration cases.
- All 30 focused desktop/Android browser cases: default catalog and recovery, existing Agent filter/menu/draft behavior, and sidebar long-list wheel/touch boundaries, short windows and empty states.

Local deployment on 2026-11-07 replaced only AnyWork's service and Web assets at `http://127.0.0.1:3210/`. All 70 sessions visible immediately before restart remained afterward; the access key was unchanged. The original WorkBuddy desktop and Cloudflare tunnel processes were retained. No native prompt was sent. Previous Web files and a private SQLite backup are retained under ignored `artifacts/default-agents-scroll-056b574/`; old content-addressed assets remain available to existing browser tabs.

Post-deployment catalog returns Codex, DeepSeek Harness and WorkBuddy. Codex and WorkBuddy entries are configured; DeepSeek Harness remains visible with setup guidance because no valid local discovery entry is present. This is default integration enablement, not a claim that an absent native host is connected, or that the earlier native WorkBuddy writing acceptance gate is complete. No version bump, GitHub publication or public website deployment was requested in this follow-up.

Both implementation worktrees were removed after accepted merges.
