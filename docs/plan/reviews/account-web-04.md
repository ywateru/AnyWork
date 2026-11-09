# Independent account Web runner re-review 04

Reviewed exact candidate: `3f21bbf49ab69e469b46e0469578ac777ed92851`. This correction renames the Node safety suite to `.check.mjs`, explicitly chains it after Vitest in the Web test script, and resolves test CLI paths relative to `import.meta.url`. Product account/transport/private-state helper logic is unchanged. This commit changes only the review.

## Finding

### W5 — P2, blocking: root npm test still fails because transient file observation is nondeterministic

Code: `web/scripts/private-browser-state.check.mjs:105-121`. Contract: the account delivery's complete root test entry must pass reliably; W4's temporary-file permission regression must actually verify the private write boundary.

The test uses `fs.watch` on a temporary directory and asynchronously stats a transient state file. The helper may rename that file before the event's stat runs; fs.watch also does not guarantee delivery of every transient filesystem event. Consequently the `observed` array may remain empty even though checkpointing succeeds and the final file is mode0600. The unconditional `assert.ok(observed.length > 0)` then fails a valid run.

Independent complete root `npm test` on this exact committed candidate exited1: all323Vitest checks passed, then7of8Node checks passed; the atomic replacement/permissions check failed at line121 with `observed.length > 0` false. A separately invoked standalone Node suite passed8checks during the same review. Typecheck/format/build were running independently in parallel; the commands use distinct temporary directories. This establishes a real timing-sensitive test, not a repeated product permission failure. The prior test-collection and cwd corrections themselves are correct.

Replace watcher timing with deterministic observation of the actual temporary file at creation/before write, while retaining the final mode/inode and no-extra-files assertions. An isolated filesystem-operation observer or equivalent synchronization can exercise the real helper without relying on event delivery, payload size, arbitrary sleeps or retries. Keep Node checks out of Vitest collection and keep both root/workspace/standalone entry points. Rerun the complete root command after correction; do not turn an intermittent failure into a pass by repeating until successful.

## Independently executed evidence

- `npm test` from worktree root: **failed**, exit1.32Vitest files/323tests passed; Node7pass/1fail as W5.
- `node --test web/scripts/private-browser-state.check.mjs` from worktree root:8passed. This success does not override the full-command failure.
- `npm run typecheck -w web`:passed.
- `npm run format:check`:passed.
- `npm run build -w web`:passed, including PWA shell generation. Existing large-chunk warnings are not build failures.
- `git diff --check`:passed.
- Source inspection confirms `.check.mjs` avoids Vitest's normal `.test/.spec` collection, `web/package.json` explicitly runs `vitest run && npm run test:private-state`, and the CLI test path uses `import.meta.url` so the root and workspace cwd resolve the same script.

No real credentials, OAuth refresh, crypto session, cloud resource, deployment or paid operation was touched. The unchanged product/security logic retains the prior review evidence; this correction does not require new real OAuth/crypto evidence.

## Conclusion

**blocked** for exact runner candidate `3f21bbf49ab69e469b46e0469578ac777ed92851` until W5 is fixed and the full test entry independently passes. Prior Web product findings remain closed, but this candidate cannot pass the required complete test gate. Production/system boundaries from review03 remain unchanged.
