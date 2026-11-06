# Harness conversation UI extraction

The conversation body is extracted and adapted from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159), pinned to commit `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159` (2026). The MIT copyright and permission notice is retained in `web/src/components/harness/LICENSE.deepseek-harness` and the root third-party notices. `ref/` remains a local research checkout and is not a runtime or release dependency.

## Extracted source and adaptation

All source paths below are relative to that upstream commit. Product files live under `web/src/components/harness/`.

| Upstream file | Product extraction / adaptation |
| --- | --- |
| `packages/client/ui-primitives/src/DisclosureRow.tsx`, `.module.css` | Retained shared header, glyph/hover chevron, controlled disclosure, keyboard activation, reduced motion, typography and spacing. Upstream icon imports use the existing Lucide icon set. |
| `packages/client/ui-primitives/src/TextShimmer.tsx`, `.module.css` | Retained nested decorative-copy context and single shared highlight, selectable accessible base text, inert decoration and reduced motion. Uses React 19 boolean `inert`. |
| `packages/client/ui-primitives/src/UserMessageBubble.tsx`, `.module.css` | Extracted bubble primitive, background/typography/content insets with host theme tokens. |
| `packages/client/ui-chat/src/client/chat/MessageItem.tsx` (`UserStyleBubble`), `UserContent.tsx`, `MessageItem.module.css` | Extracted right-aligned content stack, separate attachment row and user bubble. Factory/authorized-loader seats become React content slots supplied by the existing AnyWork attachment and text renderers. Existing edit state, copy actions and identity boundaries remain with AnyWork. |
| `packages/client/ui-chat/src/client/chat/AssistantMarkdown.module.css` | Extracted full-width narration, 14/24 default typography, 16px block rhythm, table accommodation and completed-action spacing; existing Markdown renderer keeps authorized files, images and code interactions. |
| `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx`, `.module.css` | Extracted icon/title/dot/summary/suffix structure, state handling, shimmer, lazy body seat and visual styles. Native `<details>` owns disclosure instead of the upstream presentation-store hook. AnyWork `ToolResult` supplies the body to preserve rich MCP outputs, authenticated previews, lazy historical detail requests and raw JSON inspection. |
| `packages/client/ui-chat/src/client/chat/ReasoningRow.tsx`, `.module.css` | Extracted collapsed summary, last completed paragraph preview, independent disclosure and secondary typography. Enabled only for `deepseek-harness`; Codex retains its existing hidden-reasoning behavior. Identity-keyed remount prevents disclosure state crossing sessions. |
| `packages/client/ui-chat/src/client/chat/TurnProcessNodeView.tsx`, `.module.css` | Extracted settled-turn header/disclosure and stopped/failed distinction; AnyWork's persisted per-turn open state supplies the control seat. |
| `packages/client/ui-chat/src/client/chat/RunningStatus.tsx`, `message-chrome.ts`, `ChatView.module.css`, `RunningWhaleTail.tsx` | Extracted isolated one-second live clock, duration-part formatter, non-ticking screen-reader announcement, blue status, spacing and static whale SVG. Uses Chinese copy, with AnyWork's concrete current activity retained in the accessible non-ticking status announcement. The upstream optional APNG animation is omitted; the original static SVG fallback remains. |

`ToolIcon.tsx` uses explicit wire-name families from upstream `models/tool-call-model.ts` for terminal, read, search, output and mutation glyphs.

`toolRowModel.ts` is the narrow AnyWork-to-Harness presentation adapter. It reads declared tool metadata and lifecycle; it never infers a read action from shell text. Source fields `title` and `description` remain separate, and failures, interruptions, preparation and running states remain distinguishable. Individual completed calls stay visible in sequence rather than disappearing into a synthetic aggregate. Existing subagent activity and rich output renderers remain reachable.

The upstream contract/Factory/Cordis store package graph is not copied into the Web bundle. Adapted React slots consume AnyWork's normalized `Message`/turn state, preserving existing history cache, SSE ownership, permissions, queues, attachments, split views and file authorization. `Composer.tsx` and `PromptEditor.tsx` are unchanged.

## Layout

```text
existing session header / tabs / split-view shell
    user attachment row                  → right
    user message bubble                  → right
    settled-turn duration / disclosure
    assistant narration                  → full column
    tool glyph · title · description · state
        expanded authorized output / files / images
    assistant final Markdown / actions
    blue live execution status + elapsed time
existing queue / approvals / goal context
existing AnyWork Composer                 → unchanged
```

The body defaults to a 748px content column. Tool rows use the upstream 24px default rhythm, 16px leading box / 14px glyph, 6px leading gap, 2px dot and 8px separator margins. Existing font preferences drive the upstream font-size axis. Mobile keeps rows within the viewport, retains all text, expands user stacks to 90%, scrolls long result payloads inside their region and exposes full descriptions through accessible labels. Saved light/dark preferences and reduced-motion settings remain effective.

## Verification

- `npm run typecheck -w web` and Web unit tests, including duration boundaries, tool lifecycle projection and explicit reasoning opt-in.
- `e2e/harness-conversation.spec.ts` tests live tools/elapsed time, keyboard disclosure, error/interrupted states, Harness↔Codex identity isolation, completed Markdown and unchanged draft entry at desktop and Android widths.
- `e2e/tool-activity.spec.ts` tests individual calls, lazy historical output, subagent navigation, raw JSON modal focus/copy/dismissal, narrow viewports and dark theme.
- Existing workspace/subagent/image/editor suites cover integration surfaces. Tests run against isolated fixture services, never the user's Codex/ChatGPT or production AnyWork process. This is UI contract verification; actual official Harness host integration is verified independently by the backend acceptance work.
