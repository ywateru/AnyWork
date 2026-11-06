import { describe, expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import {
  parsePromptText,
  promptAtomAttributes,
  promptLinkAttributes,
  serializeLibraryMention,
  serializePromptLink,
  serializePromptText,
  type PromptDocument,
  type PromptNode,
} from "./promptText";
import { normalizeUserMessageMarkdown } from "./userMessageMarkdown";

// PZ/ZX/iua/KX contract from the read-only app-initial and app-shared
// extracts recorded in docs/anywork-reference-contract.md. This suite covers
// the plain history editor mode, not the main composer's rich schema.
const historyOptions = { restoreMarkdownLinksAsTextLinks: true };
const plainTextOptions = { preserveTextLinkMarks: true };
const inlines = (source: string, options = {}) =>
  parsePromptText(source, options).content[0].content || [];
const doc = (...content: PromptNode[]): PromptDocument => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});
const atom = (type: string, attrs: Record<string, unknown>): PromptNode => ({
  type,
  attrs,
});
const link = (
  text: string,
  href: string | null,
  title: string | null = null,
): PromptNode => ({
  type: "text",
  text,
  marks: [{ type: "link", attrs: { href, title } }],
});

describe("Native plain prompt restoration", () => {
  it("keeps Markdown literal and preserves every LF paragraph including the final empty one", () => {
    const source = "# Heading\n**bold** _italic_ `code`\n- item\n\n";
    const parsed = parsePromptText(source);
    expect(parsed.content).toHaveLength(5);
    expect(parsed.content.every((entry) => entry.type === "paragraph")).toBe(
      true,
    );
    expect(serializePromptText(parsed)).toBe(source);
    expect(parsePromptText("")).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("does not restore ordinary labeled HTTP links until the history caller enables it", () => {
    const source = "before [guide](https://example.com/guide) after";
    expect(inlines(source)).toEqual([{ type: "text", text: source }]);
    expect(inlines(source, historyOptions)).toMatchObject([
      { type: "text", text: "before " },
      {
        type: "text",
        text: "guide",
        marks: [
          {
            type: "link",
            attrs: {
              href: "https://example.com/guide",
              title: null,
              sourceAppId: null,
            },
          },
        ],
      },
      { type: "text", text: " after" },
    ]);
  });

  it("distinguishes bare URL marks, explicit links and recognized app chips", () => {
    expect(
      inlines("[https://example.com](https://example.com)")[0],
    ).toMatchObject({
      type: "text",
      text: "https://example.com",
      marks: [{ type: "link", attrs: { href: null, sourceAppId: "" } }],
    });
    expect(
      inlines("[issue](https://github.com/org/repo/issues/1)")[0],
    ).toMatchObject({
      type: "richLink",
      attrs: {
        displayText: "issue",
        href: "https://github.com/org/repo/issues/1",
        sourceAppId: "github",
      },
    });
    expect(
      inlines("[https://github.com](https://github.com)", historyOptions)[0],
    ).toMatchObject({
      type: "text",
      marks: [{ type: "link", attrs: { href: null, sourceAppId: "github" } }],
    });
    expect(
      inlines("[https://example.com](https://example.com)", historyOptions)[0],
    ).toMatchObject({
      type: "text",
      marks: [{ type: "link", attrs: { href: "https://example.com" } }],
    });
  });

  it("restores marked storage links including title and Markdown label text", () => {
    expect(
      inlines(
        '[**read** guide](codex-text-link://https://example.com "A title")',
      )[0],
    ).toMatchObject({
      type: "text",
      text: "read guide",
      marks: [
        {
          type: "link",
          attrs: { href: "https://example.com", title: "A title" },
        },
      ],
    });
    expect(
      inlines("[email](codex-text-link://mailto:team@example.com)")[0],
    ).toMatchObject({
      type: "text",
      text: "email",
      marks: [{ type: "link", attrs: { href: "mailto:team@example.com" } }],
    });
  });

  it("uses authored-link scanning rather than a balanced CommonMark parser", () => {
    expect(inlines("[file](folder(one)tail)")).toMatchObject([
      {
        type: "atMention",
        attrs: { label: "file", path: "folder(one", fsPath: "folder(one" },
      },
      { type: "text", text: "tail)" },
    ]);
    expect(inlines("\\[file](a\\)b)")).toMatchObject([
      { type: "text", text: "\\" },
      { type: "atMention", attrs: { label: "file", path: "a)b" } },
    ]);
  });

  it("restores paths while retaining unsupported URL schemes as literal authored text", () => {
    for (const path of ["/Users/me/a.txt", "folder/a.txt", "C:\\work\\a.txt"]) {
      expect(inlines(`[file](${path})`)[0]).toMatchObject({
        type: "atMention",
      });
    }
    for (const path of [
      "file:///a.txt",
      "ftp://example.com/a",
      "www.example.com",
      "unknown:thing",
    ]) {
      expect(inlines(`[file](${path})`)).toEqual([
        { type: "text", text: `[file](${path})` },
      ]);
    }
    expect(
      inlines("[file](folder/a.txt)", {
        restorePathLinksAsFileMentions: false,
      }),
    ).toEqual([{ type: "text", text: "[file](folder/a.txt)" }]);
  });

  it("restores mention chips inside code text but protects system hints inside code ranges", () => {
    const source =
      "`[file](/a) [Search](chatgpt-system-hint://search)` [Search](chatgpt-system-hint://search)";
    expect(
      inlines(source).filter((entry) => entry.type === "atMention"),
    ).toHaveLength(1);
    expect(
      inlines(source).filter((entry) => entry.type === "chatGptSystemHint"),
    ).toHaveLength(1);
    expect(serializePromptText(parsePromptText(source))).toBe(source);
    expect(inlines("[Other](chatgpt-system-hint://invalid)")[0].type).toBe(
      "text",
    );
  });

  it("restores exact supplied file mentions after built-in mention classification", () => {
    const supplied = atom("atMention", {
      label: "a",
      path: "/a",
      fsPath: "/native/a",
    });
    const fileMentions = new Map([
      ["[a](/a)", supplied],
      ["[app](app://example)", supplied],
    ]);
    expect(inlines("[a](/a)", { fileMentions })[0]).toBe(supplied);
    expect(inlines("[app](app://example)", { fileMentions })[0].type).toBe(
      "appMention",
    );
  });

  it("honors restoration flags without stripping unaccepted authored text", () => {
    const source =
      "[doc](https://example.com) [file](/a) [plugin](plugin://example)";
    expect(
      inlines(source, { restoreOnlySitesAndPluginMentions: true }),
    ).toMatchObject([
      { type: "text", text: "[doc](https://example.com) [file](/a) " },
      { type: "pluginMention" },
    ]);
    expect(
      inlines("[doc](codex-text-link://https://example.com)", {
        restoreRichLinks: false,
      }),
    ).toEqual([{ type: "text", text: "[doc](https://example.com)" }]);
    expect(
      inlines("[file](/a)", { restoreOnlyHttpMarkdownLinks: true }),
    ).toEqual([{ type: "text", text: "[file](/a)" }]);
  });

  it("keeps library restoration ahead of the HTTP-only filter and canonicalizes library metadata", () => {
    const source =
      "[Plan](chatgpt-library-file://%20libfile_abc%20?asUrl=1&sourceUrl=https%3A%2F%2Fexample.com&entrypoint=at_mention&fileId=f+1&mimeType=text%2Fplain)";
    const parsed = parsePromptText(source, {
      restoreOnlyHttpMarkdownLinks: true,
    });
    expect(parsed.content[0].content?.[0]).toMatchObject({
      type: "chatGptLibraryFileMention",
      attrs: {
        libraryFileId: "libfile_abc",
        entrypoint: "at_mention",
        fileId: "f 1",
        mimeType: "text/plain",
        serializeAsUrl: true,
      },
    });
    expect(serializePromptText(parsed)).toBe(
      "[Plan](chatgpt-library-file://libfile_abc?fileId=f+1&mimeType=text%2Fplain&entrypoint=at_mention&sourceUrl=https%3A%2F%2Fexample.com&asUrl=1)",
    );
    expect(inlines("[x](chatgpt-library-file://%broken)")[0].type).toBe("text");
    expect(
      inlines("[x](chatgpt-library-file://id?entrypoint=unknown)")[0].attrs
        ?.entrypoint,
    ).toBeNull();
  });

  it("restores app, plugin, skill, agent, browser-skill and Sites identities", () => {
    expect(inlines("[$GitHub API](app://github)")[0]).toMatchObject({
      type: "appMention",
      attrs: { name: "github-api", displayName: "GitHub API" },
    });
    expect(inlines("[@\\[Tools\\]](plugin://tools)")[0]).toMatchObject({
      type: "pluginMention",
      attrs: { name: "Tools", displayName: "Tools" },
    });
    expect(
      inlines(
        "[$openai_api?label=API+Guide&icon=pencil-sparkle](/skills/a)",
      )[0],
    ).toMatchObject({
      type: "skillMention",
      attrs: {
        name: "openai_api",
        displayName: "API Guide",
        skillIcon: "pencil-sparkle",
      },
    });
    expect(inlines("[$github_api](/skills/a)")[0]).toMatchObject({
      type: "skillMention",
      attrs: { displayName: "GitHub API" },
    });
    expect(inlines("[@agent](agent://conversation)")[0]).toMatchObject({
      type: "agentMention",
      attrs: { conversationId: "conversation", name: "agent" },
    });
    expect(inlines("[@child](subagent://child)")[0]).toMatchObject({
      type: "agentMention",
      attrs: { conversationId: null },
    });
    expect(
      inlines(
        "[@review?label=Review&icon=not-allowed](browser-skill:///review)",
      )[0],
    ).toMatchObject({
      type: "browserSkillMention",
      attrs: { name: "review", displayName: "Review", skillIcon: null },
    });
    expect(
      inlines("[$Sites](app://sites@openai-curated-remote)")[0].attrs
        ?.iconSmall,
    ).toMatch(/^data:image\/svg\+xml;utf8,%3Csvg/);
    expect(
      inlines("[@Sites](plugin://sites@openai-curated-remote)")[0].attrs
        ?.iconSmall,
    ).toMatch(/^data:image\/svg\+xml;utf8,%3Csvg/);
    expect(inlines("[My site](sites-project://project-id)")[0].type).toBe(
      "sitesProjectMention",
    );
  });

  it("validates hosted resource identities and preserves unhosted resource queries", () => {
    expect(
      inlines("[data](mcp-resource://server/%2Fa%3Fq%3D1)")[0],
    ).toMatchObject({
      type: "resourceMention",
      attrs: { resourceUri: "/a?q=1", server: "server" },
    });
    expect(
      inlines("[data](mcp-resource://server/path?query=value)")[0],
    ).toMatchObject({
      type: "resourceMention",
      attrs: { resourceUri: "path?query=value" },
    });
    expect(
      inlines("[data](mcp-resource://server/path?connector_id=c&link_id=l)")[0],
    ).toMatchObject({
      type: "resourceMention",
      attrs: { resourceUri: "path", connectorId: "c", linkId: "l" },
    });
    expect(
      inlines("[data](mcp-resource://server/path?connector_id=c)")[0].type,
    ).toBe("text");
  });

  it("validates browser snapshots before restoring a chip and uses snapshot title on serialization", () => {
    const params = new URLSearchParams({
      mention: "tab-v1",
      browserId: "browser",
      tabId: "123",
      title: "  Report\r\nTitle  ",
      url: "https://example.com",
    });
    const path = `plugin://browser@openai-bundled?${params}`;
    const parsed = parsePromptText(`[old title](${path})`);
    expect(parsed.content[0].content?.[0].type).toBe("browserTabMention");
    expect(serializePromptText(parsed)).toBe(`[Report Title](${path})`);
    expect(inlines(`[old title](${path}&extra=1)`)[0].type).toBe(
      "pluginMention",
    );
  });

  it("validates task UUIDs, constrained Codex text links and page references", () => {
    const id = "12345678-1234-1234-8123-123456789abc";
    expect(inlines(`[task](task:${id}?owner=me)`)[0].type).toBe(
      "pageTaskMention",
    );
    expect(inlines(`[task](task:not-uuid?owner=me)`)[0].type).toBe("text");
    expect(
      inlines(
        `[thread](codex-text-link://codex://threads/${id}?hostId=local)`,
      )[0],
    ).toMatchObject({
      type: "text",
      marks: [
        { type: "link", attrs: { href: `codex://threads/${id}?hostId=local` } },
      ],
    });
    for (const href of [
      "codex://threads/not-uuid",
      `codex://threads/${id}?view=review`,
      `codex://threads/${id}/extra`,
    ])
      expect(
        inlines(`[thread](codex-text-link://${href})`)[0].marks,
      ).toBeUndefined();
    expect(inlines("[Page](page://page-id#block)")[0].type).toBe(
      "pageReferenceMention",
    );
    expect(inlines("[Page](https://chatgpt.com/space/page-id)")[0].type).toBe(
      "pageReferenceMention",
    );
    expect(inlines("[Page](space://page-id#block)")[0].type).toBe("text");
  });

  it("produces documents accepted by the native plain leaf and link schema contract", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
        ...Object.fromEntries(
          Object.entries(promptAtomAttributes).map(([name, attrs]) => [
            name,
            {
              inline: true,
              group: "inline",
              selectable: false,
              draggable: false,
              attrs,
            },
          ]),
        ),
      },
      marks: { link: { attrs: promptLinkAttributes, inclusive: false } },
    });
    const source = "[file](/a) [$app](app://a) [doc](https://example.com)\n";
    const restored = schema.nodeFromJSON(
      parsePromptText(source, historyOptions),
    );
    restored.check();
    expect(serializePromptText(restored.toJSON() as PromptDocument)).toBe(
      source,
    );
    expect(Object.keys(promptAtomAttributes)).toHaveLength(16);
    expect(restored.type.name).toBe("doc");
  });
});

