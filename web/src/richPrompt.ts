import {
  Fragment,
  Schema,
  type Mark,
  type MarkSpec,
  type Node as ProseMirrorNode,
  type NodeSpec,
} from "prosemirror-model";
import {
  fromMarkdown,
  type Extension as MdastExtension,
} from "mdast-util-from-markdown";
import {
  defaultHandlers,
  toMarkdown,
  type Handle,
  type Info,
  type Join,
  type Options,
  type State,
} from "mdast-util-to-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Extension as MicromarkExtension } from "micromark-util-types";
import type {
  Nodes,
  Parents,
  PhrasingContent,
  Root,
  RootContent,
  Text,
  Paragraph,
  Link,
  Strong,
  Emphasis,
} from "mdast";
import {
  firstAuthoredLink,
  unescapeAuthoredLabel,
  unescapeAuthoredPath,
} from "./userMessageMarkdown";
import {
  parsePromptText,
  promptAtomAttributes,
  serializePromptLink,
  serializePromptText,
  type PromptDocument,
} from "./promptText";

declare module "mdast" {
  interface Data {
    nativeLineEndingBlank?: boolean;
    literalPaste?: boolean;
    composerParagraphGap?: boolean;
    header?: boolean;
    align?: "left" | "center" | "right" | null;
  }
}
declare module "micromark-util-types" {
  interface TokenTypeMap {
    anyworkRichTerminalBackslash: "anyworkRichTerminalBackslash";
  }
}
declare module "mdast-util-to-markdown" {
  interface State {
    attentionEncodeSurroundingInfo?: { before: boolean; after: boolean };
  }
}

