# Self-hosted homepage: actual static deployment

Verified **2026-11-10 01:23:19 +08:00**. The production site at
[anywork-tau.vercel.app](https://anywork-tau.vercel.app/) is **READY** and serves
the independently accepted [static candidate](account-homepage-selfhost-artifact-01.md).
This report covers deployment identity and HTTP verification; GUI acceptance is
recorded separately in the [cutover review](account-selfhost-cutover-01.md).

| Identity | Accepted and published value |
| --- | --- |
| Product source | `75726758a4c9ffd7e7da4fb45e115bba92803650` |
| Site/download version | `0.1.13` |
| Public configuration SHA-256 | `7902059c9e6cd3a40709347bce82d917fc346b691b539798b39274af4459d58c` |
| Upload artifact SHA-256 | `1c7b9a3a64f7a90d082cff3ab589c8a3a032d4e04f68a67b91ec8b084a565f1e` |
| Source archive SHA-256 | `9c47522f804fae1005c44dc9aeb905625b72034b2c0c0ab201c32116ba4bb05f` |
| Reviewed publisher SHA-256 | `c8fa5d19fa4325e068b1cad9693a03bce4bfe0a143415df2248f441184316c69` |
| Preserved operation | `45d098df-6a2b-407f-97b9-22363af79b84` |
| Vercel project | `anywork` / `prj_LpMd1SfQU8GokkNUIJZk9wfJIELK` |
| Deployment | `dpl_CV59TUfcxyfELrRyHUvHELcmkoT8` |
| Deployment URL | <https://anywork-ac6xor5eu-yywater68-1778s-projects.vercel.app/> |

After explicit release authorization, the reviewed publisher made **one**
deployment submission using Vercel CLI `50.28.0`. It preserved the original
prepared intent byte for byte, bound the same operation to the accepted
source/configuration/artifact, and flushed the `submitting` checkpoint to durable
storage before invoking the CLI. The saved outcome is `observed/READY`. No new
operation, second upload, manual alias write, or environment change occurred.
Vercel assigned the production alias; a subsequent alias API read matched this
deployment and project. The separately authorized project Node version correction
from `26.x` to `22.x` was read back before building.

The publisher's independent offline contract checks covered checkpoint failure,
unchanged dry runs, repeated invocation, and uncertain CLI outcomes. Recovery of
an existing `submitting` or `observed` operation only observes and saves its state;
an uncertain result must not cause another submission. Deployment metadata binds
the actual frontend operation, source, public configuration, `prebuilt` source
kind, and artifact. It makes no CyberGrid source provenance claim.

Nine actual GET requests against the production alias returned **200**, with
every response body matching the accepted local artifact bytes:

| Path | Bytes | Verified content |
| --- | ---: | --- |
| `/build.json` | 73 | Exact source SHA and version |
| `/source` | 9,771,116 | Accepted source archive SHA-256 |
| `/anywork-source.tar.gz` | 9,771,116 | Same accepted source archive |
| `/app/` | 658 | Accepted application HTML |
| `/app/callback` | 658 | Accepted callback/application HTML |
| `/zh/` | 24,308 | Accepted Chinese homepage |
| `/en/` | 24,557 | Accepted English homepage |
| `/release.json` | 3,474 | Immutable `v0.1.13` download metadata |
| `/app/assets/index-BJFQEim1.js` | 1,140,726 | Actual compiled main asset referenced by the application HTML |

All nine responses carried the exact reviewed Content Security Policy,
`X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.
`/build.json` and `/app/callback` also returned `Cache-Control: no-store`.
The CSP uses the self-hosted Logto and Grid origins and excludes the former Cloud
origins. The public source archive contains the exact 677 Git source files and
the generated manifest. The accepted upload contains 437 static files and zero
functions; its secret scan and independent artifact review passed before upload.

This deployment publishes the static frontend. It does not publish a new desktop
binary or updater release: download metadata remains on immutable `v0.1.13`
assets. This publishing work did not alter local applications, services, user
sessions, native hosts, or tunnels. Native/Web login, device discovery, encrypted
desktop access, and responsive GUI behavior require their separate integration
evidence and are not asserted by these HTTP checks.
