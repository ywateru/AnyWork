# Independent account cloud review 01

Reviewed candidate: `983a0165f3ec028fe5cf28a6adbd83952b012576`. Reviewer is separate from the cloud implementation author. Scope: cloud configuration/deployment tools, secret handling and recovery, actual Upstash coordination, Vercel publisher migration and release callsites. This commit contains the review only.

## Findings

### C1 — P2, blocking: a normal Release still deploys the legacy Pages site

Code: `.github/workflows/release.yml:202`. Contract: `docs/cloud-configuration.md`, 可恢复配置与发布, says `pages.yml` is manual recovery only and Vercel is the formal website target; `docs/releasing.md:111` says the Release job explicitly dispatches `vercel.yml`.

The actual Release job still executes `gh workflow run pages.yml --ref main` after creating the immutable release. Removing Pages push/release triggers does not remove this explicit dispatch. Thus normal releases continue publishing the legacy website, while the publisher independently waits for/dispatches Vercel. This defeats the migration's single formal deployment path, and direct advanced Release publication does not explicitly refresh Vercel as documented. Change the release callsite to the Vercel workflow and add a regression covering the actual workflow text/call chain, not only the Python publisher's workflow selection. Preserve manual Pages recovery.

### C2 — P2, blocking: coordination deployment is not safely resumable

Code: `scripts/cloud/deploy-cybergrid.py:68-75`. Contract: `account-cloud` objective requires resumable safe cloud configuration; `docs/cloud-configuration.md`, 可恢复配置与发布, requires reconciling saved resources and unknown creation results before another mutation.

Every invocation upserts environment variables and POSTs a new production deployment. The saved `gridDeployment`/`gridSource`/`gridEnvironment` are never used for reconciliation, and no deployment intent is saved before POST. A successful completed run repeated with the same arguments creates another deployment. If POST succeeds at Vercel but its response or the following private-state write is lost, rerunning silently creates another deployment instead of determining the first outcome.

Independent offline execution of the actual `main()` with a private fixture state already containing a READY deployment, unchanged arguments, and a recording Vercel transport returned `deploymentPostCount=2, envUpsertCount=2` over two runs. No real deployment was requested. This is a tool recovery defect rather than a defect in the currently running dev coordinator.

Persist a secret-safe deployment identity/intent before mutation (project, pinned source, namespace/config identity); reconcile an existing saved deployment by ID and an unknown result against matching inventory before another POST. Reuse a matching completed/in-progress deployment. Fail explicitly on unresolved/ambiguous outcomes or changed identity; require an explicit separate deployment operation for deliberate redeploy. Test success replay, lost POST response, interrupted private-state save, changed config and ambiguous inventory without real external mutations.

### C3 — P2, blocking: accepted Redis prefixes can deploy a coordinator that cannot start

Code: `scripts/cloud/deploy-cybergrid.py:34`; pinned upstream `server/src/redis.ts`, RedisStore constructor. Contract: cloud configuration must validate the official pinned runtime's inputs before mutation.

The deployment CLI accepts prefixes up to 100 characters; the pinned RedisStore accepts at most 80. Prefixes of length 81–100 pass provisioning validation, are written to encrypted production env and used for a new deployment, then fail coordinator construction. Match the pinned 1–80 character grammar and reject invalid input before any API/env/deployment mutation. Add boundary checks for 80/81 characters.

### C4 — P3, non-blocking: release documentation retains contradictory Pages instructions

Code: `docs/releasing.md:111` retains “official Pages artifact/OIDC workflow” and instructions to set the repository Pages source, while the same paragraph and the new footer describe Vercel. Rewrite this section around the final Vercel build/deploy mechanism and put legacy Pages instructions only in the recovery section.

## Independent executed evidence