/** Data model reconstructed from iga/zkn; native view and keymap code lives in the editor. */
export function createRichPromptSchema(base: Schema): Schema {
  const ranged = (spec: NodeSpec): NodeSpec => ({
    ...spec,
    attrs: {
      ...spec.attrs,
      start: { default: undefined },
      end: { default: undefined },
    },
  });
  const paragraph: NodeSpec = {
    content: "inline*",
    group: "block",
    attrs: { paragraphGap: { default: false } },
    parseDOM: [
      {
        tag: "p",
        getAttrs: (element) => ({
          paragraphGap:
            element.getAttribute("data-composer-paragraph-gap") === "true",
        }),
      },
    ],
    toDOM: (node) => [
      "p",
      {
        "data-composer-paragraph-gap": node.attrs.paragraphGap ? "true" : null,
      },
      0,
    ],
  };
  const code = base.spec.nodes.get("code_block") || {};
  const nodes: Record<string, NodeSpec> = {
    doc: { content: "block+" },
    paragraph,
    blockquote: {
      content: "block+",
      group: "block",
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0],
    },
    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      marks: "startend",
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"],
    },
    code_block: {
      ...code,
      content: "text*",
      group: "block",
      code: true,
      defining: true,
      marks: "startend",
      attrs: {
        lang: { default: null },
        isDarkMode: { default: null },
        ...code.attrs,
        autoDetectLanguage: { default: true },
        language: { default: null },
      },
    },
    heading: {
      content: "text*",
      group: "block",
      defining: true,
      attrs: {
        level: {
          default: 1,
          validate: (level: unknown) => {
            if (
              !Number.isInteger(level) ||
              Number(level) < 1 ||
              Number(level) > 6
            )
              throw new RangeError("Invalid heading level");
          },
        },
      },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`,
        attrs: { level },
      })),
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    horizontal_rule: {
      group: "block",
      selectable: false,
      parseDOM: [{ tag: "hr" }],
      toDOM: () => ["div", ["hr"]],
    },
    regular_list_item: {
      content: "paragraph block*",
      defining: true,
      group: "list_item",
      parseDOM: [{ tag: "li" }],
      toDOM: () => ["li", 0],
    },
    task_list_item: {
      content: "paragraph block*",
      defining: true,
      group: "list_item",
      attrs: { checked: { default: false } },
      parseDOM: [
        {
          priority: 60,
          tag: 'li[data-task-list-item="true"]',
          getAttrs: (element) => ({
            checked: element.getAttribute("data-checked") === "true",
          }),
        },
      ],
      toDOM: (node) => [
        "li",
        {
          "data-task-list-item": "true",
          "data-checked": node.attrs.checked ? "true" : "false",
        },
        [
          "span",
          { class: "task-list-item-checkbox", contenteditable: "false" },
          [
            "input",
            {
              type: "checkbox",
              ...(node.attrs.checked ? { checked: "checked" } : {}),
              tabindex: "-1",
            },
          ],
        ],
        ["div", { class: "task-list-item-content" }, 0],
      ],
    },
    ordered_list: {
      content: "list_item+",
      group: "block",
      attrs: { spread: { default: false }, startingNumber: { default: 1 } },
      parseDOM: [
        {
          tag: "ol",
          getAttrs: (element) => ({
            spread: element.getAttribute("data-spread") === "true",
            startingNumber:
              element.getAttribute("start") == null
                ? 1
                : parseInt(element.getAttribute("start")!, 10),
          }),
        },
      ],
      toDOM: (node) => [
        "ol",
        { "data-spread": node.attrs.spread, start: node.attrs.startingNumber },
        0,
      ],
    },
    list: {
      content: "list_item+",
      group: "block",
      attrs: { spread: { default: false } },
      parseDOM: [
        {
          tag: "ul",
          getAttrs: (element) => ({
            spread: element.getAttribute("data-spread") === "true",
          }),
        },
      ],
      toDOM: (node) => ["ul", { "data-spread": node.attrs.spread }, 0],
    },
    text: { group: "inline" },
    table: {
      content: "table_row+",
      tableRole: "table",
      isolating: true,
      group: "block",
      parseDOM: [{ tag: "table" }],
      toDOM: () => ["table", ["tbody", 0]],
    },
    table_row: {
      content: "table_cell+",
      tableRole: "row",
      parseDOM: [{ tag: "tr" }],
      toDOM: () => ["tr", 0],
    },
    table_cell: {
      content: "inline*",
      tableRole: "cell",
      isolating: true,
      attrs: {
        rowIndex: { default: null },
        columnIndex: { default: null },
        colspan: { default: 1 },
        rowspan: { default: 1 },
        align: { default: null },
      },
      parseDOM: [
        {
          tag: "td, th",
          getAttrs: (element) => ({
            rowIndex: element.tagName === "TH" ? 0 : 1,
            colspan: positiveSpan(element.getAttribute("colspan")),
            rowspan: positiveSpan(element.getAttribute("rowspan")),
            align: alignment(element.style.textAlign),
          }),
        },
      ],
      toDOM: (node) => [
        node.attrs.rowIndex == null || node.attrs.rowIndex > 0 ? "td" : "th",
        {
          colspan: node.attrs.colspan === 1 ? undefined : node.attrs.colspan,
          rowspan: node.attrs.rowspan === 1 ? undefined : node.attrs.rowspan,
          style:
            alignment(node.attrs.align) == null
              ? undefined
              : `text-align: ${node.attrs.align};`,
        },
        0,
      ],
    },
  };
  for (const name of Object.keys(promptAtomAttributes)) {
    const spec = base.spec.nodes.get(name);
    if (!spec) throw new Error(`Missing native prompt node: ${name}`);
    nodes[name] = spec;
  }
  const marks: Record<string, MarkSpec> = {
    code: {
      inclusive: false,
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", { dir: "ltr" }, 0],
    },
    strong: {
      parseDOM: [
        {
          tag: "b",
          getAttrs: (element) =>
            !element.style.fontWeight ||
            /^(bold(er)?|[5-9]\d{2,})$/.test(element.style.fontWeight.trim())
              ? null
              : false,
        },
        { tag: "strong" },
        {
          style: "font-weight",
          getAttrs: (value) =>
            /^(normal|[1-4]00)$/.test(value.trim()) ? null : false,
          clearMark: (mark) => mark.type.name === "strong",
        },
        {
          style: "font-weight",
          getAttrs: (value) =>
            /^(bold(er)?|[5-9]\d{2,})$/.test(value.trim()) ? null : false,
        },
      ],
      toDOM: () => ["strong", 0],
    },
    em: {
      parseDOM: [
        { tag: "i" },
        { tag: "em" },
        {
          style: "font-style",
          getAttrs: (value) => (value === "italic" ? null : false),
        },
      ],
      toDOM: () => ["em", 0],
    },
    link: { ...base.spec.marks.get("link"), inclusive: false },
    strikethrough: {
      parseDOM: [
        { tag: "s" },
        { tag: "del" },
        {
          style: "text-decoration",
          consuming: false,
          getAttrs: (value) =>
            /(^|\s)line-through(\s|$)/.test(value) ? null : false,
        },
        {
          style: "text-decoration-line",
          consuming: false,
          getAttrs: (value) =>
            /(^|\s)line-through(\s|$)/.test(value) ? null : false,
        },
      ],
      toDOM: () => ["s", 0],
    },
    startend: { attrs: { start: {}, end: {} }, toDOM: () => ["span", 0] },
    literalPaste: {
      inclusive: false,
      excludes: "",
      parseDOM: [{ tag: "span[data-prompt-literal-paste]" }],
      toDOM: () => ["span", { "data-prompt-literal-paste": "" }, 0],
    },
  };
  return new Schema({
    nodes: Object.fromEntries(
      Object.entries(nodes).map(([name, spec]) => [
        name,
        name === "text" ? spec : ranged(spec),
      ]),
    ),
    marks,
  });
}

function positiveSpan(value: string | null) {
  const number = value == null ? 1 : Number(value);
  return Number.isNaN(number) ? 1 : number;
}
function alignment(value: unknown): "left" | "center" | "right" | null {
  return value === "left" || value === "center" || value === "right"
    ? value
    : null;
}

// Native DOn/OOn exposes blank-line tokens, then drops separator runs according
// to AST depth. Counting these events avoids guessing from raw newline counts.
const blankLineExtension: MdastExtension = {
  enter: {
    lineEndingBlank(token) {
      this.enter(
        {
          type: "paragraph",
          children: [],
          data: { nativeLineEndingBlank: true },
        },
        token,
      );
    },
  },
  exit: {
    lineEndingBlank(token) {
      this.exit(token);
    },
  },
};
const terminalBackslashExtension: MdastExtension = {
  enter: {
    anyworkRichTerminalBackslash(token) {
      this.enter({ type: "break" }, token);
      this.exit(token);
    },
  },
};
function normalizeBlankRuns(entry: Nodes, depth = 0): void {
  if (!("children" in entry)) return;
  const children = entry.children as Nodes[];
  for (const child of children) normalizeBlankRuns(child, depth + 1);
  for (let index = 0; index < children.length;) {
    if (!children[index].data?.nativeLineEndingBlank) {
      index++;
      continue;
    }
    let end = index + 1;
    while (end < children.length && children[end].data?.nativeLineEndingBlank)
      end++;
    const length = end - index;
    const remove =
      depth > 0 && entry.type !== "list"
        ? length
        : end === children.length || index === 0
          ? length - Math.floor((length + 1) / 2)
          : length - Math.floor((length - 1) / 2);
    children.splice(index, remove);
    index = end - remove;
  }
}

const nativeBacktickBoundary: MicromarkExtension = {
  text: {
    92: {
      tokenize(effects, ok, nok) {
        return (code) => {
          effects.enter("anyworkRichTerminalBackslash");
          effects.consume(code);
          return (next) => {
            if (next !== null) return nok(next);
            effects.exit("anyworkRichTerminalBackslash");
            return ok(next);
          };
        };
      },
    },
    96: {
      tokenize(effects, ok, nok) {
        const previous = this.previous;
        const open = (
          this.events.at(-1)?.[1] as { _open?: boolean } | undefined
        )?._open;
        if (
          previous == null ||
          previous < 0 ||
          /[\s\p{Ps}\p{Pi}"']/u.test(String.fromCharCode(previous)) ||
          open
        )
          return nok;
        return (code) => {
          effects.enter("data");
          effects.consume(code);
          effects.exit("data");
          return ok;
        };
      },
    },
  },
};

/** Native XX/sua setText: literal inline text, with lists and closed backtick blocks. */
export function parsePlainRichPromptText(schema: Schema, source: string) {
  const lines = source.split("\n");
  let cursor = 0;
  const paragraph = (text: string) =>
    schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
  const marker = (line: string) => {
    const match = /^(\s*)(?:([-+*])|(\d+)\.)\s+(.*)$/.exec(line);
    return match
      ? {
          text: match[4],
          indent: match[1].replaceAll("\t", "    ").length,
          ordered: match[2] == null,
          start: match[3] == null ? 1 : Number(match[3]),
        }
      : null;
  };
  const list = (indent: number, ordered: boolean): ProseMirrorNode => {
    const start = marker(lines[cursor])!.start;
    const items: ProseMirrorNode[] = [];
    while (cursor < lines.length) {
      const item = marker(lines[cursor]);
      if (!item || item.indent !== indent || item.ordered !== ordered) break;
      cursor++;
      const content = [paragraph(item.text)];
      while (cursor < lines.length) {
        const next = marker(lines[cursor]);
        if (next) {
          if (next.indent <= indent) break;
          content.push(list(next.indent, next.ordered));
          continue;
        }
        const continuation = /^([ \t]+)(.*)$/.exec(lines[cursor]);
        if (
          !continuation ||
          continuation[1].replaceAll("\t", "    ").length <= indent
        )
          break;
        content.push(paragraph(continuation[2]));
        cursor++;
      }
      items.push(schema.nodes.regular_list_item.create(null, content));
    }
    return ordered
      ? schema.nodes.ordered_list.create({ startingNumber: start }, items)
      : schema.nodes.list.create(null, items);
  };
  const blocks: ProseMirrorNode[] = [];
  while (cursor < lines.length) {
    const fence = /^(`{3,})([^`\s]*)\s*$/.exec(lines[cursor]);
    if (fence) {
      let closing = cursor + 1;
      for (; closing < lines.length; closing++) {
        const match = /^(`{3,})\s*$/.exec(lines[closing]);
        if (match && match[1].length >= fence[1].length) break;
      }
      if (closing < lines.length) {
        const code = lines.slice(cursor + 1, closing).join("\n");
        blocks.push(
          schema.nodes.code_block.create(
            { autoDetectLanguage: !fence[2], language: fence[2] || null },
            code ? schema.text(code) : null,
          ),
        );
        cursor = closing + 1;
        continue;
      }
    }
    const item = marker(lines[cursor]);
    if (item) blocks.push(list(item.indent, item.ordered));
    else blocks.push(paragraph(lines[cursor++]));
  }
  return schema.nodes.doc.create(null, blocks);
}

