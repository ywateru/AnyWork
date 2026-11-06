import { describe, expect, it } from "vitest";
import { Schema, type Node as ProseMirrorNode } from "prosemirror-model";
import { promptAtomAttributes, promptLinkAttributes } from "./promptText";
import {
  createRichPromptSchema,
  getRichPromptText,
  parseRichPromptText,
  serializeRichPromptText,
  parsePlainRichPromptText,
} from "./richPrompt";

// Static iga/zkn/PZ contract. The original installed application is not started
// or evaluated by these tests. The base leaves stand in for the editor views.
const base = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    code_block: {
      content: "text*",
      group: "block",
      attrs: {
        autoDetectLanguage: { default: true },
        language: { default: null },
      },
      marks: "",
      code: true,
    },
    text: { group: "inline" },
    ...Object.fromEntries(
      Object.entries(promptAtomAttributes).map(([type, attrs]) => [
        type,
        {
          attrs,
          inline: true,
          group: "inline",
          selectable: false,
          draggable: false,
        },
      ]),
    ),
  },
  marks: { link: { attrs: promptLinkAttributes, inclusive: false } },
});
const schema = createRichPromptSchema(base);
const parse = (source: string) => parseRichPromptText(schema, source);

describe("native plain history setText", () => {
  it("keeps whitespace Markdown nonempty for the persisted history gate", () => {
    expect(
      serializeRichPromptText(parsePlainRichPromptText(schema, "   ")),
    ).toBe("&#x20; &#x20;");
  });
  it("keeps inline formatting, headings and HTML literal", () => {
    const doc = parsePlainRichPromptText(
      schema,
      "**literal**\n# title\n<b>html</b>",
    );
    expect(doc.childCount).toBe(3);
    expect(doc.firstChild!.firstChild!.marks).toEqual([]);
    expect(doc.child(1).type.name).toBe("paragraph");
    expect(doc.child(2).textContent).toBe("<b>html</b>");
  });
  it("restores nested lists and indented continuation paragraphs without inline parsing", () => {
    const doc = parsePlainRichPromptText(
      schema,
      "- **outer**\n\t3. *nested*\n  continuation\n- [x] literal task\n\nafter",
    );
    doc.check();
    expect(doc.firstChild!.type.name).toBe("list");
    const first = doc.firstChild!.firstChild!;
    expect(first.child(1).type.name).toBe("ordered_list");
    expect(first.child(1).attrs.startingNumber).toBe(3);
    expect(first.child(2).textContent).toBe("continuation");
    expect(doc.firstChild!.child(1).type.name).toBe("regular_list_item");
    expect(doc.firstChild!.child(1).textContent).toBe("[x] literal task");
    expect(first.firstChild!.firstChild!.marks).toEqual([]);
    expect(doc.childCount).toBe(3);
  });
  it("recognizes only closed backtick fences with an adequate closing length", () => {
    const doc = parsePlainRichPromptText(
      schema,
      "````ts\n**code**\n```\n`````\nafter",
    );
    expect(doc.firstChild!.type.name).toBe("code_block");
    expect(doc.firstChild!.textContent).toBe("**code**\n```");
    expect(doc.firstChild!.attrs.language).toBe("ts");
    expect(doc.firstChild!.attrs.autoDetectLanguage).toBe(false);
    expect(doc.child(1).textContent).toBe("after");
    expect(
      parsePlainRichPromptText(schema, "```\nopen").firstChild!.type.name,
    ).toBe("paragraph");
    expect(
      parsePlainRichPromptText(schema, "~~~ts\nbody\n~~~").firstChild!.type
        .name,
    ).toBe("paragraph");
  });
  it("retains blank lines and returns an editable paragraph for empty text", () => {
    expect(parsePlainRichPromptText(schema, "\n\n").childCount).toBe(3);
    const empty = parsePlainRichPromptText(schema, "");
    empty.check();
    expect(empty.firstChild!.type.name).toBe("paragraph");
    expect(empty.firstChild!.content.size).toBe(0);
  });
});
const textParagraph = (value: string) =>
  schema.nodes.paragraph.create(null, value ? schema.text(value) : null);
function descendants(node: ProseMirrorNode, name: string): ProseMirrorNode[] {
  const found: ProseMirrorNode[] = [];
  node.descendants((child) => {
    if (child.type.name === name) found.push(child);
  });
  return found;
}
function canonical(source: string) {
  return serializeRichPromptText(parse(source));
}

