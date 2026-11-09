# Self-contained prebuilt function review

Status: **accepted**, no blocking product findings.

Independently reviewed exact candidate `179c4e36e292ff8da7ac0eb4817be252ffcdc113`. Scope is materializing tracked Vercel function references, rejecting residual mappings at deployment validation, and checking the pinned CLI offline. This acceptance does not execute or authorize a deployment.

The pinned Vercel CLI50.28.0 builder records function-relative destination names as `filePathMap` keys and repository-relative source names as values. Its client adds those values to the upload file list, calculates file hashes, and only afterward enters upload/deployment creation. Independent execution of the real bundled client generator reproduced the original missing-reference failure before upload. Against the new self-contained artifact it yielded `hashes-calculated` for792 files, with zero network attempts, and was closed before its upload stage. The offline checker uses a synthetic token, blocks transports and never reads the operator credential store.

The materializer verifies the complete adapted Git revision, clean tracked worktree, regular tracked blobs, source bytes and modes. It rejects unsafe paths, symlinks, conflicting destinations and file/directory conflicts before writing. Nonidentity mapping tests verify destination/source direction. The deployment validator rejects every remaining `filePathMap`, including an empty one.

Independent artifact comparison against exact source `c923cc232e74e4aff78fa3c82916ce9fb9a283b5` found48 added files with matching Git blob bytes and modes, no removals, and no unrelated byte/mode changes. The sole function configuration change removes its mapping. All receipt file entries, before/after configuration digests, and original/materialized artifact digests match. The original upload remains separate and unchanged. Independent reproduction from a copy of that original upload yielded identical output file hashes and modes. The new deployment identity is `aa53c54c1306560a12bdb7c35f2a71e91c31aff42474647f1cbe7fd3edb5cd10`; there are no residual maps or symlinks. Disk inventory includes793 files; the actual CLI lists792 because its project metadata is excluded from deployment files.

Independent checks passed:5 materialization contracts,9 prebuilt contracts,20 deployment contracts, and diff whitespace validation. Fourteen known private credential values were scanned privately across800 artifact/candidate files with zero matches. No credential bytes or provider diagnostic contents were printed.

The artifact transform changes output identity while preserving the adapted source and patch provenance. Any subsequent rollout must use a new durable operation bound to the transformed artifact and preserve both earlier operation records. No deployment POST, OAuth operation, running-service update, or business-data access occurred in this review.
