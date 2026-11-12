# CyberGrid JavaScript SDK source

Source: https://github.com/ywateru/CyberGrid/tree/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-js

The four official SDK modules (`index.ts`, `bridge.ts`, `directory.ts`, and `endpoints.ts`) are vendored from this exact commit, with repository Prettier formatting only. Component metadata is JS SDK 0.2.0; this does not claim an npm package publication. `SOURCE.json` records each upstream path, original SHA-256, and vendored SHA-256. The SDK has no runtime dependencies.

Original LICENSE and TypeScript development-compiler notices are retained byte for byte. The notice hashes agree with upstream `notices/typescript-5.9.3/SOURCE.json`; they are not reformatted. No new license or redistribution grant is inferred from public repository access; release approval must resolve the owner's distribution permission.

AnyWork continues to use the legacy `memory-v1` discovery APIs. The added snapshot, directory/watch, and bridge APIs are included as official source dependencies but are not integrated into AnyWork's business transport. Business encryption remains separately implemented using clatterjs and Rust snow, with the existing Quick Tunnel HTTPS-root gateway contract.
