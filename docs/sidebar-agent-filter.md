# Sidebar Agent filter and identity

Status: independently verified and merged following the request to filter sidebar sessions by Agent and show each Agent's own icon. Existing conversation state, drafts and host ownership are outside this presentation filter.

## Layout

```text
AnyWork                         collapse
New chat
Search chats
[ Agent icon  All Agents             v ]
Chats                    view options  +
  project / execution-state group
    [Codex icon]       chat title   time / running / needs input
    [Harness icon]     chat title   time / running / needs input
```

Retain existing sidebar colors, type and spacing. Use a compact filter control and roughly 16–18px Agent marks; Agent identity replaces the leading generic status dot, while the existing trailing execution animation and waiting indicator remain visible. Preserve light/dark themes and 320–390px mobile drawers. Product branding stays AnyWork.

## Behavior and state

- Default to All Agents. Always offer All Agents, Codex, DeepSeek Harness and WorkBuddy, including when a standard Agent has no configured plugin or sessions. Extend these with the union of configured plugins and agents present in loaded sessions, with stable Codex / DeepSeek Harness / WorkBuddy names. Unknown agents retain their own ID/name and a generic icon; never label them Codex.
- Match the actual `Session.agent` value. Apply the filter only inside sidebar presentation, intersecting existing search/project/archive filters before grouping and sorting. Directory ordering uses the newest matching session.
- Keep the full session collection for caches, live streams, notifications, links and the selected conversation. Filtering out the selected row must not close or replace its conversation, draft or split panels. The filter must not launch, cancel or create any session.
- Persist the selected Agent per connection/server. A saved selection remains intelligible while loading or if its plugin is unavailable. Show the existing loading/error UI first, then an explicit empty filtered state with a way back to All Agents.
- Menu interaction follows existing floating-menu behavior: outside click, Escape and selecting an option close it; keyboard use and accessible selection are required. Search and other sidebar controls remain reachable.

## Icon sources

The user explicitly requested online research. Primary research includes the [OpenAI Codex product page](https://openai.com/codex/), [OpenAI mark guidelines](https://openai.com/brand/), the [official DeepSeek Harness site](https://www.deepseek.com/harness/en/), and the [official Harness brand guidance](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.md).

Use verified product assets for identification only, bundled locally with source URLs, pinned revision or checksum, copyright/license and trademark attribution. Harness's official pinned checkout provides light/dark SVG favicons under `apps/web/public/`. Find a verifiable Codex product icon rather than substituting a generic terminal or an unrelated model logo. Do not modify installed applications. Any bundled SVG must contain no scripts, external references or executable content. If raster assets are necessary, include them explicitly in Git/source export rules. Reference repositories remain excluded.

## Acceptance

Typecheck and focused tests cover real Agent IDs, configured/unavailable/unknown agents, filter intersections, latest-directory order, per-server persistence, stale saved selection, loading/empty states and retained selected conversation/draft. Browser checks cover desktop/mobile, light/dark, keyboard and floating-menu dismissal, actual bundled icons and unchanged running/waiting indicators. Independent review uses a separate agent and isolated services, with no prompts to production sessions.

## Implementation notes

The scoped preference uses `anywork.sidebar-agent.<JSON server URL>` in browser local storage, with the empty string representing All Agents. If browser storage is disabled, the filter remains usable in memory and defaults to All Agents on reload. Unknown and unavailable saved IDs remain visible; missing options never silently switch the selected filter. Branding assets and source/checksum records are shipped under `web/public/agents/`; the exact two Codex PNGs are allowlisted in Git and the source archive.

## Viewport and scroll ownership

```text
viewport
+ sidebar -------------------+ main -----------------------+
| heading / actions / filter | conversation header          |
| chats heading              |                             |
| + chat list (scrolls) ----+ | conversation (scrolls)        |
| | row [position:relative]| |                             |
| | accessible label stays| |                             |
| | in the row            | |                             |
| +-----------------------+ | composer                     |
| settings / AnyWork footer |                             |
+---------------------------+-----------------------------+
```

The shell remains one dynamic viewport high. Sidebar and list have explicit zero minimum heights, allowing the list to shrink in short windows. Session rows establish the containing block for their absolutely positioned screen-reader labels. Those labels must not escape the list's clipping ancestry or contribute to document overflow. The sidebar itself does not clip its anchored menus.

The list contains vertical overscroll. While the conversation shell is mounted, the document root disables vertical elastic overscroll; login and other pages retain their normal document behavior. No global body scrolling lock, wheel interception or touch prevention is used. Settings dialogs and document previews retain their own scroll areas.

Regression evidence: with 80 directory groups in a 960×480 viewport, uncontained absolute labels made the document **5,787px** high and focus moved it to `scrollY=333`. Establishing each row's containing block alone restored document height to **480px** and `scrollY=0`. Desktop wheel and mobile touch gesture tests cover both list ends at normal and short heights, final-row access, fixed header/footer, and short-window empty-state/menu reachability. Headless Chrome does not render native macOS elastic bounce; the scoped root and list overscroll policies are asserted separately.