describe("Native main rich schema", () => {
  it("keeps native node/mark names and the inherited reference node specifications", () => {
    expect(Object.keys(schema.nodes)).toEqual([
      "doc",
      "paragraph",
      "blockquote",
      "hard_break",
      "code_block",
      "heading",
      "horizontal_rule",
      "regular_list_item",
      "task_list_item",
      "ordered_list",
      "list",
      "text",
      "table",
      "table_row",
      "table_cell",
      ...Object.keys(promptAtomAttributes),
    ]);
    expect(Object.keys(schema.marks)).toEqual([
      "code",
      "strong",
      "em",
      "link",
      "strikethrough",
      "startend",
      "literalPaste",
    ]);
    expect(schema.nodes.atMention.spec.selectable).toBe(false);
    expect(schema.nodes.atMention.spec.attrs?.label).toBe(
      base.nodes.atMention.spec.attrs?.label,
    );
    expect(schema.nodes.paragraph.create().attrs.paragraphGap).toBe(false);
    expect(schema.nodes.code_block.create().attrs).toMatchObject({
      lang: null,
      isDarkMode: null,
      language: null,
      autoDetectLanguage: true,
    });
    expect(schema.nodes.ordered_list.spec.attrs).toHaveProperty(
      "startingNumber.default",
      1,
    );
    expect(schema.nodes.list.spec.attrs).toHaveProperty(
      "spread.default",
      false,
    );
  });

  it("keeps text-only headings, inline table cells, hard-break marks and required source-span marks", () => {
    expect(schema.nodes.heading.spec.content).toBe("text*");
    expect(schema.nodes.table_cell.spec.content).toBe("inline*");
    expect(schema.nodes.hard_break.spec.marks).toBe("startend");
    expect(schema.nodes.code_block.spec.marks).toBe("startend");
    expect(schema.marks.startend.spec.attrs).toEqual({ start: {}, end: {} });
    expect(schema.marks.literalPaste.spec).toMatchObject({
      inclusive: false,
      excludes: "",
    });
    expect(() =>
      schema.nodes.heading
        .createChecked({ level: 7 }, schema.text("heading"))
        .check(),
    ).toThrow("Invalid heading level");
  });
});

