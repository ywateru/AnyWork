# Native account dependencies and provenance

The native account integration references CyberGrid's `cybergrid-sdk` 0.2.0 directly from source commit `2bd6729c6bbee90ed2926410caca883a0a100890` at <https://github.com/ywateru/CyberGrid>. Cargo.lock records the exact Git source. This code is not relicensed by AnyWork. The upstream original code is **All rights reserved**; a compatible distribution grant from the owner is a release gate. Private integration and source testing do not imply permission to publish binaries containing it.

CyberGrid's existing SDK/provider notices and original license texts remain in the pinned dependency: `sdk-rust/LICENSE`, `sdk-rust/THIRD_PARTY_NOTICES.md`, `sdk-rust/licenses/`, `sdk-rust/provider-assets/`. The current AnyWork browser gateway launches AnyWork's existing explicitly resolved cloudflared distribution; it does not copy or modify upstream provider assets. Existing cloudflared notices in the AnyWork release remain required.

The local encrypted gateway uses `snow` 0.10.0's fixed `Noise_IK_25519_ChaChaPoly_SHA256` implementation (MIT OR Apache-2.0), and `jsonwebtoken` 9.3.1 (MIT) for signed JWT verification. It does not implement its own Noise primitives and does not copy DeepSeek Remote source. The protocol interoperates with the browser's separately declared Clatter dependency; the local reference's architectural examples informed design only.

The native sign-in UI uses official `@logto/client` 3.2.2 and `@logto/browser` 3.1.2 (MIT). Its public verifier extension uses `jose` 5.10.0 (MIT) and preserves signature/issuer/audience/iat/expiry checks while routing JWKS fetch through the restricted Rust broker.