/** aga: restore authored Markdown once; live transactions must not reparse it. */
export interface ParseRichPromptOptions {
  restorePathLinksAsFileMentions?: boolean;
  restoreMarkdownLinksAsTextLinks?: boolean;
}
export function parseRichPromptText(
  schema: Schema,
  source: string,
  options: ParseRichPromptOptions = {},
): ProseMirrorNode {
  const ast = fromMarkdown(source, {
    extensions: [gfm({ singleTilde: false }), nativeBacktickBoundary],
    mdastExtensions: [
      gfmFromMarkdown(),
      blankLineExtension,
      terminalBackslashExtension,
    ],
  });
  normalizeBlankRuns(ast);
  const definitions = new Map<string, { url: string; title?: string | null }>();
  const visitDefinitions = (node: Nodes) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if ("children" in node)
      node.children.forEach((child) => visitDefinitions(child as Nodes));
  };
  visitDefinitions(ast);
  const bounds = (node: Nodes) => ({
    start: node.position?.start.offset,
    end: node.position?.end.offset,
  });
  const markBounds = (node: Nodes) => ({
    start: node.position?.start.offset ?? null,
    end: node.position?.end.offset ?? null,
  });
  function text(
    value: string,
    node: Nodes,
    marks: readonly Mark[] = [],
  ): ProseMirrorNode[] {
    return value
      ? [
          schema.text(value, [
            schema.marks.startend.create(markBounds(node)),
            ...marks,
          ]),
        ]
      : [];
  }
  function create(
    name: string,
    node: Nodes,
    children: ProseMirrorNode[] = [],
    attrs: Record<string, unknown> = {},
  ): ProseMirrorNode[] {
    const made = schema.nodes[name].createAndFill(
      { ...bounds(node), ...attrs },
      children,
    );
    return made ? [made] : [];
  }
  function convert(
    node: Nodes,
    context: { row?: number; align?: readonly unknown[] | null } = {},
  ): ProseMirrorNode[] {
    const children =
      "children" in node
        ? node.children.flatMap((child) => convert(child as Nodes, context))
        : [];
    switch (node.type) {
      case "root":
        return create("doc", node, children);
      case "paragraph":
        return create("paragraph", node, children);
      case "text":
        return text(node.value, node);
      case "break":
        return create("hard_break", node);
      case "blockquote":
        return create("blockquote", node, children);
      case "heading":
        return create("heading", node, children, { level: node.depth });
      case "thematicBreak":
        return create("horizontal_rule", node);
      case "code": {
        const value = node.value;
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        const content = value
          ? [
              schema.text(value, [
                schema.marks.startend.create({
                  start:
                    start == null ? null : start + 4 + (node.lang?.length || 0),
                  end: end == null ? null : end - 4,
                }),
              ]),
            ]
          : [];
        return create("code_block", node, content, {
          lang: node.lang ?? null,
          autoDetectLanguage: node.lang == null,
          language: node.lang ?? null,
        });
      }
      case "list":
        return create(node.ordered ? "ordered_list" : "list", node, children, {
          spread: node.spread,
          ...(node.ordered ? { startingNumber: node.start ?? 1 } : {}),
        });
      case "listItem": {
        const first = node.children[0];
        let checked = node.checked;
        // Ikn also recognizes an otherwise-empty task whose complete body is [x].
        if (
          checked == null &&
          first?.type === "paragraph" &&
          first.children.length === 1 &&
          first.children[0].type === "text"
        ) {
          const match = /^\[([ xX])\]$/.exec(first.children[0].value);
          if (
            match &&
            first.children[0].position?.start.offset != null &&
            first.children[0].position.end.offset ===
              first.children[0].position.start.offset + 3
          ) {
            checked = match[1].toLowerCase() === "x";
            children.splice(0, 1, schema.nodes.paragraph.create(bounds(first)));
          }
        }
        return create(
          typeof checked === "boolean" ? "task_list_item" : "regular_list_item",
          node,
          children,
          typeof checked === "boolean" ? { checked } : {},
        );
      }
      case "table": {
        const rows = node.children.flatMap((row, index) =>
          convert(row, { row: index, align: node.align }),
        );
        return create("table", node, rows);
      }
      case "tableRow": {
        const cells = node.children.flatMap((cell, column) => {
          const content = cell.children.flatMap((child) =>
            child.type === "html" && /^<br\s*\/?\s*>$/i.test(child.value)
              ? create("hard_break", child)
              : convert(child as Nodes),
          );
          return create("table_cell", cell, content, {
            rowIndex: context.row === 0 ? 0 : 1,
            align: alignment(context.align?.[column]),
            colspan: 1,
            rowspan: 1,
          });
        });
        return create("table_row", node, cells);
      }
      case "strong":
      case "emphasis":
      case "delete": {
        const name =
          node.type === "strong"
            ? "strong"
            : node.type === "emphasis"
              ? "em"
              : "strikethrough";
        return children.map((child) =>
          child.mark(schema.marks[name].create().addToSet(child.marks)),
        );
      }
      case "inlineCode":
        return text(node.value, node, [schema.marks.code.create()]);
      case "linkReference": {
        const definition = definitions.get(node.identifier);
        return definition
          ? convert({
              type: "link",
              url: definition.url,
              title: definition.title,
              children: node.children,
              position: node.position,
            })
          : children;
      }
      case "link": {
        // Ega reads direct child.value, not formatted descendants, when matching mentions.
        const label = node.children
          .map((child) => ("value" in child ? child.value : ""))
          .join("");
        if (label) {
          const restored = parsePromptText(
            serializePromptLink(label, node.url),
            options,
          ).content[0]?.content?.[0];
          if (
            restored &&
            restored.type in promptAtomAttributes &&
            !(
              restored.type === "richLink" &&
              (node.title != null ||
                (node.position?.start.offset != null &&
                  node.position.end.offset ===
                    node.position.start.offset + label.length))
            )
          ) {
            return [
              schema.nodes[restored.type].create({
                ...restored.attrs,
                ...bounds(node),
                ...(restored.type === "richLink"
                  ? {
                      markdownSourceStart: node.position?.start.offset ?? null,
                      markdownSourceEnd: node.position?.end.offset ?? null,
                    }
                  : {}),
              }),
            ];
          }
        }
        const visible = children.map((child) => child.textContent).join("");
        const bareMail =
          node.url === `mailto:${visible}` &&
          node.position?.start.offset != null &&
          node.position.end.offset ===
            node.position.start.offset + visible.length;
        const checked = parsePromptText(
          serializePromptLink("link", `codex-text-link://${node.url}`),
        ).content[0]?.content?.[0];
        const accepted =
          checked?.type === "text" &&
          checked.marks?.some(
            (mark) => mark.type === "link" && mark.attrs?.href === node.url,
          );
        return !accepted || bareMail
          ? children
          : children.map((child) =>
              child.mark(
                schema.marks.link
                  .create({
                    href: node.url,
                    title: node.title ?? null,
                    isAutolink: visible === node.url,
                  })
                  .addToSet(child.marks),
              ),
            );
      }
      case "definition":
        return [];
      default:
        return [];
    }
  }
  let document = convert(ast)[0] || schema.nodes.doc.createAndFill()!;
  const trailing = source.match(/[ \t]+$/)?.[0];
  if (trailing != null) {
    const append = (node: ProseMirrorNode): ProseMirrorNode => {
      if (node.type.name === "paragraph")
        return node.lastChild?.type.name === "hard_break"
          ? node
          : node.copy(
              node.content.append(Fragment.from(schema.text(trailing))),
            );
      const last = node.lastChild;
      if (!last || node.isTextblock) return node;
      return node.copy(
        node.content.replaceChild(node.childCount - 1, append(last)),
      );
    };
    document = append(document);
  }
  return document;
}

