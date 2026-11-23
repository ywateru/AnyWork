# Third-party notices

## Android embedded account authorization

The Android client uses the official [Logto Kotlin/Android SDK](https://github.com/logto-io/kotlin), version **2.0.3**, source revision `3efc22a59ecd9f020bf6af58bd47d6a4f292b140`, for embedded WebView authorization and native token management. Copyright (c) 2022 Silverhand Inc. The upstream MIT license is preserved verbatim in [licenses/logto-kotlin-MIT.txt](licenses/logto-kotlin-MIT.txt) (SHA-256 `b6d6c086ac4744bb39633e6dcc62f664347668dfce8e40cc7acca4856aac8281`). The SDK's clipboard polyfill and social connector bridge are part of its authorization UI; they do not receive AnyWork business IPC permissions. Native app grants are configured without SDK persistent storage; IdP cookies have the separate boundary described in [the Android contract](docs/android-account-entry.md).

## Claude Agent SDK protocol and history behavior

The Rust Claude adapter in `crates/server/src/claude/` follows the stream control protocol and adapts conversation-chain and parallel-tool history reconstruction behavior from [Anthropic's Claude Agent SDK for Python](https://github.com/anthropics/claude-agent-sdk-python), commit `22b8eb9c19adfa78759b79e22bd664a57843bb06`, particularly `_internal/query.py`, `_internal/sessions.py`, and `_internal/transport/subprocess_cli.py`. Copyright (c) 2025 Anthropic, PBC. The upstream MIT license is included in [licenses/claude-agent-sdk-MIT.txt](licenses/claude-agent-sdk-MIT.txt). Claude product names identify the native integrations; no endorsement is implied.

## CyberBus and EasyTier device transport

The native desktop and Android account transport uses the Rust `cyberbus-transport` crate from [CyberBus](https://github.com/osd-pub/CyberBus), version **v0.2.0**, commit `a2b5be3b2c3cd8d21e6a0c5bf2b4da2040f36c11`. The CyberBus workspace is offered under **MIT OR Apache-2.0**, but `cyberbus-transport` declares **LGPL-3.0-or-later**. The transport statically links the vendored EasyTier `v2.7.1` source at commit `0d9c52b169dc2112687ddefcf571cd01d383193c`, which is **LGPL-3.0**. The Web overlay uses the corresponding EasyTier `@easytier/browser` and `@easytier/runtime` packages and embeds the LGPL-3.0 EasyTier core WASM.

The complete MIT, Apache-2.0, LGPL-3.0 and GPL-3.0 texts are preserved in `licenses/cyberbus-MIT.txt`, `licenses/cyberbus-Apache-2.0.txt`, `licenses/cyberbus-transport-LGPL-3.0.txt`, `licenses/GPL-3.0.txt`, `licenses/easytier-LGPL-3.0.txt` and `licenses/easytier-js-Apache-2.0.txt`. The exact upstream source, `packaging/NOTICE.md`, `packaging/RELINK.md`, EasyTier build instructions and AnyWork's application source are distributed in `artifacts/corresponding-source.tar.gz` and `artifacts/anywork-source.tar.gz`; the public site exposes them at `/corresponding-source` and `/source`. Native users may modify the LGPL component and relink using the supplied instructions. Do not advertise the combined transport as MIT/Apache-only or prohibit reverse engineering for debugging modifications to the LGPL portion.

## DeepSeek Harness conversation UI

Portions of `web/src/components/harness/` are extracted or adapted from [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), commit `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`. See [the extraction record](docs/harness-ui-provenance.md) for exact source files and adaptations.

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```


Agent identification marks: Codex product icons © OpenAI; DeepSeek Harness favicons © DeepSeek (official MIT repository, trademark rights reserved). Used solely to identify connected Agents; no endorsement implied. See web/public/agents/README.md (shipped as /agents/README.md) for official sources, pinned revisions and SHA-256 checksums. These brand marks do not become AnyWork branding or AGPL-licensed assets.
