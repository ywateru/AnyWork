import type { Node as ProseMirrorNode, Mark } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { editablePromptLinkHref, promptRichLinkAttrs } from "./promptText";

/** Tac.updateLink: replace the selected live mark span or one richLink atom. */
export function editPromptLink(
  state: EditorState,
  from: number,
  to: number,
  text: string,
  href: string | null,
) {
  const label = text.trim(),
    url = href == null ? null : editablePromptLinkHref(href);
  if (!label || (href != null && url == null)) return null;
  if (from < 0 || from >= state.doc.content.size) return null;
  const node = state.doc.nodeAt(from);
  if (!node || to <= from || to > state.doc.content.size) return null;
  const schema = state.schema;
  if (node.isText) {
    const link = node.marks.find((mark) => mark.type === schema.marks.link);
    if (!link) return null;
    const marks = node.marks.flatMap((mark) =>
      mark !== link
        ? [mark]
        : url == null
          ? []
          : [
              mark.type.create({
                ...mark.attrs,
                href: url,
                isAutolink: false,
                isGeneratedAutolink: false,
                literalMarkdownOccurrenceId: null,
                literalMarkdownSource: null,
              }),
            ],
    );
    return state.tr.replaceWith(from, to, schema.text(text, marks));
  }
  if (node.type !== schema.nodes.richLink || to !== from + node.nodeSize)
    return null;
  if (node.attrs.libraryFileId != null && url === node.attrs.href)
    return state.tr.setNodeAttribute(from, "displayText", label);
  const rich = url == null ? null : promptRichLinkAttrs(label, url);
  let replacement: ProseMirrorNode;
  if (rich && (label !== url || node.attrs.serializeAsUrl === true)) {
    replacement = schema.nodes.richLink.create({
      ...rich,
      serializeAsUrl: node.attrs.serializeAsUrl === true,
    });
  } else {
    let marks: Mark[] = [];
    if (rich)
      marks = [
        schema.marks.link.create({ href: null, sourceAppId: rich.sourceAppId }),
      ];
    else if (url != null) marks = [schema.marks.link.create({ href: url })];
    replacement = schema.text(label, marks);
  }
  return state.tr.replaceWith(from, to, replacement);
}
