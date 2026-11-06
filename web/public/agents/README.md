# Agent identification assets

These marks identify the connected Agent in the AnyWork sidebar and filter. They are not AnyWork branding and do not indicate endorsement or affiliation. OpenAI/Codex and DeepSeek/Harness remain trademarks of their respective owners. These brand assets are not relicensed under AnyWork’s AGPL.

## Codex

Official research: [Codex product](https://openai.com/codex/), [Codex official landing page](https://chatgpt.com/codex/?app-landing-page=true), [OpenAI brand guidance](https://openai.com/brand/). The website favicon is the generic ChatGPT mark, so the actual Codex product mark was verified read-only in the official installed app.

Source: OpenAI’s ChatGPT macOS bundle `26.1013.40934`, build `20770`, `/Applications/ChatGPT.app/Contents/Resources/`. Original product artwork and proportions retained; resized from 1024×1024 to 96×96 with macOS `sips`, ancillary local metadata removed. No installed files were modified. Copyright OpenAI; used only to identify OpenAI Codex.

| Bundled file | Official source file | Original SHA-256 | Bundled SHA-256 |
| --- | --- | --- | --- |
| `codex-light.png` | `icon-codex-light.png` | `de7d43f3386105ab20952958c2c25beb0d903e2aeb6e1aef57c49a648c0d1c07` | `9bf3504d6de7da6982b27527a8e414f48b84969e4f62aa3ca44c750559751037` |
| `codex-dark.png` | `icon-codex-dark-color.png` | `69fb4384e161be8a20dcb94a9ac34aea4fbfaeb67514110a71e7b0732eccb0fc` | `df748feb658b5bb581b89906c323b6e9c03a430b624a1834e4519731b4d74aba` |

## DeepSeek Harness

Official research: [Harness website](https://www.deepseek.com/harness/en/), [official brand guidance](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.md).

Unmodified light/dark SVG favicons copied from the official `deepseek-ai/deepseek-harness` source at commit `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159` (0.2.2-rc.1). The repository is MIT licensed; see the preserved [upstream MIT license](../../src/components/harness/LICENSE.deepseek-harness). Brand/trademark rights remain with DeepSeek.

| Bundled file | Pinned official source | SHA-256 |
| --- | --- | --- |
| `deepseek-harness-light.svg` | [apps/web/public/favicon.svg](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/apps/web/public/favicon.svg) | `9e983b4f649c25c6ca0623a50be1a6e705fd8f49f756638b980fa13b40575ab6` |
| `deepseek-harness-dark.svg` | [apps/web/public/favicon-dark.svg](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/apps/web/public/favicon-dark.svg) | `dde7db781f41e7aeb4709ff5485af2bdcf7f4b4ea81b4500cfd5df44efdbd817` |

All assets are bundled locally. The SVGs have only path geometry and contain no scripts, external references or executable content. PNGs are explicitly allowlisted for source archives and Git; reference checkouts remain excluded. Unknown agents use the existing Lucide `Bot` glyph and retain their own IDs/names.
