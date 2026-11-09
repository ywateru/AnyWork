# Device key notice — independent review

Date: 2026-11-09. Reviewed exact product commit: `adceb53d3a24b14cd8884e3e259d4361e198d78d`, based on `1a7c41d`.

## Findings

None. The complete product diff changes only the Chinese and English `keyHint` strings in `web/src/AccountApp.tsx`, adding client restart as a possible reason for a changed public key. This matches the current [native lifecycle contract](../../account-desktop.md): the public installation ID survives a same-owner restart while the Noise key is generated in memory for the new process. Both languages retain the instruction to compare the host's displayed public key and the initial account-directory trust qualification. The changed-key warning, explicit confirmation and connection behavior are unchanged.

## Validation and conclusion

`npm run typecheck` and `git diff --check 1a7c41d adceb53d3a24b14cd8884e3e259d4361e198d78d` passed independently. No new mirrored tests were added for this text-only change. No OAuth grant, browser session, cloud resource or live native fixture was accessed.

**pass** for this exact narrow wording change. The orchestrator's real restart/connection evidence is separate and is not claimed as a rerun by this reviewer.
