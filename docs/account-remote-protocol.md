# Account remote protocol v1

This protocol is a local-device boundary. Vercel/Logto/CyberGrid never terminate business encryption. The gateway binds loopback separately from the existing AnyWork HTTP service and exposes only `/remote/v1/ws`. CyberGrid port ID is `anywork-remote`, type `anywork-noise-v1`; its port URL points to this gateway, never the existing API listener.

## Authentication and cryptography

A browser obtains the device installation ID and 32-byte X25519 `publicKey` (unpadded base64url) from its own Logto `customData.anywork.devices`. It pins that value locally; a changed key requires explicit confirmation. The browser connects WSS to the published port root plus `/remote/v1/ws`. Origins are exact configured SPA HTTPS origins (loopback allowed only in explicit test configuration); missing/unknown Origin is rejected. Origin is an additional browser boundary, never account authorization.

Binary WS message 1 is Noise IK initiator handshake, suite `Noise_IK_25519_ChaChaPoly_SHA256`. The initiator uses a fresh static key for each connection; the responder uses the installation's private key kept only on the device. Prologue is UTF-8 `AnyWork\0remote-v1\0` followed by installation ID, with literal zero bytes at `\0`. The responder accepts the initiator key only after decrypting and validating its handshake payload. Payload JSON is `{ "type":"auth", "installationId":"…", "accessToken":"…" }`.

The JWT must have ES384 signature from the configured issuer's HTTPS JWKS, exact issuer/audience, `connect` scope, exact SPA `client_id` (or `azp` when provider uses it), current exp/nbf and the owner sub bound by an explicit local action. ID tokens and tokens from another app/account/resource are rejected. No local bearer is sent to the browser. The response is Noise IK handshake message 2 with payload `{ "type":"ready", "expiresAt": <Unix seconds> }`. Expiry is min(JWT exp, now+300s). Handshake timeout 10s; expiry, local disable, transport failure and authentication errors close the WS and all its RPC/PTY children. No plaintext fallback or credential recovery from cloud data.

Subsequent binary WS messages are Noise transport messages, each decrypting to a single UTF-8 JSON object below. Maximum ciphertext 65,535 bytes; no plaintext frame above 65,519 bytes. Noise implicit ordered counters reject modified/replayed/out-of-order frames; keys never reused after reconnect. Ping/Pong WS controls carry no application data. Text frames are rejected.

## HTTP multiplexing

Client:

- `{type:"request",id,method,path,contentType?,size}` starts a request. `size` is raw body byte count, max22MiB, including multipart encoded bytes. Methods GET/POST/PUT/PATCH/DELETE. Only existing `/api/` business route patterns are allowed; no `/api/service/*`, `/api/health`, arbitrary URL, host, authorization header, fragments, path traversal or encoded path separators. Query strings remain endpoint-specific existing AnyWork semantics. Header `contentType` is the only browser supplied HTTP header. The gateway assigns a fresh stable ID to each Noise connection, injects it as `X-AnyWork-Client-Id` and uses the fixed `AnyWork encrypted browser` user agent on local API requests. The local presence view therefore observes the loopback gateway, not the browser IP. IDs match `[A-Za-z0-9_-]{1,64}`, cannot be reused for this WS.
- `{type:"chunk",id,data}` appends canonical standard-base64 body bytes, max32,768 raw bytes. Sender awaits `{type:"ack",id,received}` before its next chunk. No chunk may exceed declared size or connection-wide22MiB reassembly budget.
- `{type:"end",id}` submits exactly declared body bytes; a zero body still sends request then end.
- `{type:"cancel",id}` cancels assembly/in-flight response. Cancellation does not undo actions already accepted by the local API. No automatic replay.

Server: `{type:"response",id,status,contentType}` starts the response, followed by `{type:"chunk",id,data}` (same32,768 byte limit) and `{type:"end",id}`. Response headers are limited to Content-Type. HTTP errors preserve status/body. Protocol/transport/local failures use `{type:"error",id,code}` with fixed codes, no tokens/paths/response diagnostics. Responses are bounded22MiB; outbound backpressure uses a bounded queue. Concurrent IDs may interleave; order within one ID is strict. Event polling uses existing `/api/events/poll` and `/api/sessions/<id>/events/poll`, preserving cursors/has_more. Streaming SSE is not exposed.

## PTY multiplexing

Client `{type:"pty.open",id,sessionId}` opens existing `/ws/terminal/<sessionId>` on the fixed local service. Server sends its own local bearer as the local socket's first authentication frame and never relays it. After local WS opens, server sends `{type:"pty.ready",id}`. Client input is `{type:"pty.input",id,data:<UTF-8 string>}` (max16KiB); resize is `{type:"pty.resize",id,cols,rows}` (cols2..500, rows2..200). Server output is `{type:"pty.data",id,data:<standard base64 bytes>}`. `{type:"pty.close",id}` or cancel closes local socket, causing existing terminal handler to kill the shell. Server emits `{type:"pty.closed",id}` when closed. Max2 PTYs per connection.

## Bounds and lifecycle

Maximum4 active authenticated-or-handshaking sockets,8 concurrent HTTP requests per socket,2 PTYs,1024 distinct IDs per socket; connection body assemblies collectively max22MiB. Exceeding limits returns a fixed error or closes the offending socket. An outbound queue holds max16 bounded application frames. Response/read/send operations have deadlines bounded by authorization expiry. A socket shutdown drops/aborts every in-flight task and local terminal socket. Local disable cancels the entire gateway before withdrawing CyberGrid publication. Reconnect requires a fresh Noise key exchange and fresh account proof; it never retries business writes.

## Trust and availability

Initial responder key discovery trusts the current user's Logto directory. A user-editable directory does not authorize access to the device: the local owner JWT check does. The first-key directory trust and hosted JavaScript supply chain remain explicit security limits. Cloudflare Quick Tunnels carry ciphertext and necessary network metadata and have no production SLA. Device-level CyberGrid encrypted WS addresses are not browser port URLs.
