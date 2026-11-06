import { describe, expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { promptAtomAttributes, promptLinkAttributes } from "./promptText";
import { editPromptLink } from "./promptLinkEditing";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*" },
    text: { group: "inline" },
    richLink: {
      inline: true,
      group: "inline",
      attrs: promptAtomAttributes.richLink,
    },
  },
  marks: { link: { attrs: promptLinkAttributes }, strong: {} },
});
function state(node: ReturnType<typeof schema.text>) {
  return EditorState.create({
    doc: schema.node("doc", null, schema.node("paragraph", null, node)),
  });
}
const atom = (attrs: object = {}) =>
  schema.nodes.richLink.create({
    displayText: "old",
    href: "https://example.com",
    sourceAppId: "",
    ...attrs,
  });

describe("native inline link edits", () => {
  it("retains text marks and link metadata but clears literal and automatic provenance", () => {
    const input = state(
      schema.text("old", [
        schema.marks.strong.create(),
        schema.marks.link.create({
          href: "https://old.test",
          title: "title",
          sourceAppId: "app",
          isAutolink: true,
          isGeneratedAutolink: true,
          literalMarkdownSource: "old",
          literalMarkdownOccurrenceId: 3,
        }),
      ]),
    );
    const next = editPromptLink(input, 1, 4, "changed", " https://new.test ")!
      .doc.firstChild!.firstChild!;
    expect(next.textContent).toBe("changed");
    expect(next.marks.map((mark) => mark.type.name)).toEqual([
      "link",
      "strong",
    ]);
    expect(next.marks[0].attrs).toMatchObject({
      href: "https://new.test",
      title: "title",
      sourceAppId: "app",
      isAutolink: false,
      isGeneratedAutolink: false,
      literalMarkdownSource: null,
      literalMarkdownOccurrenceId: null,
    });
  });
  it("removes only the link and leaves the surrounding emphasis", () => {
    const input = state(
      schema.text("old", [
        schema.marks.link.create({ href: "https://old.test" }),
        schema.marks.strong.create(),
      ]),
    );
    const next = editPromptLink(input, 1, 4, "old", null)!.doc.firstChild!
      .firstChild!;
    expect(next.textContent).toBe("old");
    expect(next.marks.map((mark) => mark.type.name)).toEqual(["strong"]);
  });
  it("preserves a library-backed atom when only its display text changes", () => {
    const input = state(
      atom({ libraryFileId: "file-1", serializeAsUrl: true }),
    );
    const next = editPromptLink(
      input,
      1,
      2,
      " new name ",
      "https://example.com",
    )!.doc.firstChild!.firstChild!;
    expect(next.type.name).toBe("richLink");
    expect(next.attrs).toMatchObject({
      displayText: "new name",
      libraryFileId: "file-1",
      serializeAsUrl: true,
    });
  });
  it("converts ordinary renamed atoms to marked text and removed atoms to plain text", () => {
    const input = state(atom());
    const next = editPromptLink(input, 1, 2, "new", "mailto:user@example.com")!
      .doc.firstChild!.firstChild!;
    expect(next.isText).toBe(true);
    expect(next.marks[0].attrs.href).toBe("mailto:user@example.com");
    const plain = editPromptLink(input, 1, 2, "old", null)!.doc.firstChild!
      .firstChild!;
    expect(plain.isText).toBe(true);
    expect(plain.marks).toEqual([]);
  });
  it("keeps recognized provider links as atoms and preserves serializeAsUrl", () => {
    const next = editPromptLink(
      state(atom({ serializeAsUrl: true })),
      1,
      2,
      "pull request",
      "https://github.com/openai/codex/pull/1",
    )!.doc.firstChild!.firstChild!;
    expect(next.type.name).toBe("richLink");
    expect(next.attrs).toMatchObject({
      displayText: "pull request",
      serializeAsUrl: true,
    });
  });
  it("converts an equal-label URL to a breakable text mark unless serializeAsUrl is set", () => {
    const next = editPromptLink(
      state(atom()),
      1,
      2,
      "https://example.com",
      "https://example.com",
    )!.doc.firstChild!.firstChild!;
    expect(next.isText).toBe(true);
    expect(next.marks[0].attrs.href).toBeNull();
    const kept = editPromptLink(
      state(atom({ serializeAsUrl: true })),
      1,
      2,
      "https://example.com",
      "https://example.com",
    )!.doc.firstChild!.firstChild!;
    expect(kept.type.name).toBe("richLink");
  });
  it("rejects empty text, unsafe URLs, wrong nodes and stale ranges", () => {
    const input = state(atom());
    for (const href of [
      "javascript:alert(1)",
      "file:///tmp/test",
      "https://exa mple.com",
    ])
      expect(editPromptLink(input, 1, 2, "ok", href)).toBeNull();
    expect(editPromptLink(input, 1, 2, " ", null)).toBeNull();
    expect(editPromptLink(input, 1, 3, "ok", null)).toBeNull();
    expect(
      editPromptLink(state(schema.text("plain")), 1, 6, "ok", null),
    ).toBeNull();
  });
});
