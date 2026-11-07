# I20 / I22 independent delivery-gate review

Task: [G0 contract](../tasks/improvement-g0.md). Reviewed exact candidate `511ae21cbb604942f75c212766357fe786b3f26b` in the isolated `improve-delivery-gates` worktree on 2026-11-07. The reviewer did not develop this candidate and did not change implementation. This review covers release authorization, workflow entry points, container construction and the proposed isolated acceptance script. It does not close the continuing project-improvement goal.

## Result

**Changes requested: one release-source binding defect and one missing container acceptance assertion remain blocking.** The new Checks authorization logic correctly rejects untrusted run metadata, but the release being created is not yet bound to that authorized source when an existing tag differs. The Docker build target is corrected and a realistic clean-build CI entry exists; actual image execution remains **open**, because this host's Docker daemon is unavailable. Passing the offline script suites is not actual container acceptance.

## Blocking findings

### B1 / P1: bind the remote release tag to the authorized source

[release.yml:195](../../../.github/workflows/release.yml#L195) checks successful CI for `RELEASE_COMMIT`, checks version strings, then creates a release for `RELEASE_TAG`. Neither this step nor [check-release-version.py](../../../scripts/check-release-version.py) resolves that remote tag to its actual commit. `--verify-tag` checks existence; `--target` chooses the commit only when creating a missing tag and does not replace an existing tag.

Concrete manual path: source A contains the expected version and has trusted successful Checks. An existing, unpublished tag with the same version points to B. A manual `publish=true` workflow running at A passes both new gates, while `gh release create TAG --target A` uses the already-existing tag B. Assets built at A can therefore be released under source B without successful Checks for B. A tag moved after a tag-triggered run starts has the same source-binding failure. This is not a claim that either situation has occurred on the actual repository.

Required fix: immediately before release creation, resolve lightweight and annotated remote tags, require the peeled commit to equal the pinned workflow source, reject malformed/missing/unexpected identities according to the selected creation policy, and never move a conflicting tag. For manual publication with a missing tag, create/bind it explicitly and reconcile the resolved result before release creation, or require a pre-existing correct immutable tag. Retain both Checks boundaries. Add offline negative cases for an existing wrong-source tag, moved tag, annotated tag indirection and missing-tag behavior. GitHub tag protections remain an additional repository-level control; this review did not inspect them.

The one-command publisher already has its own tag reconciliation, but the task specifically requires the release workflow's manual/tag paths to enforce the same boundary independently. Its later verification cannot undo a release already created through the alternate path.

### B2 / P2: container smoke does not verify the served Web build's identity

[container-smoke-test.py:66](../../../scripts/container-smoke-test.py#L66) accepts any HTML containing one `/assets/*.js` URL whose GET is nonempty. API binary version and corresponding-source digest are checked, but neither check establishes the identity/version of the served Web assets. The G0 container contract requests Web/source version verification, and [deployment.md](../../deployment.md) currently describes the script as checking API/Web static-resource version.

An independent fully mocked acceptance probe returned the correct server/API version and source bytes, but supplied HTML without any `app-version` metadata and a JavaScript asset declaring an unrelated stale app version. `acceptance()` reported success. No Docker, account, native engine or remote request was involved in that probe.

Required fix: export a build identity tied to the expected source/app version and assert it from the served Web response or manifest; reject absent or mismatched metadata and include an offline negative regression. A bare `app-version` presence check is insufficient: the current PWA value is an asset-content fingerprint, so it needs an expected build/source association. Keep exact corresponding-source digest checking. The clean Dockerfile path reduces the likelihood of a mismatched Web bundle but does not replace the requested acceptance assertion, particularly for the supported `--image` path.

## Nonblocking findings

- **N1 / cleanup:** [container-smoke-test.py:30](../../../scripts/container-smoke-test.py#L30) creates volumes before entering its `try/finally`. Failure while creating a later volume can leave earlier uniquely named volumes behind. Move setup under cleanup ownership and add a partial-setup failure case. This does not threaten unrelated resources, because names are unique.
- **N2 / failure evidence:** `docker()` captures all build/process output, then discards it on failure and directs readers to inspect the CI step. The step does not receive those captured build logs. Preserve safe isolated build diagnostics or an explicitly scrubbed failure artifact, with bounded output. Never print runtime logs containing the generated test access key. This is an operability improvement rather than release authorization.

## Call-chain and contract checks

- **Tag/manual publication:** the common `version` job gates tag runs and `inputs.publish`; all desktop/Android/source jobs depend on it. `publish` depends on every platform and repeats the gate immediately before release/version creation. Build-only dispatch does not create a release. The open B1 issue concerns binding that created tag/release, not a missing gate invocation.
- **Trusted Checks selection:** the helper resolves the active `.github/workflows/ci.yml` workflow ID, queries exact SHA/main, independently validates repository and head-repository, workflow ID/path, main branch and push/explicit-dispatch event, then requires completed/success. PR/fork/wrong-SHA/similarly named workflows cannot authorize. A previous exact-source success is deliberately reusable even if another run failed; that matches the G0 contract.
- **Failure and time budgets:** missing trusted runs wait within a positive deadline; only unsuccessful completed runs fail closed with an Actions URL; API reads retry transient failures within request/deadline budgets. Metadata size and pagination are bounded. Credentials are not included in fixed failure messages and authenticated redirects are disabled. Both the initial job budget and final 60-second recheck are explicit. Actual GitHub Actions timing/API schema was not exercised.
- **Legacy and Pages:** the retired prepare workflow has no write permissions, checkout, push or dispatch and fails with migration instructions. Main Checks no longer skip documentation-only changes. Pages remains independently dispatchable, and the publishing script's `--pages-only` recovery is unchanged. No write API was invoked during review.
- **Container construction:** the Rust stage explicitly builds `-p anywork`, so desktop UI/Tauri/GTK are outside the image build dependency path. Web is built from the reviewed tracked-source export, `.dockerignore` excludes the developer workspace, runtime Codex is pinned, and the final image selects UID 10001. Existing moving base-image tags remain a separate reproducibility issue (I21), not a claim of fully reproducible builds.
- **Container CI realism:** the added Ubuntu job exports corresponding source and invokes a `--no-cache` Docker build. The script owns a unique image/container/volumes, binds an ephemeral loopback port, mounts only its disposable RPC fixture, disables Codex discovery, checks wrong-token rejection, recreates the container, and compares session/workspace/access-key persistence. It creates a fixture session but never requests a model turn. Cleanup and Web-identity gaps are recorded above. Linux image execution, actual filesystem ownership and persistence have not been demonstrated by this review.

## Independent verification performed

All commands ran in the isolated candidate worktree; all GitHub/publisher tests use synthetic credentials, temporary repositories and mocked transports.

| Command / probe | Result |
| --- | --- |
| `python3 scripts/release-ci-test.py` | 8 passed |
| `python3 scripts/container-smoke-script-test.py` | 2 passed; lifecycle mocks, not Docker |
| `python3 scripts/release-version-test.py` | 3 passed |
| `python3 scripts/publish-test.py` | 26 passed; existing publication/recovery regression |
| `python3 scripts/source-archive.py` | Isolated worktree archive generated |
| `python3 scripts/source-archive-test.py` | 4 passed |
| PyYAML BaseLoader parse of all four workflows | Parsed; not a substitute for GitHub/actionlint validation |
| Independent mocked wrong-Web acceptance probe | Reproduced B2 false positive |
| `docker version --format '{{.Server.Version}}'` | Failed to connect: local daemon socket unavailable |

Mock publisher output mentioning prospective release URLs is fixture output and does not indicate a real publication. No source/tag push, release, real Actions dispatch, installer execution, model call, native profile/account/token file access, production restart, root build or shared dist mutation occurred.

## Remaining evidence

After B1/B2 fixes, independently recheck the exact follow-up commit and retain the negative regressions. Root must register the focused offline scripts in the merged checks, run the merged contract regression, and record the exact merged source. **Actual clean container build/run/persistence evidence remains open until the exact candidate executes successfully in CI or an isolated Docker-enabled environment.** Platform installation and native-agent functional acceptance are separate evidence layers and are not established by this container smoke.
