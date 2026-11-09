# Self-hosted prebuilt CLI diagnostic review

Status: **accepted**, no blocking findings.

Reviewed exact candidate `218c7b44146f2b3dfadce4aadaeee25d733e95ad`, independently of its author. Scope is the diagnostic-only increment to the previously accepted self-hosted cloud deployment helper. This review does not authorize a deployment or local application update.

The helper captures CLI output instead of forwarding provider text. Public failure messages contain only fixed classifications; provider stderr is stored through the existing atomic, fsynced mode-0600 private-state writer. Diagnostic names are derived from the durable operation ID, and the bounded stderr tail is written beside the private upload staging directory, outside its artifact-only upload root. The actual rollout must continue using its repository-external private staging location. The CLI receives the staging root as cwd and only pinned deployment arguments and public provenance metadata; no diagnostic path or credential is added to its argv.

Timeout, process-launch failure and a nonzero CLI result each preserve the already-saved submitting intent and fail with a reconciliation requirement. The increment adds no uploader retry, replacement operation, environment mutation, namespace change or identity relaxation. A diagnostic-write failure also fails closed; it cannot cause a second deployment. On later invocation, the unchanged deployment state machine reconciles the saved operation before considering another upload. Existing same-operation and ambiguous/missing-inventory tests cover that boundary.

Independent checks passed: 8 prebuilt contracts, including credential-bearing stderr confinement and timeout with no retry; 20 deployment identity/recovery/environment contracts; `git diff --check 218c7b4^ 218c7b4`. The public classification is a troubleshooting hint only and is not used to infer deployment success or permission to resubmit.

No real deployment, environment/configuration write, OAuth operation, private user-grant access, running-service update or user-data access was performed for this review.
