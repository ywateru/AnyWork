# Unified Native live rollout

Date: 2026-11-10 (Asia/Shanghai). This records the reviewed local Mac installation, separate from source tests and public binary releases.

## Installed result

The frozen source `113ddba1433e6437f73bdfebc6a4ea1d6e2fa74f` was built in a fresh private operation and installed at `/Applications/AnyWork.app`. The same bundle contains the Native UI, new local-session server, root-base Web assets and executable cloudflared. Deep strict code-signature verification passed; the bundle uses an ad hoc signature and is not a notarized public release.

| Artifact | SHA-256 |
| --- | --- |
| Frozen source archive | `e4106b333771e86916153b6c70c22a533095f74d7fb8ceaa095cb2a421c30599` |
| Native executable | `e93ef4c9d8bbe8c4b0da19c20a279a8e4040b830747e9f4ae11dff6420f8ad63` |
| Bundled server | `8af12e2a147f692a9ccc2f930da71da125cacc7b1930cba1464d043976d90f34` |
| Bundled cloudflared | `c647bfd58ab7fa562d47061853321eb78b7205b110a45fff8f3c53196f3986a5` |

The final recovery receipt reached `complete` at 13:28:29. The new server PID was 28102 and the opened Native PID was 28129. Author checks proved the installed tree, executable hash, exact launch arguments, listener ownership, local-browser-session capability and runtime workspace. Root inspected the actual new Native window and confirmed the ready external service and workspace. Independent post-install verification passed.

## Preservation and environment

The existing manager workspace setting and the running service's actual workspace were different. Both were preserved separately: the configuration bytes were unchanged, while the service retained its original runtime workspace, data directory, bind, arguments and working directory. This distinction was checked before any live mutation.

The verified original service's complete environment was captured in RAM immediately before termination and supplied unchanged to the new service. Current executor environment was not substituted. Only environment key names and fingerprints were persisted; environment values and credentials were not logged or saved. Same-invocation failure rollback used that same RAM environment, with no unattended reconstruction after RAM loss.

The existing service bearer bytes and permissions, manager bytes and legacy configuration were preserved. No database restoration or content migration ran. Root's read-only post-check found all 108 original session-ID hashes retained, schema version 2 and unchanged schema hash. The checks read IDs and schema metadata without inspecting conversation content. Existing unrelated cloudflared processes and the local proxy were not signaled.

## Guarded recovery from graceful drain

The first rollout preflight rejected an incorrect assumption that manager and runtime workspace were identical, before any service or installation change. The original evidence was archived, and corrected metadata and scripts received independent review and fresh approval without changing the accepted bundle.

The corrected ordinary switch sent one authenticated graceful-stop request to the idle original server. Its listener closed, but the process remained alive past the bounded wait, with an idle catalog helper and an established proxy connection. The script stopped without retrying the request or installing the app. This was a real graceful-drain limitation; successful listener shutdown did not prove process exit.

Root then explicitly authorized a separate, independently reviewed recovery. The recovery rechecked the original PID, start/arguments/executable/cwd, environment fingerprint, unchanged app/config/bearer, absent listener, prior idle/stop acknowledgement, metadata and the sole pinned catalog helper without PTY or business descendants. It submitted exactly one SIGKILL to original server PID 81502. Catalog helper PID 81545 exited automatically; the conditional catalog SIGTERM was unnecessary. No process group or unrelated process was targeted.

After confirmed exit, the recovery preserved the original app, atomically installed the unchanged staged candidate, launched its server with the original RAM environment, verified identity and health, and opened Native. The durable journal records each submitted mutation and refuses resubmission. The approved recovery script SHA-256 was `b97813832fc97178dd69016563947a8c4ce3b92341d5cc641895c44fc09dbd17`; its baseline SHA-256 was `c4150af234370f05afbca1d524ba656b510d94d35107e207488a6d0e92a825bd`. Seven focused private recovery contract tests passed. The completed recovery receipt SHA-256 was `f3c5bb0e75187c9ac60794138ee6d4d74a47da4aace628fa76cb94c1cb31080f`.

## Scope and remaining limits

This operation installed and opened the reviewed Mac build. It did not log into a real account or enable remote access on the user's workspace. Source-level and isolated OAuth/encrypted-channel checks are recorded separately; an opened live window does not replace those checks. Physical mobile acceptance and a public signed/notarized Native release remain separate delivery scopes. The observed old-server graceful-drain hang was handled by the approved recovery, without expanding product shutdown behavior during rollout.
