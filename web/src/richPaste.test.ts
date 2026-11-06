import { describe, expect, it } from "vitest";
import { Fragment, Schema, Slice, type Node } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { createRichPromptSchema, getRichPromptText } from "./richPrompt";
import { promptAtomAttributes, promptLinkAttributes } from "./promptText";
import {
  decodeLiteralClipboardText,
  literalRichPaste,
  normalizeRichPasteSlice,
  pasteInCodeContext,
  replaceRichPaste,
} from "./richPaste";

const schema = createRichPromptSchema(
  new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      text: { group: "inline" },
      code_block: { content: "text*", group: "block", code: true },
      ...Object.fromEntries(
        Object.entries(promptAtomAttributes).map(([name, attrs]) => [
          name,
          { attrs, inline: true, group: "inline" },
        ]),
      ),
    },
    marks: { link: { attrs: promptLinkAttributes } },
  }),
);
const p = (...nodes: Node[]) => schema.nodes.paragraph.create(null, nodes);
const text = (value: string, marks: string[] = []) =>
  schema.text(
    value,
    marks.map((name) => schema.marks[name].create()),
  );
const br = () => schema.nodes.hard_break.create();
const state = (nodes: Node[], from = 1, to = from) => {
  const doc = schema.nodes.doc.create(null, nodes);
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, from, to),
  });
};

describe("Native rich paste document boundaries", () => {
  it("keeps literal Markdown, repeated newlines and terminal whitespace without parsing formatting", () => {
    const original = "**literal**\r\n\r\nend  \r";
    const doc = literalRichPaste(state([p()]), original)!.doc;
    expect(doc.childCount).toBe(1);
    expect(
      doc.firstChild!.content.content.filter(
        (n) => n.type.name === "hard_break",
      ),
    ).toHaveLength(3);
    expect(doc.firstChild!.firstChild!.marks.map((m) => m.type.name)).toEqual([
      "literalPaste",
    ]);
    expect(getRichPromptText(doc)).toBe("**literal**\n\nend  \n");
    expect(() => doc.check()).not.toThrow();
  });

  it("preserves the selection's formatting on every pasted line", () => {
    const doc = literalRichPaste(
      state([p(text("replace", ["strong"]))], 1, 8),
      "one\ntwo",
    )!.doc;
    const lines: Node[] = [];
    doc.descendants((n) => {
      if (n.isText) lines.push(n);
    });
    expect(
      lines.map((n) => [n.text, n.marks.some((m) => m.type.name === "strong")]),
    ).toEqual([
      ["one", true],
      ["two", true],
    ]);
  });

  it("recognizes inline code cursors and entirely marked selections while allowing mixed or cross-parent selections", () => {
    const nodes = [p(text("code", ["code"]), text(" plain")), p(text("other"))];
    expect(pasteInCodeContext(state(nodes, 2))).toBe(true);
    expect(pasteInCodeContext(state(nodes, 1, 5))).toBe(true);
    expect(pasteInCodeContext(state(nodes, 1, 8))).toBe(false);
    expect(pasteInCodeContext(state(nodes, 2, 14))).toBe(false);
    const stored = state([p()]);
    expect(
      pasteInCodeContext(
        stored.apply(stored.tr.setStoredMarks([schema.marks.code.create()])),
      ),
    ).toBe(true);
  });

  it("recognizes a code block only if both selection endpoints share its parent", () => {
    const nodes = [
      schema.nodes.code_block.create(null, text("code")),
      p(text("after")),
    ];
    expect(pasteInCodeContext(state(nodes, 1, 5))).toBe(true);
    expect(pasteInCodeContext(state(nodes, 1, 8))).toBe(false);
  });

  it("normalizes blank and trailing-break paragraphs while retaining intentional gap attributes", () => {
    const gap = schema.nodes.paragraph.create({ paragraphGap: true });
    const slice = Slice.maxOpen(
      Fragment.fromArray([
        p(text("one"), br(), br(), br()),
        p(text(" \u200b"), br(), br()),
        gap,
        p(text("two")),
      ]),
    );
    const normalized = normalizeRichPasteSlice(slice, schema);
    expect(normalized.content.content.map((n) => n.textContent)).toEqual([
      "one",
      "",
      "",
      "",
      "",
      "",
      "two",
    ]);
    expect(normalized.content.child(5).attrs.paragraphGap).toBe(true);
    expect(normalized.openStart).toBe(slice.openStart);
    expect(normalized.openEnd).toBe(slice.openEnd);
  });

  it("preserves an all-blank slice and a terminal nonblank paragraph's breaks", () => {
    const blank = Slice.maxOpen(
      Fragment.fromArray([p(text("  ")), p(br(), br())]),
    );
    expect(normalizeRichPasteSlice(blank, schema)).toBe(blank);
    const terminal = Slice.maxOpen(
      Fragment.fromArray([p(text("a")), p(text("b"), br(), br())]),
    );
    expect(normalizeRichPasteSlice(terminal, schema)).toBe(terminal);
  });

  it("places the caret after a final table and reuses an existing paragraph", () => {
    const table = schema.nodes.table.create(
      null,
      schema.nodes.table_row.create(
        null,
        schema.nodes.table_cell.create(null, text("cell")),
      ),
    );
    const empty = replaceRichPaste(
      state([p()]),
      Slice.maxOpen(Fragment.from(table)),
    );
    expect(empty.doc.lastChild!.type.name).toBe("paragraph");
    expect(empty.selection.$from.parent.type.name).toBe("paragraph");
    expect(empty.doc.childCount).toBe(3);
    expect(() => empty.doc.check()).not.toThrow();
    const existing = replaceRichPaste(
      state([p(), p(text("after"))]),
      Slice.maxOpen(Fragment.from(table)),
    );
    expect(existing.doc.childCount).toBe(3);
    expect(existing.selection.$from.parent.textContent).toBe("after");
  });

  it.each([
    ["\\*literal\\* &amp;", "*literal* &"],
    [
      "`x&amp;` **y&amp;** [a&amp;](https://example.test) &lt;",
      "`x&amp;` **y&amp;** [a&amp;](https://example.test) <",
    ],
    ["> &amp;\n# \\*text\\*\n\n- &#65;  ", "> &\n# *text*\n\n- A  "],
    ["~~&amp;~~ <b>&amp;</b>", "~~&amp;~~ <b>&</b>"],
  ])("decodes only plain inline tokens: %s", (source, expected) => {
    expect(decodeLiteralClipboardText(source)).toBe(expected);
  });
});