describe("Native main Markdown restoration", () => {
  it("restores formatting, headings, quotes, nested lists, task states and code data", () => {
    const source =
      "# Plan\n\nText **bold** and _em_ ~~old~~ `code`.\n\n- [x] done\n- [ ] pending\n  - nested\n\n3. third\n4. fourth\n\n> quote\n\n---\n\n```TypeScript\nconst value = 1;\n```";
    const document = parse(source);
    document.check();
    expect(descendants(document, "heading")[0]).toMatchObject({
      attrs: { level: 1 },
    });
    expect(
      descendants(document, "task_list_item").map((node) => node.attrs.checked),
    ).toEqual([true, false]);
    expect(descendants(document, "ordered_list")[0].attrs.startingNumber).toBe(
      3,
    );
    expect(descendants(document, "list")).toHaveLength(2);
    expect(descendants(document, "blockquote")[0].textContent).toBe("quote");
    expect(descendants(document, "horizontal_rule")).toHaveLength(1);
    expect(descendants(document, "code_block")[0]).toMatchObject({
      attrs: {
        lang: "TypeScript",
        language: "TypeScript",
        autoDetectLanguage: false,
      },
    });
    const marked = descendants(document, "text").flatMap((node) =>
      node.marks.map((mark) => mark.type.name),
    );
    expect(marked).toEqual(
      expect.arrayContaining([
        "strong",
        "em",
        "strikethrough",
        "code",
        "startend",
      ]),
    );
    const serialized = serializeRichPromptText(document);
    expect(serialized).toContain("- [x] done\n- [ ] pending\n  - nested");
    expect(serialized).toContain("```TypeScript\nconst value = 1;\n```");
    expect(canonical(serialized)).toBe(serialized);
  });

  it("preserves source positions on block nodes and text startend marks", () => {
    const document = parse("**bold**");
    const paragraph = document.firstChild!,
      value = paragraph.firstChild!;
    expect(paragraph.attrs).toMatchObject({ start: 0, end: 8 });
    expect(
      value.marks.find((mark) => mark.type.name === "startend")?.attrs,
    ).toEqual({ start: 2, end: 6 });
    expect(serializeRichPromptText(document)).toBe("**bold**");
  });

  it("keeps soft LF inside text and serializes all-paragraph documents with one LF", () => {
    const source = "first\nsecond";
    const document = parse(source);
    expect(document.childCount).toBe(1);
    expect(document.firstChild!.textContent).toBe(source);
    expect(serializeRichPromptText(document)).toBe(source);
    const literal = schema.nodes.doc.create(null, [
      textParagraph("first"),
      textParagraph(""),
      textParagraph("last"),
      textParagraph(""),
    ]);
    expect(serializeRichPromptText(literal)).toBe("first\n\nlast\n");
  });

  it("uses blank-line token normalization to preserve extra top-level gaps without adding nested separators", () => {
    expect(canonical("first\n\nsecond")).toBe("first\nsecond");
    expect(canonical("first\n\n\n\nsecond")).toBe("first\n\nsecond");
    expect(
      descendants(parse("> first\n>\n>\n> second"), "paragraph").map(
        (node) => node.textContent,
      ),
    ).toEqual(["first", "second"]);
    expect(parse("\n\n").childCount).toBeGreaterThan(0);
  });

  it("preserves final authored spaces and tabs only on final paragraphs", () => {
    expect(parse("text  \t").textContent).toBe("text  \t");
    expect(parse("# Heading  ").textContent).toBe("Heading");
    expect(parse("```txt\ncode\n```  ").lastChild?.type.name).toBe(
      "code_block",
    );
    expect(getRichPromptText(parse("**bold** "))).toBe("**bold** ");
  });

  it("uses the native inline-code opening boundary and rejects single-tilde strike syntax", () => {
    expect(
      descendants(parse("word`literal` and `code`"), "text")
        .filter((node) => node.marks.some((mark) => mark.type.name === "code"))
        .map((node) => node.text),
    ).toEqual(["code"]);
    expect(
      descendants(parse("~literal~ ~~deleted~~"), "text")
        .filter((node) =>
          node.marks.some((mark) => mark.type.name === "strikethrough"),
        )
        .map((node) => node.text),
    ).toEqual(["deleted"]);
  });

  it("restores references using native authored identities and preserves atom metadata on serialization", () => {
    const source =
      "[file](/workspace/a.txt) [$GitHub](app://github) [Plan](chatgpt-library-file://libfile_abc?mimeType=text%2Fplain&entrypoint=at_mention) [issue](https://github.com/org/repo/issues/1)";
    const document = parse(source);
    document.check();
    expect(descendants(document, "atMention")[0].attrs).toMatchObject({
      label: "file",
      path: "/workspace/a.txt",
      fsPath: "/workspace/a.txt",
    });
    expect(
      descendants(document, "chatGptLibraryFileMention")[0].attrs,
    ).toMatchObject({
      libraryFileId: "libfile_abc",
      mimeType: "text/plain",
      entrypoint: "at_mention",
    });
    expect(descendants(document, "richLink")[0].attrs).toMatchObject({
      sourceAppId: "github",
      markdownSourceStart: source.indexOf("[issue]"),
      markdownSourceEnd: source.length,
    });
    const serialized = serializeRichPromptText(document);
    expect(serialized).toContain("[file](/workspace/a.txt)");
    expect(serialized).toContain(
      "chatgpt-library-file://libfile_abc?mimeType=text%2Fplain\\&entrypoint=at_mention",
    );
    expect(serialized).toContain(
      "[issue](https://github.com/org/repo/issues/1)",
    );
    expect(
      descendants(parse(serialized), "chatGptLibraryFileMention")[0].attrs
        .libraryFileId,
    ).toBe("libfile_abc");
  });

  it("can disable file-path chips for goal callers while preserving real app references", () => {
    const document = parseRichPromptText(
      schema,
      "[file](/workspace/a.txt) [app](app://github)",
      { restorePathLinksAsFileMentions: false },
    );
    expect(descendants(document, "atMention")).toHaveLength(0);
    expect(document.textContent).toBe("file ");
    expect(descendants(document, "appMention")).toHaveLength(1);
  });

  it("keeps titles and formatted link labels as text links instead of opaque rich-link chips", () => {
    const document = parse(
      '[issue](https://github.com/org/repo/issues/1 "Title") [**formatted**](https://example.com)',
    );
    expect(descendants(document, "richLink")).toHaveLength(0);
    const links = descendants(document, "text").filter((node) =>
      node.marks.some((mark) => mark.type.name === "link"),
    );
    expect(
      links[0].marks.find((mark) => mark.type.name === "link")?.attrs.title,
    ).toBe("Title");
    expect(
      links.at(-1)?.marks.some((mark) => mark.type.name === "strong"),
    ).toBe(true);
    expect(canonical(serializeRichPromptText(document))).toBe(
      serializeRichPromptText(document),
    );
  });

  it("resolves reference definitions and rejects unsupported link protocols without discarding visible text", () => {
    const document = parse(
      '[Guide][guide] [bad](javascript:run)\n\n[guide]: https://example.com "Title"',
    );
    expect(document.textContent).toBe("Guide bad");
    expect(serializeRichPromptText(document)).toBe(
      '[Guide](https://example.com "Title") bad',
    );
    expect(getRichPromptText(parse("person@example.com"))).toBe(
      "person@example.com",
    );
  });

  it("does not invent nodes for unknown Markdown image or HTML payloads", () => {
    expect(parse("![image](https://example.com/image.png)").textContent).toBe(
      "",
    );
    expect(parse("<div>raw HTML</div>").textContent).toBe("");
    expect(descendants(parse("# [file](/path)"), "heading")).toHaveLength(0);
  });

  it("restores GFM table cell alignment, header identity, inline marks and table breaks", () => {
    const document = parse(
      "| Name | Value |\n| :--- | ---: |\n| **A** | one<br>two |",
    );
    document.check();
    expect(descendants(document, "table")).toHaveLength(1);
    const cells = descendants(document, "table_cell");
    expect(cells.map((cell) => cell.attrs.rowIndex)).toEqual([0, 0, 1, 1]);
    expect(cells.map((cell) => cell.attrs.align)).toEqual([
      "left",
      "right",
      "left",
      "right",
    ]);
    expect(
      cells.every(
        (cell) =>
          cell.attrs.columnIndex === null &&
          cell.attrs.colspan === 1 &&
          cell.attrs.rowspan === 1,
      ),
    ).toBe(true);
    expect(descendants(cells[3], "hard_break")).toHaveLength(1);
    const serialized = serializeRichPromptText(document);
    expect(serialized).toContain("one<br>two");
    expect(serialized).toContain("**A**");
    expect(canonical(serialized)).toBe(serialized);
  });
});

