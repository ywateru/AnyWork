# Independent account Web runner re-review 05

Reviewed exact candidate: `c9a70749291cc6b9776c8b40662923df81c19473`. Previous blocked runner review: [account-web-04](account-web-04.md). This correction changes only the Node safety test and layout evidence; product account/transport/private-state helper code is unchanged. This commit contains the review only.

## W5 resolution

**Resolved.** The permission test no longer uses filesystem watcher events or asynchronous path lookup of a short-lived file. An isolated child process imports the real helper, retains the original `node:fs/promises.open`, wraps that actual operation, and synchronizes the builtin ESM export binding. The wrapper awaits the original filesystem open, calls `stat()` on its real returned file handle, records the result, then returns that same handle to the unchanged product helper. Consequently the creation check happens before the helper can chmod, write, close or rename the file.

The parent requires exactly one observed state temporary file with mode0600, size0 and exclusive `wx` flags. It retains real final-content comparison, inode replacement, final0600permissions, concurrent-owner refusal and directory cleanup assertions. The original operation is restored inside the child; no instrumentation leaks to other tests. The correction introduces no timing sleeps, larger payload, test skipping or retry-until-pass behavior. Test filename/runner wiring and import-relative CLI paths from the prior correction remain intact.

No new finding was established in this corrective scope.

## Independently executed evidence

- Complete `npm test` from the worktree root: **passed**, exit0;32Vitest files/323tests, followed by8Node checks. Both runners executed; the Node suite was not accidentally omitted or collected by Vitest.
- Standalone `node --test web/scripts/private-browser-state.check.mjs` from the root:8passed, exit0.
- `npm run typecheck -w web`:passed.
- `npm run format:check`:passed.
- `npm run build -w web`:passed, including production Vite output and PWA generation. Existing chunk-size warnings are not build failures.
- `git diff --check`:passed; worktree clean before this review file.

As in the failed review04 run, the complete root test, standalone Node test and independent typecheck/format/build checks ran in parallel; all passed on their first execution in this review. Each Node suite used isolated temporary directories. The source change removes the observation race rather than treating this successful run as evidence that the old watcher was reliable.

No real credentials, browser session, OAuth refresh, cloud data, deployment or paid operation was accessed. Repeating crypto or cloud OAuth tests would not verify this test-only change and was not performed.

## Conclusion

**pass — Web source and complete test runner** for exact candidate `c9a70749291cc6b9776c8b40662923df81c19473`. W1–W5 are closed across the recorded reviews. Earlier product/isolated integration evidence remains scoped as recorded; this report adds the previously missing successful complete root test gate.

The orchestrator must still restore/merge the accepted lane and run checks on the final combined source. Production entitlement/fees, CyberGrid distribution permission, native full lifecycle, physical phone/network and publication acceptance remain independent gates; this source pass does not approve production deployment or publication.