describe("Native plain prompt serialization", () => {
  it("uses B4 authored escaping without imposing generic Markdown escaping", () => {
    expect(serializePromptLink("a[b](c)\\", "a)b\\c")).toBe(
      "[a\\[b\\]\\(c)\\\\](a\\)b\\\\c)",
    );
    expect(serializePromptLink("**bold**", "/file")).toBe("[**bold**](/file)");
    expect(serializePromptLink("label", "https://example.com", "A title")).toBe(
      '[label](https://example.com "A title")',
    );
  });

  it("separates getText output, persisted text markers and submit-time AA normalization", () => {
    const source = doc(link("guide", "https://example.com"));
    expect(serializePromptText(source)).toBe("[guide](https://example.com)");
    expect(serializePromptText(source, plainTextOptions)).toBe(
      "[guide](codex-text-link://https://example.com)",
    );
    expect(
      normalizeUserMessageMarkdown(
        serializePromptText(source, plainTextOptions),
      ),
    ).toBe("[guide](https://example.com)");
    expect(
      serializePromptText(
        doc(link("https://example.com", "https://example.com")),
        plainTextOptions,
      ),
    ).toBe("https://example.com");
    expect(
      serializePromptText(
        doc(link("https://example.com", "https://example.com")),
      ),
    ).toBe("[https://example.com](https://example.com)");
    expect(
      serializePromptText(
        doc(link("https://example.com", null)),
        plainTextOptions,
      ),
    ).toBe("[https://example.com](https://example.com)");
    expect(
      serializePromptText(doc(link("not a URL", null)), plainTextOptions),
    ).toBe("not a URL");
  });

  it("aggregates adjacent text with equal link attrs while ignoring other marks", () => {
    const first = link("read", "https://example.com");
    first.marks!.push({ type: "strong" });
    const next = link(" more", "https://example.com");
    next.marks![0].attrs = { title: null, href: "https://example.com" };
    expect(serializePromptText(doc(first, next))).toBe(
      "[read more](https://example.com)",
    );
    expect(
      serializePromptText(doc(first, { type: "text", text: " plain" })),
    ).toBe("[read](https://example.com) plain");
  });

  it("preserves link titles with escaping through storage and history restoration", () => {
    const original = doc(
      link("read guide", "https://example.com/path", 'A "title" (part)'),
    );
    const stored = serializePromptText(original, plainTextOptions);
    const restored = parsePromptText(stored, historyOptions);
    expect(restored.content[0].content?.[0]).toMatchObject({
      text: "read guide",
      marks: [
        {
          attrs: {
            href: "https://example.com/path",
            title: 'A "title" (part)',
          },
        },
      ],
    });
    expect(serializePromptText(restored, plainTextOptions)).toBe(stored);
  });

  it("uses fs paths only on request and preserves the directory slash", () => {
    const source = doc(
      atom("atMention", {
        label: "folder",
        path: "virtual/folder/",
        fsPath: "/actual/folder",
      }),
    );
    expect(serializePromptText(source)).toBe("[folder](virtual/folder/)");
    expect(serializePromptText(source, { preferFileMentionFsPath: true })).toBe(
      "[folder](/actual/folder/)",
    );
  });

  it("omits unresolved skills unless the draft-preservation caller asks for them", () => {
    const unresolved = doc(
      atom("skillMention", {
        name: "skill",
        displayName: "Skill",
        path: "",
        promptLinkLabel: "$chosen",
      }),
    );
    expect(serializePromptText(unresolved)).toBe("");
    expect(
      serializePromptText(unresolved, {
        preserveUnresolvedSkillMentions: true,
      }),
    ).toBe("$chosen");
    const resolved = doc(
      atom("skillMention", {
        name: "skill",
        path: "/skills/file",
        promptLinkLabel: "$chosen?label=Chosen",
      }),
    );
    expect(serializePromptText(resolved)).toBe(
      "[$chosen?label=Chosen](/skills/file)",
    );
  });

  it("uses native labels and canonical paths for every supported atom", () => {
    const id = "12345678-1234-1234-8123-123456789abc";
    const cases: [PromptNode, string][] = [
      [
        atom("agentMention", {
          name: "name",
          displayName: "Name",
          path: "agent://id",
        }),
        "[@Name](agent://id)",
      ],
      [
        atom("browserSkillMention", {
          name: "skill",
          displayName: "Skill",
          path: "browser-skill:///skill",
        }),
        "[@Skill](browser-skill:///skill)",
      ],
      [
        atom("appMention", {
          name: "app-name",
          displayName: "App Name",
          path: "app://app",
        }),
        "[$app-name](app://app)",
      ],
      [
        atom("pluginMention", {
          name: "plugin",
          displayName: "Plugin",
          path: "plugin://plugin",
        }),
        "[@Plugin](plugin://plugin)",
      ],
      [
        atom("chatGptSystemHint", { label: "Search", systemHint: "search" }),
        "[Search](chatgpt-system-hint://search)",
      ],
      [
        atom("chatGptConversationMention", {
          title: "Chat",
          path: "chatgpt-conversation://id",
        }),
        "[Chat](chatgpt-conversation://id)",
      ],
      [
        atom("sitesProjectMention", {
          title: "Site",
          path: "sites-project://id",
        }),
        "[Site](sites-project://id)",
      ],
      [
        atom("pageReferenceMention", { title: "Page", path: "page://id" }),
        "[Page](page://id)",
      ],
      [
        atom("pageTaskMention", { path: `task:${id}?owner=me` }),
        `[@ChatGPT](task:${id}?owner=me)`,
      ],
      [
        atom("pageTaskMention", { path: `task:${id}?owner=me&orbit=${id}` }),
        `[@dot](task:${id}?owner=me&orbit=${id})`,
      ],
      [
        atom("chatGptReferenceImageMention", {
          title: "Image",
          referenceImageId: "img id",
          assetPointer: "a b",
          thumbnailAssetPointer: "t",
        }),
        "[Image](chatgpt-reference-image://img%20id?assetPointer=a+b&thumbnailAssetPointer=t)",
      ],
      [
        atom("resourceMention", {
          title: "Data",
          server: "server id",
          resourceUri: "/path?x=y",
          connectorId: "app",
          linkId: "account",
        }),
        "[Data](mcp-resource://server%20id/%2Fpath%3Fx%3Dy?connector_id=app&link_id=account)",
      ],
    ];
    for (const [entry, expected] of cases)
      expect(serializePromptText(doc(entry))).toBe(expected);
  });

  it("rejects incomplete hosted resources instead of sending a different resource identity", () => {
    expect(() =>
      serializePromptText(
        doc(
          atom("resourceMention", {
            title: "Data",
            server: "server",
            resourceUri: "uri",
            connectorId: "app",
            linkId: "",
          }),
        ),
      ),
    ).toThrow("require an app and account");
    expect(() =>
      serializePromptText(
        doc(
          atom("browserTabMention", {
            path: "plugin://browser@openai-bundled?invalid",
          }),
        ),
      ),
    ).toThrow("Invalid browser tab mention path");
  });

  it("serializes as a raw URL only for validated mounted provider source links", () => {
    const href = "https://docs.google.com/document/d/abcde/edit";
    expect(
      serializePromptText(
        doc(
          atom("richLink", { displayText: "Doc", href, serializeAsUrl: true }),
        ),
      ),
    ).toBe(href);
    expect(
      serializePromptText(
        doc(
          atom("richLink", {
            displayText: "Doc",
            href: "https://example.com/doc",
            serializeAsUrl: true,
          }),
        ),
      ),
    ).toBe("[Doc](https://example.com/doc)");
  });

  it("serializes library fields in native query insertion order", () => {
    expect(
      serializeLibraryMention({
        libraryFileId: "id /",
        fileId: "f 1",
        mimeType: "text/plain",
        libraryArtifactType: "document",
        entrypoint: "at_mention",
        sourceUrl: "https://example.com",
        serializeAsUrl: true,
      }),
    ).toBe(
      "chatgpt-library-file://id%20%2F?fileId=f+1&mimeType=text%2Fplain&libraryArtifactType=document&entrypoint=at_mention&sourceUrl=https%3A%2F%2Fexample.com&asUrl=1",
    );
  });
});

