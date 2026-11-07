# Native Agent history — merged checks and local deployment

Product merged to local `main` at `f66fc66` following the [independent review](shared-agent-history.md). Follow-ups `a609350` and `448bd1e` format the new browser coverage and make the existing fake desktop launcher readiness test deterministic. No product launcher behavior changed in those follow-ups.

Merged validation passed:

- Web typechecking, Prettier, all 309 unit tests and a fresh out-of-tree Web/PWA production build.
- Rust workspace formatting, Clippy with warnings denied, 154 workspace tests and debug/release builds. Eight explicit native opt-in tests remain ignored; installed-history observations are recorded separately in the independent review.
- Two plugin catalog cases, 15 launcher cases, the comprehensive shared-history HTTP test, 25 service integration cases, 14 editing cases and the complete deterministic WorkBuddy CDP carrier fixture.
- All 34 focused desktop/Android browser cases covering disconnected native history, default Agents, sidebar Agent filtering and sidebar scrolling.

Preparation checks caught browser test formatting and a missing generated desktop UI directory; both were resolved before the final checks passed. The launcher fixture also exposed a race: a fake process could be alive before writing its report. Its test now waits for a bounded valid report and explicitly covers delayed startup. All 15 launcher cases passed after that correction, including independent verification.

On 2026-11-07 the source release server at `http://127.0.0.1:3210/` was gracefully replaced with the tested binary, preserving its existing arguments and adding `--agent-scope all`. There were no active owned tasks at the restart gate. The service now lists **101 sessions**: all **71** previously visible Codex sessions, **22 dsh root sessions** and **8 WorkBuddy sessions**. Four dsh roots are archived. Native children remain associated with their parent sessions rather than duplicated as sidebar roots.

Authenticated post-deployment checks opened a nonempty persisted body for each newly imported Agent and verified stable events on repeated reads, without connecting an execution host or sending messages. The access key, installed native Agent processes and existing tunnel were preserved. Tested Web assets matched the served build and did not need replacement. A private database backup and sanitized deployment evidence are retained under ignored `artifacts/shared-history-448bd1e/`.

Existing saved Agent filters remain in effect: select All Agents or the desired Agent to see its imported history. Persisted text and tool results remain readable without a connected host; sending still requires the original shared execution host. This acceptance does not close the separate installed WorkBuddy native creation/message/collaboration gate. Version remains 0.1.10; no GitHub push, release or public website deployment was included in this follow-up.