- `python3 scripts/cloud/test_configure.py`: 7 tests passed. Tests cover private mode, immediate file symlink refusal, atomic replacement, fixed safe HTTP error formatting, authenticated redirect refusal, exact origins, production loopback refusal, duplicate tenant-name refusal and public-only configuration.
- `python3 scripts/publish-test.py`: 28 tests passed. Includes interrupted release/version preparation, immutable tag conflicts, failed/ambiguous workflow dispatch/rerun, resume and site-only repair without changing installers/releases, Vercel workflow selection, and exact `/build.json` source mismatch rejection. All are offline fixtures; their “Published” stdout is not evidence of real publication.
- Actual Upstash REST test using the exact pinned official `redisTransport` and `RedisStore` from `2bd6729c6bbee90ed2926410caca883a0a100890`: **11 checks passed**. Two independent transport/store instances shared epoch and registration; concurrent duplicate registrations returned the same session/incarnation; discovery and signal delivery crossed instances; owner separation held; signal retries were idempotent; a cold store recovered epoch/session; cross-instance revoke rejected old publication; persistent registration fence rejected stale revision and allowed the next revision; rate limits shared across instances; a second fresh namespace was isolated; invalid REST credentials failed closed with COORDINATOR_UNAVAILABLE.
- That test used only generated synthetic users/devices/signals under `anywork:acceptance:38a24e54-296f-4e12-b097-16ea4b897620` and its `:isolated` namespace. Cleanup removed keys under those exact newly generated namespaces only. No existing namespace, device directory, business record, reset, provider setting or paid resource was accessed/changed. Credentials were read from the mode0600 private file outside Git and never printed. Scratch reproduction: `/tmp/anywork-upstash-review.ts`; this paragraph records the durable evidence and test scope.
- Independent live dev coordinator probes: `/healthz` 200; `/api/v1/console/auth/config` 200; `/api/v1/admin/overview` 503 without admin configuration; unknown path 404; approved formal frontend origin returned 200 with exact ACAO; unapproved origin returned 403 without ACAO. An initial probe to the nonexistent `/admin/api/overview` returned404 and was corrected to the actual route before drawing the disabled-admin conclusion.
- Independent offline deployment replay failed the resumability expectation as C2. Scratch reproduction `/tmp/anywork-review-deploy.py` invoked actual committed deployment code with private fixture files and a fake provider only.

## Source and security assessment

The provisioner uses official HTTPS endpoints and fixed audiences, does not follow authenticated redirects, caps metadata reads and avoids automatic mutation retries. Dedicated tenant/Redis creation checks inventory first and refuses same-name duplicates; application/resource/role configuration reuses queried IDs. Private state is outside the script's repository, requires restricted file permissions, refuses immediate file symlinks, is written through a mode0600 temporary file and replaced atomically, and provisioning commands lock their state. Public configuration returns only five explicitly selected client fields. Vercel receives M2M and writable Redis credentials as encrypted server environment variables for the production target; preview targets are not populated with production secrets. Redis TLS and no-eviction settings are checked. None of this authorizes widening storage to business content.

The actual pinned coordinator uses Upstash REST EVAL with one namespace hash slot, coordinator-owned state and fail-closed errors; the real REST checks above break through the previously skipped local-Redis boundary. They do not prove physical data erasure at logical TTL, provider backup retention, all upstream capacity/corruption tests, production JWT verification or the final product lifecycle. Metadata retention/fences/seed and broad dedicated-tenant M2M permission are disclosed rather than described as zero metadata contact.

The publisher preserves its exact-SHA workflow gates, immutable tags/assets and private durable intents. The new Vercel workflow checks the explicit production-ready flag before pulling credentials/building/deploying, pins checkout to the event commit and uses prebuilt output. Publisher verification compares `/build.json` with the required exact source after deployment. The workflow still depends on the Web lane's source assembler and final root Vercel configuration, so final merged acceptance is necessary. C1 remains an uncovered release callsite despite passing publisher tests.

## OAuth and production gates

Real development SPA hosted authorization, ES384 verification and separate opaque Account API tests were recorded by the author/orchestrator. This cloud review did not refresh the shared OAuth grant: the native verifier exclusively owned that grant during review, and separate immutable access-token evidence was made available to avoid competing refresh owners. These reports are not substituted for this reviewer's executed Upstash/publisher evidence. Actual Native OAuth and the desktop grant lifecycle are the independent native review's responsibility.

The production Free tenant's unavailable custom API resources/roles and documented Pro24USD+RBAC32USD =56USD/month base remain an explicit paid external prerequisite. No purchase, plan upgrade, frontend publication or new coordinator deployment was performed during this review. Development credentials/resources must not silently substitute for production configuration. Email registration/delivery/default-role acceptance, full same-account native→Grid→Web encrypted business lifecycle, CyberGrid distribution permission and exact-source publisher/final production acceptance remain separate release gates.

## Conclusion

**blocked** for candidate `983a016`: fix C1–C3, then independently rerun the relevant workflow/deployment recovery/input checks against the new exact committed head. C4 is non-blocking. The real Upstash boundary and existing publisher regression suite pass; this does not approve paid activation, source publication or production feature readiness.