function codeLanguage(node: ProseMirrorNode): string | null {
  const language = node.attrs.language;
  return typeof language === "string" &&
    /^[^`\s]+$/u.test(language) &&
    !(node.attrs.autoDetectLanguage !== false && language === "plaintext")
    ? language
    : null;
}

function mdastText(node: Nodes): string {
  return "value" in node
    ? String(node.value)
    : "children" in node
      ? node.children.map((child) => mdastText(child as Nodes)).join("")
      : "";
}
function atomAst(node: ProseMirrorNode): PhrasingContent[] {
  const raw = serializePromptText({
    type: "doc",
    content: [{ type: "paragraph", content: [node.toJSON()] }],
  });
  const authored = firstAuthoredLink(raw);
  if (authored == null)
    return raw
      ? [
          {
            type: "text",
            value: raw,
            ...(node.type.name === "richLink" && raw === node.attrs.href
              ? { data: { literalPaste: true } }
              : {}),
          },
        ]
      : [];
  return [
    {
      type: "link",
      url: unescapeAuthoredPath(authored.path),
      children: [
        { type: "text", value: unescapeAuthoredLabel(authored.label) },
      ],
    },
  ];
}

type MergeableInline =
  Strong | Emphasis | import("mdast").Delete | import("mdast").InlineCode;
function mergeableInline(node: PhrasingContent): MergeableInline | null {
  return ["strong", "emphasis", "delete", "inlineCode"].includes(node.type)
    ? (node as MergeableInline)
    : null;
}
function mergeInline(left: MergeableInline, right: MergeableInline): void {
  if (left.type === "inlineCode" || right.type === "inlineCode") {
    if (left.type === "inlineCode" && right.type === "inlineCode")
      left.value += right.value;
    return;
  }
  const last = left.children.at(-1),
    first = right.children[0];
  const previous = last ? mergeableInline(last) : null,
    next = first ? mergeableInline(first) : null;
  if (previous && next && previous.type === next.type) {
    mergeInline(previous, next);
    left.children.push(...right.children.slice(1));
  } else left.children.push(...right.children);
}
function parsedHttp(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/u.test(trimmed)) return null;
  try {
    return ["http:", "https:"].includes(new URL(trimmed).protocol)
      ? trimmed
      : null;
  } catch {
    return null;
  }
}

// hga normalizes one null-href link run across adjacent text, independently of
// other formatting marks. This prevents a partially bold URL losing its link.
function normalizeAutolinks(parent: ProseMirrorNode): ProseMirrorNode {
  const children: ProseMirrorNode[] = [];
  parent.forEach((child) =>
    children.push(child.isLeaf ? child : normalizeAutolinks(child)),
  );
  for (let index = 0; index < children.length; index++) {
    const first = children[index];
    const mark = first.isText
      ? first.marks.find(
          (mark) => mark.type.name === "link" && mark.attrs.href == null,
        )
      : undefined;
    if (!mark) continue;
    let end = index + 1,
      value = first.text || "";
    while (
      end < children.length &&
      children[end].isText &&
      mark.isInSet(children[end].marks)
    ) {
      value += children[end].text || "";
      end++;
    }
    const href = parsedHttp(value);
    for (let cursor = index; cursor < end; cursor++) {
      const child = children[cursor];
      let marks = mark.removeFromSet(child.marks);
      if (href != null)
        marks = mark.type.create({ ...mark.attrs, href }).addToSet(marks);
      children[cursor] = child.mark(marks);
    }
    index = end - 1;
  }
  return parent.isLeaf ? parent : parent.copy(Fragment.fromArray(children));
}

/** kAn/EAn/DAn/OAn mark ordering and adjacent-attention merging. */
function inlineAst(parent: ProseMirrorNode): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let previous: MergeableInline | null = null;
  const endCache = new Map<Mark["type"], number>();
  const markName = {
    strong: "strong",
    emphasis: "em",
    delete: "strikethrough",
    inlineCode: "code",
  };
  function spanEnd(index: number, mark: Mark): number {
    const cached = endCache.get(mark.type);
    if (cached != null && cached > index) return cached;
    let end = index + 1;
    while (end < parent.childCount && mark.isInSet(parent.child(end).marks))
      end++;
    endCache.set(mark.type, end);
    return end;
  }
  function codeLeaves(node: PhrasingContent): PhrasingContent {
    return "children" in node
      ? ({
          ...node,
          children: node.children.map((child) =>
            codeLeaves(child as PhrasingContent),
          ),
        } as PhrasingContent)
      : { type: "inlineCode", value: mdastText(node as Nodes) };
  }
  parent.forEach((node, _offset, index) => {
    const previousName = previous == null ? undefined : markName[previous.type];
    const carried = node.marks.find((mark) => mark.type.name === previousName);
    const prioritize =
      carried != null &&
      node.marks.every(
        (mark) =>
          mark.type.name === "startend" ||
          spanEnd(index, mark) <= spanEnd(index, carried),
      ) &&
      !node.marks.some((mark) => mark.type.name === "strikethrough")
        ? previousName
        : undefined;
    const marks = [
      ...node.marks.filter((mark) => mark.type.name !== prioritize),
      ...node.marks.filter((mark) => mark.type.name === prioritize),
    ].filter((mark) => !["startend", "literalPaste"].includes(mark.type.name));
    const bare: PhrasingContent[] = node.isText
      ? [{ type: "text", value: node.text || "" }]
      : node.type.name === "hard_break"
        ? [{ type: "break" }]
        : atomAst(node);
    for (let ast of bare) {
      for (const mark of marks) {
        if (
          node.type.spec.marks != null &&
          !node.type.spec.marks.includes(mark.type.name)
        )
          continue;
        switch (mark.type.name) {
          case "strong":
            ast = { type: "strong", children: [ast] };
            break;
          case "em":
            ast = { type: "emphasis", children: [ast] };
            break;
          case "strikethrough":
            ast = { type: "delete", children: [ast] };
            break;
          case "code":
            ast = codeLeaves(ast);
            break;
          case "link": {
            const href =
              typeof mark.attrs.href === "string"
                ? mark.attrs.href
                : parsedHttp(mdastText(ast as Nodes));
            if (href != null)
              ast = {
                type: "link",
                url: href,
                ...(mark.attrs.title != null
                  ? { title: mark.attrs.title }
                  : {}),
                children: [ast],
              };
            break;
          }
        }
      }
      const candidate = mergeableInline(ast);
      if (
        previous != null &&
        candidate != null &&
        previous.type === candidate.type
      )
        mergeInline(previous, candidate);
      else {
        result.push(ast);
        previous = candidate;
      }
    }
  });
  return result;
}

function blockAst(node: ProseMirrorNode): RootContent[] {
  const children = (): RootContent[] => {
    const result: RootContent[] = [];
    node.forEach((child) => result.push(...blockAst(child)));
    return result;
  };
  switch (node.type.name) {
    case "doc":
      return children();
    case "paragraph":
      return [
        {
          type: "paragraph",
          children: inlineAst(node),
          ...(node.attrs.paragraphGap && node.content.size === 0
            ? { data: { composerParagraphGap: true } }
            : {}),
        },
      ];
    case "blockquote":
      return [
        {
          type: "blockquote",
          children: children() as import("mdast").BlockContent[],
        },
      ];
    case "heading":
      return [
        { type: "heading", depth: node.attrs.level, children: inlineAst(node) },
      ];
    case "code_block":
      return [
        { type: "code", lang: codeLanguage(node), value: node.textContent },
      ];
    case "horizontal_rule":
      return [{ type: "thematicBreak" }];
    case "list":
    case "ordered_list":
      return [
        {
          type: "list",
          ordered: node.type.name === "ordered_list",
          spread: node.attrs.spread,
          ...(node.type.name === "ordered_list"
            ? { start: node.attrs.startingNumber }
            : {}),
          children: children().map((child) => ({
            ...child,
            spread: node.attrs.spread,
          })) as import("mdast").ListItem[],
        },
      ];
    case "regular_list_item":
    case "task_list_item":
      return [
        {
          type: "listItem",
          children: children() as import("mdast").BlockContent[],
          ...(node.type.name === "task_list_item"
            ? { checked: node.attrs.checked === true }
            : {}),
        },
      ];
    case "table": {
      const rows: import("mdast").TableRow[] = [];
      node.forEach((row) => {
        const cells: import("mdast").TableCell[] = [];
        row.forEach((cell) =>
          cells.push({
            type: "tableCell",
            children: inlineAst(cell),
            data: {
              header: cell.attrs.rowIndex === 0,
              align: alignment(cell.attrs.align),
            },
          }),
        );
        rows.push({ type: "tableRow", children: cells });
      });
      return [
        {
          type: "table",
          align:
            rows[0]?.children.map((cell) => alignment(cell.data?.align)) || [],
          children: rows,
        },
      ];
    }
    default:
      return [];
  }
}

// Ckn native settings and the small handlers installed by iga. They customize
// escaping and separator paragraphs in addition to generic CommonMark/GFM.
const emptySeparator = (node?: Nodes) =>
  node?.type === "paragraph" &&
  (node.children.length === 0 ||
    (node.children.length === 1 && node.children[0].type === "break"));
const substantive = (node?: Nodes) =>
  node != null &&
  (node.type !== "paragraph" ||
    !node.children.every((child) => child.type === "break"));
const nativeJoin: Join = (left, right, parent) => {
  if (
    parent.type !== "listItem" ||
    left.type !== "paragraph" ||
    right.type !== "list"
  )
    return;
  const first = right.children[0],
    paragraph = first?.children[0];
  if (
    (right.ordered && (right.start ?? 1) !== 1) ||
    (first?.checked == null &&
      (paragraph == null ||
        (paragraph.type === "paragraph" && paragraph.children.length === 0)))
  )
    return 1;
};
const emphasisMarker = (
  node: Emphasis | Strong,
  parent: Parents | undefined,
  state: State,
): "*" | "_" => {
  const children =
    parent && "children" in parent ? (parent.children as Nodes[]) : undefined;
  const index = children?.indexOf(node) ?? -1;
  return children?.[index - 1]?.type === "strong" ||
    children?.[index + 1]?.type === "strong"
    ? "_"
    : (state.options.emphasis ?? "*");
};
function nestedAttention(
  node: Strong | Emphasis,
  state: State,
  side: "start" | "end",
): boolean {
  let child = side === "start" ? node.children[0] : node.children.at(-1);
  if (child?.type !== "strong" && child?.type !== "emphasis") return false;
  while (child?.type === "strong" || child?.type === "emphasis") {
    if (
      (child.type === "strong"
        ? (state.options.strong ?? "*")
        : emphasisMarker(child, node, state)) !== "*"
    )
      return false;
    node = child;
    child = side === "start" ? node.children[0] : node.children.at(-1);
  }
  return (
    child?.type === "text" &&
    /[^\p{P}\p{S}\s]/u.test(
      side === "start" ? child.value.charAt(0) : child.value.slice(-1),
    )
  );
}
function attentionBoundary(
  node: Nodes | undefined,
  parent: Parents | undefined,
  state: State,
  side: "start" | "end",
): boolean {
  if (node?.type !== "strong" && node?.type !== "emphasis") return false;
  const marker =
    node.type === "strong"
      ? (state.options.strong ?? "*")
      : emphasisMarker(node, parent, state);
  if (marker === "*" && nestedAttention(node, state, side)) return false;
  const child = side === "start" ? node.children[0] : node.children.at(-1);
  return (
    marker === "_" ||
    child?.type !== "text" ||
    /[\p{P}\p{S}\s]/u.test(
      side === "start" ? child.value.charAt(0) : child.value.slice(-1),
    )
  );
}
const encodeCodePoint = (value: string) => `&#${value.codePointAt(0)};`;
const evenBackslashes = (value: string) =>
  `${value}${value.length % 2 ? "\\" : ""}`;
const nativeText: Handle = (node, parent, state, info) => {
  const entry = node as Text;
  if (
    entry.data?.literalPaste === true &&
    !state.stack.some((construct) =>
      ["tableCell", "label", "strong", "emphasis", "strikethrough"].includes(
        construct,
      ),
    )
  )
    return entry.value;
  let output = state.safe(entry.value, info);
  if (!(state.stack.includes("listItem") && /^\[[ xX]\]$/.test(entry.value))) {
    output = (
      state.stack.includes("label") ? output : output.replaceAll("\\[", "[")
    )
      .replaceAll("\\&", "&")
      .replace(
        /([\p{L}\p{N}])((?:\\_)+)(?=[\p{L}\p{N}])/gu,
        (_match, first: string, underscores: string) =>
          first + underscores.replaceAll("\\", ""),
      );
    if (parent?.type === "tableCell") {
      const encodeWhitespace = (value: string) =>
        value.replaceAll(" ", "&#x20;").replaceAll("\t", "&#x9;");
      if (parent.children[0] === node)
        output = output.replace(/^[ \t]+/, encodeWhitespace);
      if (parent.children.at(-1) === node)
        output = output.replace(/[ \t]+$/, encodeWhitespace);
    }
  }
  if (
    !/^[\u{10000}-\u{10ffff}]|[\u{10000}-\u{10ffff}]$/u.test(output) &&
    !/\\[^\p{P}\p{S}\s]?$/u.test(output)
  )
    return output;
  const siblings =
    parent && "children" in parent ? (parent.children as Nodes[]) : undefined;
  const index = siblings?.indexOf(node) ?? -1;
  const previous = siblings?.[index - 1],
    next = siblings?.[index + 1];
  const after =
    next?.type === "text" && /^[^\p{P}\p{S}\s]$/u.test(next.value)
      ? siblings?.[index + 2]
      : next;
  if (
    state.options.emphasis === "_" ||
    (after?.type === "emphasis" && emphasisMarker(after, parent, state) === "_")
  )
    output = output.replace(/\\+(?=[^\p{P}\p{S}\s]?$)/u, evenBackslashes);
  if (
    info.after === "&" &&
    next?.type === "text" &&
    /^[\u{10000}-\u{10ffff}]/u.test(next.value)
  )
    output = output.replace(/\\+$/, evenBackslashes);
  if (attentionBoundary(previous, parent, state, "end"))
    output = output.replace(/^[\u{10000}-\u{10ffff}]/u, encodeCodePoint);
  if (attentionBoundary(next, parent, state, "start"))
    output = output.replace(
      /(\\*)([\u{10000}-\u{10ffff}])$/u,
      (_match, slash: string, character: string) =>
        evenBackslashes(slash) + encodeCodePoint(character),
    );
  return output;
};
function attention(
  node: Strong | Emphasis,
  parent: Parents | undefined,
  state: State,
  info: Info,
): string {
  const marker = state.options[node.type] ?? "*";
  const decorated: State = {
    ...state,
    containerPhrasing(container, settings) {
      let result = state.containerPhrasing(container, settings);
      if (marker === "_" && /[^\p{P}\p{S}\s]$/u.test(info.before))
        result = result.replace(/^[\u{10000}-\u{10ffff}]/u, encodeCodePoint);
      if (marker === "_" && /^[^\p{P}\p{S}\s]/u.test(info.after))
        result = result.replace(
          /(\\*)([\u{10000}-\u{10ffff}])$/u,
          (_match, slashes: string, character: string) =>
            evenBackslashes(slashes) + encodeCodePoint(character),
        );
      return result;
    },
  };
  const result =
    node.type === "strong"
      ? defaultHandlers.strong(node, parent, decorated, info)
      : defaultHandlers.emphasis(node, parent, decorated, info);
  state.attentionEncodeSurroundingInfo =
    decorated.attentionEncodeSurroundingInfo;
  if (marker === "*" && state.attentionEncodeSurroundingInfo) {
    if (nestedAttention(node, state, "start"))
      state.attentionEncodeSurroundingInfo.before = false;
    if (nestedAttention(node, state, "end"))
      state.attentionEncodeSurroundingInfo.after = false;
  }
  return result;
}
const nativeStrong: Handle = Object.assign(
  (node: Nodes, parent: Parents | undefined, state: State, info: Info) =>
    attention(node as Strong, parent, state, info),
  { peek: defaultHandlers.strong.peek },
);
const nativeEmphasis: Handle = Object.assign(
  (node: Nodes, parent: Parents | undefined, state: State, info: Info) => {
    const previous = state.options.emphasis;
    state.options.emphasis = emphasisMarker(node as Emphasis, parent, state);
    try {
      return attention(node as Emphasis, parent, state, info);
    } finally {
      state.options.emphasis = previous;
    }
  },
  { peek: emphasisMarker },
);

function markdownOptions(): Options {
  const withoutAtUnsafe = (extension: Options): Options => ({
    ...extension,
    unsafe: extension.unsafe?.filter((unsafe) => unsafe.character !== "@"),
    extensions: extension.extensions?.map(withoutAtUnsafe),
  });
  return {
    fences: true,
    bullet: "-",
    bulletOther: "*",
    listItemIndent: "one",
    resourceLink: true,
    tightDefinitions: true,
    rule: "-",
    extensions: [withoutAtUnsafe(gfmToMarkdown({ tablePipeAlign: true }))],
    unsafe: [
      { character: "\\", after: "\\s", inConstruct: ["strong", "emphasis"] },
    ],
    join: [
      nativeJoin,
      (_left, right) => (right.type === "code" ? 0 : undefined),
      (left, right, parent) =>
        [left, right].some((node) => node.data?.composerParagraphGap === true)
          ? +(
              parent.type === "root" &&
              right.type === "paragraph" &&
              right.children.length === 0 &&
              parent.children.at(-1) === right
            )
          : undefined,
    ],
    handlers: {
      text: nativeText,
      strong: nativeStrong,
      emphasis: nativeEmphasis,
      break: (node, parent, state, info) =>
        state.stack.includes("tableCell")
          ? "<br>"
          : defaultHandlers.break(node, parent, state, info),
      listItem: (node, parent, state, info) => {
        const entry = node as import("mdast").ListItem;
        const task =
          typeof entry.checked === "boolean" &&
          entry.children[0]?.type === "paragraph";
        const marker = `[${entry.checked ? "x" : " "}]`;
        const tracker = state.createTracker(info);
        if (task) tracker.move(`${marker} `);
        const rendered = defaultHandlers.listItem(node, parent, state, {
          ...info,
          ...tracker.current(),
        });
        return task
          ? rendered.replace(
              /^([*+-]|\d+[.)])( +|(?=\r?\n|$))/,
              (_match, bullet: string, spaces: string) =>
                `${bullet} ${marker}${spaces}`,
            )
          : rendered;
      },
      blockquote: (node, parent, state, info) => {
        const entry = node as import("mdast").Blockquote;
        const children = entry.children.filter(
          (child, index) =>
            !emptySeparator(child) ||
            !substantive(entry.children[index - 1]) ||
            !substantive(entry.children[index + 1]),
        );
        return defaultHandlers.blockquote(
          { ...entry, children },
          parent,
          state,
          info,
        );
      },
      list: (node, parent, state, info) => {
        const entry = node as import("mdast").List;
        const children = entry.children.map((item, index) => {
          const filtered = item.children.filter(
            (child, childIndex) =>
              item.children.length === 1 ||
              !emptySeparator(child) ||
              !substantive(
                item.children[childIndex - 1] ||
                  entry.children[index - 1]?.children.at(-1),
              ) ||
              !substantive(
                item.children[childIndex + 1] ||
                  entry.children[index + 1]?.children[0],
              ),
          );
          return filtered.length === item.children.length
            ? item
            : { ...item, children: filtered };
        });
        const changed = children.some(
          (item, index) => item !== entry.children[index],
        );
        return defaultHandlers.list(
          changed
            ? {
                ...entry,
                spread: true,
                children: children.map((item) => ({ ...item, spread: true })),
              }
            : entry,
          parent,
          state,
          info,
        );
      },
    },
  };
}

/** iga persisted Markdown; paragraph documents deliberately use single-LF joins. */
export function serializeRichPromptText(document: ProseMirrorNode): string {
  document = normalizeAutolinks(document);
  const render = (node: ProseMirrorNode): string =>
    toMarkdown(
      { type: "root", children: blockAst(node) } as Root,
      markdownOptions(),
    ).replace(/\n$/, "");
  if (
    document.childCount > 0 &&
    Array.from({ length: document.childCount }, (_, index) =>
      document.child(index),
    ).every((node) => node.type.name === "paragraph")
  )
    return Array.from({ length: document.childCount }, (_, index) =>
      render(document.child(index)),
    ).join("\n");
  return render(document);
}

/** oga/sga actual prompt; unformatted literal typing keeps KX's literal text. */
export function getRichPromptText(document: ProseMirrorNode): string {
  let formatted = false;
  document.descendants((node) => {
    if (
      (node.isBlock && node.type.name !== "paragraph") ||
      node.marks.some(
        (mark) => !["literalPaste", "startend"].includes(mark.type.name),
      ) ||
      node.type.name in promptAtomAttributes
    )
      formatted = true;
    if (!formatted && node.isTextblock) {
      const source = node.textBetween(0, node.content.size, "\n", "\n");
      for (
        let found = firstAuthoredLink(source);
        found;
        found = firstAuthoredLink(source, found.end)
      ) {
        const restored = parsePromptText(source.slice(found.start, found.end));
        const path = unescapeAuthoredPath(found.path);
        if (
          /^(?:browser-skill:|agent:\/\/|subagent:\/\/|plugin:\/\/|app:\/\/)/.test(
            path,
          ) ||
          restored.content.some((paragraph) =>
            paragraph.content?.some(
              (child) => child.type !== "text" || !!child.marks?.length,
            ),
          )
        ) {
          formatted = true;
          break;
        }
      }
    }
    return !formatted;
  });
  const plain = () => serializePromptText(document.toJSON() as PromptDocument);
  if (!formatted) return plain();
  const serialized = serializeRichPromptText(document);
  if (serialized.replace(/&#(?:x[\da-f]+|\d+);/gi, "").trim() === "")
    return plain();
  return document.lastChild?.textContent.endsWith(" ")
    ? serialized.replace(/&#x20;$/, " ")
    : serialized;
}
