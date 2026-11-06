import { Fragment, Slice, type Node, type Schema } from "prosemirror-model";
import { type EditorState, TextSelection } from "prosemirror-state";
import { Transform } from "prosemirror-transform";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** Native Qjn/$jn: literal rich paste is one paragraph with real hard breaks. */
export function literalRichPaste(state: EditorState, text: string) {
  const { schema, selection, storedMarks } = state;
  const paragraph = schema.nodes.paragraph,
    hardBreak = schema.nodes.hard_break;
  if (!paragraph || !hardBreak) return null;
  const literal = schema.marks.literalPaste?.create();
  const marks = literal ? [literal] : [];
  const content: Node[] = [];
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((line, index) => {
      if (index) content.push(hardBreak.create(null, null, marks));
      if (line) content.push(schema.text(line, marks));
    });
  const slice = Slice.maxOpen(
    Fragment.from(paragraph.createChecked(null, content)),
  );
  const transformed = new Transform(
    schema.nodes.doc.create(null, slice.content),
  );
  for (const mark of storedMarks ??
    (selection.empty
      ? selection.$from.marks()
      : selection.$from.marksAcross(selection.$to)) ??
    [])
    transformed.addMark(0, transformed.doc.content.size, mark);
  return state.tr.replaceSelection(
    new Slice(transformed.doc.content, slice.openStart, slice.openEnd),
  );
}

/** Afe/m5 guards rich HTML, including fully inline-code selections. */
export function pasteInCodeContext(state: EditorState) {
  const { selection, storedMarks, schema, doc } = state;
  if (!selection.$from.sameParent(selection.$to)) return false;
  if (selection.$from.parent.type.spec.code) return true;
  const code = schema.marks.code;
  if (!code) return false;
  if (selection.empty)
    return !!code.isInSet(storedMarks ?? selection.$from.marks());
  let inline = false,
    allCode = true;
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (!node.isInline) return;
    inline = true;
    if (!code.isInSet(node.marks)) allCode = false;
    return false;
  });
  return inline && allCode;
}

function blank(node: Node) {
  if (node.type.name === "hard_break") return true;
  if (node.type.name !== "paragraph") return false;
  let result = true;
  node.descendants((child) => {
    if (
      child.type.name === "hard_break" ||
      (child.isText && !(child.text ?? "").replace(/\u200b/g, "").trim())
    )
      return true;
    result = false;
    return false;
  });
  return result;
}

/** SMn with preserveBlankLines=true, used only for HTML without a native slice marker. */
export function normalizeRichPasteSlice(slice: Slice, schema: Schema) {
  const paragraph = schema.nodes.paragraph;
  if (
    !paragraph ||
    Array.from({ length: slice.content.childCount }, (_, i) =>
      slice.content.child(i),
    ).every(blank)
  )
    return slice;
  const content: Node[] = [];
  let changed = false;
  slice.content.forEach((node, _offset, index) => {
    if (!blank(node)) {
      let breaks = 0;
      if (node.type === paragraph)
        for (
          let i = node.childCount - 1;
          i >= 0 && node.child(i).type.name === "hard_break";
          i--
        )
          breaks++;
      if (breaks > 1 && slice.content.maybeChild(index + 1)) {
        content.push(
          node.copy(node.content.cut(0, node.content.size - breaks)),
        );
        for (let i = 1; i < breaks; i++) content.push(paragraph.create());
        changed = true;
      } else content.push(node);
    } else if (node.type === paragraph && node.content.size === 0)
      content.push(node);
    else {
      let breaks = 0;
      node.forEach((child) => {
        if (child.type.name === "hard_break") breaks++;
      });
      for (let i = 0; i < Math.max(1, breaks); i++)
        content.push(paragraph.create());
      changed = true;
    }
  });
  if (!changed) return slice;
  const fragment = Fragment.fromArray(content),
    open = Slice.maxOpen(fragment);
  return new Slice(
    fragment,
    Math.min(slice.openStart, open.openStart),
    Math.min(slice.openEnd, open.openEnd),
  );
}

/** dga: a final pasted table leaves a usable paragraph and caret outside the table. */
export function replaceRichPaste(state: EditorState, slice: Slice) {
  let inTable = false;
  for (let depth = state.selection.$from.depth; depth > 0; depth--)
    if (state.selection.$from.node(depth).type === state.schema.nodes.table)
      inTable = true;
  const tailTable =
    slice.content.lastChild?.type === state.schema.nodes.table && !inTable;
  const transaction = state.tr.replaceSelection(
    tailTable ? new Slice(slice.content, slice.openStart, 0) : slice,
  );
  if (tailTable) {
    let end: number | undefined;
    transaction.mapping.maps.at(-1)?.forEach((_a, _b, _c, to) => {
      end ??= to;
    });
    if (
      end != null &&
      transaction.doc.resolve(end).nodeBefore?.type === state.schema.nodes.table
    ) {
      if (transaction.doc.nodeAt(end)?.type !== state.schema.nodes.paragraph)
        transaction.insert(end, state.schema.nodes.paragraph.create());
      transaction.setSelection(TextSelection.create(transaction.doc, end + 1));
    }
  }
  return transaction.scrollIntoView();
}

// Match the native inline-lexer fallback: decode escapes/entities in text tokens,
// preserving the original source of code, links and other formatted tokens.
export function decodeLiteralClipboardText(text: string) {
  const root = fromMarkdown(text, {
    extensions: [
      gfm(),
      {
        disable: {
          null: [
            "codeFenced",
            "codeIndented",
            "headingAtx",
            "headingSetext",
            "thematicBreak",
            "blockQuote",
            "list",
            "definition",
            "htmlFlow",
            "table",
          ],
        },
      },
    ],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const replacements: { from: number; to: number; value: string }[] = [];
  for (const block of root.children) {
    if (block.type !== "paragraph") continue;
    for (const node of block.children) {
      if (
        node.type === "text" &&
        node.position?.start.offset != null &&
        node.position.end.offset != null
      )
        replacements.push({
          from: node.position.start.offset,
          to: node.position.end.offset,
          value: node.value,
        });
    }
  }
  for (const { from, to, value } of replacements.reverse())
    text = text.slice(0, from) + value + text.slice(to);
  return text;
}