describe("KX clipboard and code-block contract", () => {
  const clipboard = { forClipboard: true };
  const paragraph = (text: string): PromptNode => ({
    type: "paragraph",
    ...(text ? { content: [{ type: "text", text }] } : {}),
  });
  const codeBlock = (
    text: string,
    attrs: Record<string, unknown> = {},
  ): PromptNode => ({
    type: "code_block",
    attrs,
    ...(text ? { content: [{ type: "text", text }] } : {}),
  });
  const blocks = (...content: PromptNode[]): PromptDocument => ({
    type: "doc",
    content,
  });

  it("copies all atom labels using native leafText before qX, without Markdown wrappers", () => {
    const id = "12345678-1234-1234-8123-123456789abc";
    const tab = `plugin://browser@openai-bundled?${new URLSearchParams({ mention: "tab-v1", browserId: "browser", tabId: "tab", title: "Tab title", url: "https://example.com" })}`;
    const cases: [PromptNode, string][] = [
      [
        atom("atMention", {
          label: "file.txt",
          path: "virtual/file",
          fsPath: "/actual/file",
        }),
        "file.txt",
      ],
      [
        atom("agentMention", {
          name: "agent",
          displayName: "Agent",
          path: "agent://id",
        }),
        "@Agent",
      ],
      [
        atom("skillMention", {
          name: "skill",
          displayName: "Stored title",
          path: "/skill",
          promptLinkLabel: "$skill?label=Authored+title",
        }),
        "Authored title",
      ],
      [
        atom("browserSkillMention", {
          name: "browser-skill",
          displayName: "Browser skill",
          path: "browser-skill:///skill",
        }),
        "Browser skill",
      ],
      [
        atom("appMention", {
          name: "app-id",
          displayName: "App title",
          path: "app://id",
        }),
        "App title",
      ],
      [
        atom("pluginMention", {
          name: "plugin-id",
          displayName: "Plugin title",
          path: "plugin://id",
        }),
        "Plugin title",
      ],
      [
        atom("chatGptSystemHint", { label: "Search", systemHint: "search" }),
        "Search",
      ],
      [
        atom("richLink", {
          displayText: "Canonical title",
          href: "https://example.com",
          isLoading: true,
          loadingDisplayText: "Loading title",
        }),
        "Canonical title",
      ],
      [
        atom("resourceMention", {
          title: "Data",
          server: "server",
          resourceUri: "resource",
          connectorId: "app",
          linkId: "",
        }),
        "Data",
      ],
      [atom("browserTabMention", { path: tab }), "Tab title"],
      [
        atom("chatGptConversationMention", {
          title: "Conversation",
          path: "chatgpt-conversation://id",
        }),
        "Conversation",
      ],
      [
        atom("chatGptLibraryFileMention", {
          title: "Library document",
          libraryFileId: "libfile_id",
          serializeAsUrl: true,
          sourceUrl: "https://docs.google.com/document/d/abcde/edit",
        }),
        "Library document",
      ],
      [
        atom("chatGptReferenceImageMention", {
          title: "Reference image",
          referenceImageId: "image",
        }),
        "Reference image",
      ],
      [
        atom("sitesProjectMention", {
          title: "Site title",
          path: "sites-project://id",
        }),
        "Site title",
      ],
      [
        atom("pageReferenceMention", {
          title: "Page title",
          path: "page://id",
        }),
        "Page title",
      ],
      [
        atom("pageTaskMention", { path: `task:${id}?owner=me&orbit=${id}` }),
        "@dot",
      ],
    ];
    for (const [entry, label] of cases)
      expect(
        serializePromptText(doc(entry), {
          ...clipboard,
          preferFileMentionFsPath: true,
        }),
      ).toBe(label);
  });

  it("copies unresolved skill visible names before unresolved-skill omission", () => {
    const entry = atom("skillMention", {
      name: "skill",
      displayName: "Skill title",
      path: "",
      promptLinkLabel: "$skill?label=Custom+title",
    });
    expect(serializePromptText(doc(entry))).toBe("");
    expect(serializePromptText(doc(entry), clipboard)).toBe("Custom title");
    expect(
      serializePromptText(
        doc(
          atom("pluginMention", {
            name: "fallback",
            displayName: "",
            path: "plugin://id",
          }),
        ),
        clipboard,
      ),
    ).toBe("fallback");
  });

  it("keeps validated provider raw URLs ahead of clipboard display labels", () => {
    const href = "https://docs.google.com/document/d/abcde/edit";
    const rich = (target: string, serializeAsUrl = true) =>
      atom("richLink", {
        displayText: "Document title",
        href: target,
        serializeAsUrl,
      });
    expect(serializePromptText(doc(rich(href)), clipboard)).toBe(href);
    expect(serializePromptText(doc(rich(href, false)), clipboard)).toBe(
      "Document title",
    );
    expect(
      serializePromptText(doc(rich("https://example.com/doc")), clipboard),
    ).toBe("Document title");
    expect(serializePromptText(doc(rich(` ${href}`)), clipboard)).toBe(
      "Document title",
    );
  });

  it("copies autolink text and equal-href URLs, but retains authored explicit-link Markdown", () => {
    expect(
      serializePromptText(doc(link("https://example.com", null)), clipboard),
    ).toBe("https://example.com");
    expect(serializePromptText(doc(link("not a URL", null)), clipboard)).toBe(
      "not a URL",
    );
    expect(
      serializePromptText(
        doc(link("https://example.com", "https://example.com")),
        clipboard,
      ),
    ).toBe("https://example.com");
    expect(
      serializePromptText(doc(link("Guide", "https://example.com")), clipboard),
    ).toBe("[Guide](https://example.com)");
    expect(
      serializePromptText(
        doc(link("https://example.com", "https://example.com", "Title")),
        clipboard,
      ),
    ).toBe('[https://example.com](https://example.com "Title")');
    expect(
      serializePromptText(doc(link("Guide", "https://example.com")), {
        ...clipboard,
        preserveTextLinkMarks: true,
      }),
    ).toBe("[Guide](codex-text-link://https://example.com)");
  });

  it("preserves code body and only one generated newline between successive blocks", () => {
    const source = blocks(
      paragraph("Before"),
      codeBlock("const x = 1;\nprint(x)", { language: "js" }),
      paragraph("After"),
    );
    expect(serializePromptText(source)).toBe(
      "Before\n```js\nconst x = 1;\nprint(x)\n```\nAfter",
    );
    expect(serializePromptText(source, clipboard)).toBe(
      serializePromptText(source),
    );
    expect(serializePromptText(blocks(codeBlock("")))).toBe("```\n\n```");
    expect(serializePromptText(blocks(codeBlock("x\n"), paragraph("")))).toBe(
      "```\nx\n\n```\n",
    );
  });

  it("chooses a backtick fence longer than every code run and never normalizes the body", () => {
    const code = " a`b\r\n```\n`````z\t ";
    expect(serializePromptText(blocks(codeBlock(code)))).toBe(
      `\`\`\`\`\`\`\n${code}\n\`\`\`\`\`\``,
    );
    const split: PromptNode = {
      type: "code_block",
      content: [
        { type: "text", text: "left" },
        { type: "text", text: "\nright" },
      ],
    };
    expect(serializePromptText(blocks(split))).toBe("```\nleft\nright\n```");
  });

  it("uses TFn language validation without alias normalization or automatic plaintext fences", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{}, ""],
      [{ language: "plaintext" }, ""],
      [{ language: "plaintext", autoDetectLanguage: true }, ""],
      [{ language: "plaintext", autoDetectLanguage: false }, "plaintext"],
      [{ language: "C++" }, "C++"],
      [{ language: "JavaScript" }, "JavaScript"],
      [{ language: "bad language" }, ""],
      [{ language: "js`" }, ""],
      [{ language: " js" }, ""],
      [{ language: "" }, ""],
      [{ lang: "js" }, ""],
    ];
    for (const [attrs, language] of cases)
      expect(serializePromptText(blocks(codeBlock("body", attrs)))).toBe(
        `\`\`\`${language}\nbody\n\`\`\``,
      );
  });

  it("serializes nested list continuation paragraphs and fenced code with native marker indentation", () => {
    const list: PromptNode = {
      type: "ordered_list",
      attrs: { startingNumber: 9 },
      content: [
        {
          type: "regular_list_item",
          content: [
            paragraph("Nine"),
            paragraph("continuation"),
            {
              type: "list",
              content: [
                {
                  type: "regular_list_item",
                  content: [
                    paragraph("nested"),
                    codeBlock("one\ntwo", { language: "text" }),
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "regular_list_item",
          content: [paragraph("Ten"), codeBlock("body")],
        },
      ],
    };
    expect(serializePromptText(blocks(list))).toBe(
      "9. Nine\n   continuation\n   - nested\n     ```text\n     one\n     two\n     ```\n10. Ten\n    ```\n    body\n    ```",
    );
  });
});
