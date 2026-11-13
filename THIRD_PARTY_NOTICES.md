# Third-party notices

## Claude Agent SDK protocol and history behavior

The Rust Claude adapter in `crates/server/src/claude/` follows the stream control protocol and adapts conversation-chain and parallel-tool history reconstruction behavior from [Anthropic's Claude Agent SDK for Python](https://github.com/anthropics/claude-agent-sdk-python), commit `22b8eb9c19adfa78759b79e22bd664a57843bb06`, particularly `_internal/query.py`, `_internal/sessions.py`, and `_internal/transport/subprocess_cli.py`. Copyright (c) 2025 Anthropic, PBC. The upstream MIT license is included in [licenses/claude-agent-sdk-MIT.txt](licenses/claude-agent-sdk-MIT.txt). Claude product names identify the native integrations; no endorsement is implied.

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