describe("Native rich serialization boundaries", () => {
  it("keeps links outside formatting marks and normalizes null-href URL runs across other marks", () => {
    expect(canonical("[**formatted**](https://example.com)")).toBe(
      "[**formatted**](https://example.com)",
    );
    const link = schema.marks.link.create({ href: null });
    const paragraph = schema.nodes.paragraph.create(null, [
      schema.text("https://", [link]),
      schema.text("example.com", [schema.marks.strong.create(), link]),
    ]);
    const document = schema.nodes.doc.create(null, paragraph);
    expect(serializeRichPromptText(document)).toBe(
      "[https://](https://example.com)[**example.com**](https://example.com)",
    );
    expect(document.firstChild!.firstChild!.marks[0].attrs.href).toBeNull();
    const invalid = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, [
        schema.text("not ", [link]),
        schema.text("a URL", [schema.marks.strong.create(), link]),
      ]),
    );
    expect(serializeRichPromptText(invalid)).toBe("not **a URL**");
  });

  it("merges adjacent attention wrappers and restores terminal hard breaks and empty tasks", () => {
    const strong = schema.marks.strong.create(),
      em = schema.marks.em.create();
    const document = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, [
        schema.text("A", [strong]),
        schema.text("B", [strong, em]),
        schema.text("C", [strong]),
      ]),
    );
    expect(serializeRichPromptText(document)).toBe("**A*B*C**");
    expect(descendants(parse("text\\"), "hard_break")).toHaveLength(1);
    expect(
      descendants(parse("- [x]\n- [ ]"), "task_list_item").map(
        (node) => node.attrs.checked,
      ),
    ).toEqual([true, false]);
  });

  it("keeps source-span and literal-paste marks out of persisted Markdown and prompt format decisions", () => {
    const marked = schema.text("**literal**", [
      schema.marks.startend.create({ start: 0, end: 11 }),
      schema.marks.literalPaste.create(),
    ]);
    const document = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, marked),
    );
    expect(getRichPromptText(document)).toBe("**literal**");
    expect(serializeRichPromptText(document)).toBe("\\*\\*literal\\*\\*");
  });

  it("uses normalized provider URLs only for explicitly enabled richLink serialization", () => {
    const href = "https://docs.google.com/document/d/abcde/edit";
    const mention = schema.nodes.richLink.create({
      displayText: "Document",
      href,
      sourceAppId: "google-drive",
      serializeAsUrl: true,
    });
    const document = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, mention),
    );
    expect(serializeRichPromptText(document)).toBe(href);
    expect(getRichPromptText(document)).toBe(href);
  });

  it("chooses native code languages and code fences while avoiding an extra gap before code", () => {
    const code = schema.nodes.code_block.create(
      { language: "plaintext", autoDetectLanguage: true },
      schema.text("```\nbody"),
    );
    const document = schema.nodes.doc.create(null, [
      textParagraph("Before"),
      code,
      textParagraph("After"),
    ]);
    expect(serializeRichPromptText(document)).toBe(
      "Before\n````\n```\nbody\n````\n\nAfter",
    );
    const explicit = schema.nodes.code_block.create(
      { language: "plaintext", autoDetectLanguage: false },
      schema.text("body"),
    );
    expect(
      serializeRichPromptText(schema.nodes.doc.create(null, explicit)),
    ).toBe("```plaintext\nbody\n```");
  });

  it("preserves explicit empty paragraph gaps in mixed block documents", () => {
    const gap = schema.nodes.paragraph.create({ paragraphGap: true });
    const document = schema.nodes.doc.create(null, [
      schema.nodes.heading.create({ level: 1 }, schema.text("Title")),
      gap,
      textParagraph("Body"),
    ]);
    expect(serializeRichPromptText(document)).toBe("# Title\n\nBody");
  });
});
