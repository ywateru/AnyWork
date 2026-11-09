# Independent client-entry Cloud review 01

Reviewed exact candidate: `5d803e1733b8aa830ed6e2818f70404221732715`, against the Cloud lane in `account-client-entry`. Development Logto is the authorized current delivery mode; historical Cloud production subscription fees do not block this stage. This commit contains the review only.

## Finding

### CC1 — P2, blocking: generated deployment CSP contaminates the exact-commit source offer

Code: `scripts/cloud/prepare-frontend.py:46-49`, `scripts/assemble-vercel.py:17-30`, `scripts/source-archive.py:85-87`. Contract: publisher/source acceptance binds the downloadable source to the exact declared commit; environment-derived CSP is a deployment artifact. `docs/cloud-configuration.md:101` also claims the source archive still comes from the exact commit.

The workflow prepares CSP by rewriting tracked `vercel.json` before building. Assembly records HEAD in `/build.json`, but then invokes the existing source exporter, which reads tracked files from the working directory. Therefore a self-hosted configuration's generated CSP is archived as if it were the committed source, even though it differs from HEAD. This is not caught by checking only the commit SHA or tracked filename manifest.

Independently reproduced using actual committed prepare/assembly/source-export scripts in a fresh temporary Git repository, synthetic build HTML and five complete fake self-hosted public variables. Result: `selfHostedAssemblyPassed=true`, `buildIdentityEqualsHead=true`, `archiveVercelEqualsHead=false`, `archiveHasEnvironmentDerivedOrigin=true`. No cloud/API/credential access occurred. Scratch reproduction: `/tmp/anywork-review-source-csp.py`; the durable reproduction is: commit original config → prepare different public origins → assemble → compare archived `anywork/vercel.json` with `git show HEAD:vercel.json`.

Keep generated CSP in the Vercel deployment artifact while deriving the corresponding source offer from the verified HEAD snapshot. Do not remove the selected CSP before Vercel consumes it, silently archive dirty bytes or weaken the exact-source identity check. Add a real temporary-Git prepare→assemble regression comparing archived tracked bytes to HEAD after changing origins; preserve public-source filtering and fail-closed symlink/private exclusions. The merged release's source identity must remain unchanged by public runtime configuration.

## Independently executed verification

- `python3 scripts/cloud/test_configure.py`:9passed.
- `python3 scripts/cloud/test_frontend.py`:6passed, including its real temporary CLI preparation/check/missing-config cases.
- `python3 scripts/cloud/test_deploy.py`:18passed.
- `python3 scripts/publish-test.py`:28passed; all publication output comes from offline fixtures.
- `python3 scripts/source-archive-test.py`:4passed. Existing source-export tests do not cover the new prepare→assembly dirty-config interaction established by CC1.
- Additional actual temporary-Git CLI integration: incomplete binding and stale CSP both rejected before `/app` assembly; complete self-hosted preparation followed by assembly succeeded, then failed the exact source-byte comparison as CC1.

## Accepted source observations and remaining checks

Five public variables must now be supplied as a complete set. Private-state public export no longer synthesizes a production Grid/resource fallback when fields are missing. Validation permits explicit HTTPS self-hosted origins/client IDs without an issuer code change and rejects incomplete bindings, injected origins, credentials, query/fragment and invalid IDs/ports. Workflow variables are explicit and no longer merge missing values with a production deployment default.

The acceptance flag is now `ANYWORK_ACCOUNT_READY`; the workflow fails when it is absent/false. Documentation requires the chosen complete configuration, independent review and real encrypted account/device chain before enabling it, allows Development/self-hosted modes and distinguishes Vercel's production deployment target from a Logto production tenant. The obsolete paid-production flag is not read. The flag change itself does not bypass the documented real acceptance gate.

CSP generation retains the current script/style/font/object/frame limits, limits connect origins to the selected identity/Grid plus existing GitHub and encrypted tunnel requirements, and removes old tenant origins. Preparation occurs before `vercel build`, and assembly independently rejects missing configuration or a stale CSP. `scripts/check.sh` adds the three offline Cloud suites without removing existing checks. Publisher/recovery/immutable release behavior passes the scoped regressions above.

**Pending before final pass:** verify the effective public build environment precedence for the pinned Vercel CLI50.28.0 when `vercel pull` supplies project env and the workflow supplies repository variables. Preparation and the eventual Vite bundle must use the same five values, or assembly must reject the mismatch. No defect is asserted without evidence. Available local npm cache versions inspected were63.1.2/65.12.1, so they were not treated as proof for the pinned CLI. A pinned CLI code/documentation inspection or controlled offline build is appropriate for re-review.

## Conclusion

**blocked** for candidate `5d803e1733b8aa830ed6e2818f70404221732715` due to CC1. Resolve the exact-source archive interaction and complete the explicit env-precedence check before final source acceptance. No cloud write, OAuth operation, shared grant, payment, deployment or enablement flag change was performed. Registration/email, real enrolled device/remote lifecycle, phone/network and CyberGrid distribution permission remain independent system/release gates; production subscription fees are historical information rather than this Development-backed stage's prerequisite.
