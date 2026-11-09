# Independent remote-enable diagnostics review

- Accepted exact product commit: **`a37cec36daa65ac51297044875bcf1b67b92b957`**.
- Base product: merged memory-only account implementation `e3ffdf7`.
- Reviewer: independent `verify_desktop`; date/platform: 2026-11-09, macOS arm64.
- Verdict: **PASS for this diagnostic change and the isolated checks below. No new blocking source finding identified.** This does not close the actual same-home restart/reenable integration blocker.

## Context and scope

The current acceptance record separately establishes first real native login/enable → Web discovery/public-key confirmation → encrypted empty workspace → disable success. Reenabling after restarting the same manager/config still fails, and the public directory remaining a valid version-1 record does not identify the failure stage. This review accepts fixed safe stage reporting so the orchestrator can locate that real failure; it does not infer that the lifecycle defect has been corrected.

Reviewed the entire product delta: `EnableStage`/its wrappers, native IPC conversion, UI error formatting, index-publication failure fixtures and documentation. The account remains memory-only; no credential-store/file fallback, new raw logging, cloud request, automatic retry or protocol/auth relaxation was introduced.

## Safety and diagnostic behavior

`EnableStage::at` creates a new typed enum error while discarding the original error, rather than attaching its Display/Debug/source/context chain. Each stage has one fixed code. Native `safe_error` returns that fixed code only when it can downcast to the typed stage; all unrecognized errors retain the bounded generic mapping. The new tests prove a synthetic URL/token-bearing cause becomes a one-element error chain and an exact safe code. Underlying request/provider/SDK details are not appended or logged by the new path.

All 13 mappings cover the intended boundaries: installation identity/key, gateway, provider, SDK client/config, Grid resource authorization/register/expose, and index authorization/read/schema/write/readback. Existing local-service/sign-in preconditions keep their existing safe errors. Public-index read checks the account identity, write/readback remain distinct, and the complete customData equality check remains in place. These identify the failed step, not the underlying provider reason.

UI `actionError` accepts only a primitive string with `Object.hasOwn(enableMessages, error)` and renders fixed text plus that exact known code. It does not parse a prefix, stringify arbitrary objects, or display an Error's message/cause. Every unknown payload uses the generic message. One explicit click makes one enable invocation; the change does not retry a refresh/write internally.

Cleanup behavior is preserved. Failures inside coordination/index setup run the existing explicit gateway close → Grid close → owned provider stop branch. Provider-readiness failure also closes/stops explicitly. Early failures retain RAII cleanup: Gateway Drop cancels its stop token; OwnedProcess aborts readers and its Tokio child was created with `kill_on_drop(true)`. This source inspection does not dynamically inject each external-provider/SDK failure or establish the real restart cleanup trace.

## Independent checks

After the author's Cargo build released the target, ran against this exact candidate:

```sh
CARGO_INCREMENTAL=0 cargo test -p anywork-desktop --lib -p anywork-remote --tests
npm run test:account-entry --workspace desktop/ui -- http://127.0.0.1:3237
npm run build --workspace desktop/ui
cargo fmt --all -- --check
git diff --check
```

All passed. Desktop **47 passed, 0 failed, 4 ignored**; remote **2 protocol + 4 gateway passed**; desktop main has no tests. The four ignored external/bundled/tunnel/update cases remain ignored. In addition to existing RAM lifecycle coverage, the new tests exercise every enum stage's safe boundary and the actual `publish_index` path with isolated HTTP failures at its five stages, checking token/read/write request counts and avoiding automatic retries. These fixture tests do not use real OAuth/Account API or user data.

The existing rendered test passed stage messages and unknown URL-bearing fallback. A reviewer-only temporary extension independently exercised **all 13** accepted codes, preserving one invocation per click, then checked known-code prefix/suffix/newline variations, prototype-property names, an object payload and a real JS Error carrying a private-looking URL. Every nonexact payload produced only the generic text; no private-looking URL appeared. The temporary script was removed and the reviewer-owned Vite server stopped. No tracked product implementation was modified.

No root fixture, real grant, Keychain, prior authorization, existing user service/history or CUA action was accessed. The orchestrator must run the actual same-home restart case with this exact binary, record the fixed stage, investigate that stage, and obtain a separately reviewed correction if needed. Actual fresh-key/version/old-pin confirmation after restart remains pending that investigation; this diagnostics pass must not be reported as successful restart acceptance or overall delivery completion.
