# Account remote protocol v1

This protocol is a local-device boundary. Logto and CyberBus never receive
workspace plaintext. The desktop gateway binds loopback separately from the
AnyWork HTTP service and listens on the CyberBus overlay at virtual TCP port
`11001` (`anywork-noise-v1`). The same gateway retains the loopback
`/remote/v1/ws` entry for local diagnostics.

## Discovery and channel

The Web client reads the target installation's public device record and
CyberBus locator from the signed-in user's Logto `customData.anywork`.

1. The device record supplies the pinned 32-byte X25519 `publicKey`,
   `keyVersion`, label and platform.
2. The locator supplies overlay `ipv4`, service port `11001`, product and a
   bounded expiry. It is not authorization.
3. The Web client derives the account overlay material from its own Logto
   `network:join` resource token, joins the EasyTier network through configured
   WSS peers and opens a raw TCP stream to `locator.ipv4:11001`.

The Web transport then uses one consistent frame everywhere:

```text
4-byte unsigned big-endian length | payload
```

Length must be 1..65535. A cancelled read cannot discard a half frame because
the decoder keeps its prefix buffer across consumer cancellation. Writes are
serialized. A Noise ciphertext frame remains limited to 65,535 bytes, so the
plaintext application frame is smaller by the Noise tag.

## Authentication and cryptography

Frame 1 is a Noise IK initiator handshake with suite
`Noise_IK_25519_ChaChaPoly_SHA256`. The initiator uses a fresh static key for
each connection; the responder uses the installation private key kept only on
the device. The prologue is UTF-8 `AnyWork\0remote-v1\0` followed by the
installation ID, with literal zero bytes. The responder accepts the initiator
key only after decrypting and validating the handshake payload. Payload JSON is:

```json
{ "type": "auth", "installationId": "…", "accessToken": "…" }
```

The JWT must be signed by the configured issuer's HTTPS JWKS and have an exact
issuer, audience, `connect` scope, allowed SPA/Native client ID, current
exp/nbf and the owner subject bound by the local enable action. ID tokens and
tokens from another app, account or resource are rejected. No local bearer is
sent to the browser.

Handshake frame 2 decrypts to:

```json
{ "type": "ready", "expiresAt": 1760000300, "authRenewal": 1 }
```

Each authorization lease ends at `min(JWT exp, now + 300s)`. Handshake timeout
is 10 seconds. Local disable, an unrenewed expiry, transport failure or an
authentication error closes the stream and all HTTP/PTY children. There is no
plaintext fallback.

### Authorization renewal

Only a gateway advertising `authRenewal: 1` accepts renewal frames. Before
expiry the browser obtains a fresh resource JWT through the official Logto
owner and sends an encrypted frame:

```json
{ "type": "auth.renew", "id": 1, "accessToken": "…" }
```

The positive safe-integer control ID advances exactly by one and is independent
of business request IDs. The gateway rejects an identical token, revalidates
the complete JWT boundary and requires the same subject. The new lease must
advance the previous expiration. A successful encrypted
`{ "type":"auth.renewed", "id":1, "expiresAt":… }` preserves existing HTTP/PTY
children and Noise counters. Verification and acknowledgment are bounded by
the old lease and local disable; a late success cannot revive an expired
connection. Business operations are never replayed on a new session.

## HTTP multiplexing

Client frames:

- `{type:"request",id,method,path,contentType?,size}` starts a request. `size`
  is the raw body byte count, max 22 MiB. Methods are GET/POST/PUT/PATCH/DELETE.
  Only existing `/api/` business routes are allowed; no service/health routes,
  arbitrary hosts, authorization headers, fragments or encoded path
  separators. Query strings retain endpoint-specific semantics.
- `{type:"chunk",id,data}` appends canonical standard-base64 bytes, max 32,768
  raw bytes. The sender awaits `{type:"ack",id,received}` before the next chunk.
- `{type:"end",id}` submits exactly the declared bytes.
- `{type:"cancel",id}` cancels assembly or the in-flight response. It does not
  undo actions already accepted by the local API.

Server frames start with `{type:"response",id,status,contentType}`, followed by
`chunk` and `end`. Response headers are limited to Content-Type. Protocol or
local failures use `{type:"error",id,code}` with fixed codes and no token,
path or response diagnostics. IDs are canonical `rN` and strictly advance a
connection high-water mark; legacy noncanonical IDs remain bounded to 1024.
Responses are max 22 MiB and use bounded backpressure.

Event polling uses the existing `/api/events/poll` and
`/api/sessions/<id>/events/poll` routes, preserving cursors and `has_more`.
Streaming SSE is not exposed through the remote gateway.

## PTY multiplexing

`{type:"pty.open",id,sessionId}` opens the existing local
`/ws/terminal/<sessionId>` route. The gateway sends its own local bearer as the
local socket's first authentication frame and never relays it. After the local
socket opens, it sends `{type:"pty.ready",id}`. Client input is
`{type:"pty.input",id,data:<UTF-8>}` (max 16 KiB); resize is
`{type:"pty.resize",id,cols,rows}` (2..500 by 2..200). Server output is
`{type:"pty.data",id,data:<base64>}`. Close or cancel closes the local socket,
which terminates the existing shell. A connection holds at most two PTYs.

## Limits and lifecycle

The gateway allows at most four authenticated-or-handshaking connections, eight
concurrent HTTP requests per connection, two PTYs and 22 MiB aggregate body
assembly. An outbound queue holds at most 16 bounded application frames.
Exceeding a limit returns a fixed error or closes the offending connection.
Shutdown aborts every in-flight request and local terminal socket.

The overlay derives its virtual address from the CyberBus network name and a
random 32-byte Web installation seed using `cyberbus/address/v1`; only
addresses inside `10.144.0.0/20` are accepted. Port `11000` is reserved for the
CyberBus control plane and is rejected by both Web and desktop.

## Trust and availability

Initial responder-key discovery trusts the signed-in user's Logto device
record. The directory does not authorize access: the local owner JWT check
does. First-directory trust and the hosted JavaScript supply chain remain
explicit security limits. CyberBus relays carry ciphertext and necessary
network metadata; their availability is part of the deployment acceptance.

## Regression verification

`cargo test -p anywork-remote` covers fixed absolute token expiration,
non-advancing/same-token/other-owner denial, late verification, local disable,
renewal and generated-ID bounds. Web Vitest covers credential derivation,
framing, cancellation safety, renewal scheduling and business framing.

The production WSS relay is available and has passed TLS, WebSocket upgrade and
EasyTier cross-transport smoke checks. Real browser-to-host 20 MiB HTTP/PTY
interop and a real three-endpoint desktop/Android/browser workspace session
remain deployment gates. The migration record distinguishes those gates from
passing unit and simulated tests.
