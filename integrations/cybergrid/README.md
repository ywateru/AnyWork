# CyberGrid public application directory adaptation

This directory contains the source adaptation required for AnyWork's
self-hosted Logto deployment. It does not contain a developer checkout,
credentials, provider state, or generated deployment files.

| Source identity | Value |
| --- | --- |
| Upstream repository | https://github.com/ywateru/CyberGrid |
| Fixed upstream commit | `2bd6729c6bbee90ed2926410caca883a0a100890` |
| Local adapted source commit | `c923cc232e74e4aff78fa3c82916ce9fb9a283b5` |
| Adapted Git tree | `ba2326bfd441c3579d3e8445d0c2f20a214f5bf2` |
| Patch SHA-256 | `1b569fa296150cbcc0e6a3e02dcc2b5ce2e2d991215d8655282a381ec6ef5137` |

`PROVENANCE.json` binds the fixed base, local adapted commit, and adjacent patch.
The adapted commit is a local provenance identifier; it has not been pushed to
the upstream repository. Applying the patch recreates its complete source tree,
including file modes, without needing that commit to exist on a public remote.

To reproduce the source, use a separate clean checkout of CyberGrid:

```sh
git checkout --detach 2bd6729c6bbee90ed2926410caca883a0a100890
git apply --check /absolute/path/to/cybergrid-public-directory.patch
git apply --index /absolute/path/to/cybergrid-public-directory.patch
git write-tree
```

The resulting tree must equal `ba2326bfd441c3579d3e8445d0c2f20a214f5bf2`.
Verify the patch digest against `PROVENANCE.json` before applying it. Build and
verification instructions remain in the resulting repository's
`docs/pinned-application-directory.md`, `docs/deployment.md`, and server package.

The adaptation adds an explicit pinned directory mode using public SPA/Native
application IDs and metadata. In that mode the coordinator does not receive
Management API credentials or make Management API requests. Signed user JWT
issuer, audience, client, and `connect` checks remain in place. The existing
dynamic directory mode remains available for older deployments. This patch
does not change the remote transport protocol or add dependencies.

The upstream copyright notice is reproduced verbatim in `UPSTREAM-LICENSE`.
CyberGrid retains its own **All rights reserved** terms; the AnyWork root license
does not relicense CyberGrid. Third-party dependencies retain their notices and
licenses in the fixed upstream source. Inclusion of this patch and provenance
is source documentation, and is not a claim of a new general distribution
license for the upstream project.
