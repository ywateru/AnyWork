import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  DOMParser as ProseMirrorDOMParser,
  Fragment,
  Schema,
  Slice,
  type Node as ProseMirrorNode,
  type NodeSpec,
  type TagParseRule,
} from "prosemirror-model";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import {
  baseKeymap,
  chainCommands,
  createParagraphNear,
  liftEmptyBlock,
  splitBlock,
  newlineInCode,
} from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { history, redo, undo } from "prosemirror-history";
import { Transform } from "prosemirror-transform";
import {
  parsePromptText,
  promptAtomAttributes,
  promptLinkAttributes,
  serializePromptText,
  serializePromptLink,
  serializeLibraryMention,
  type PromptDocument,
  httpPromptHref,
  editablePromptLinkHref,
  promptThreadHref,
} from "../../promptText";
import { useThreadLinkNavigation } from "../ThreadLinkNavigation";
import { editPromptLink } from "../../promptLinkEditing";
import { promptLinkIcons } from "../../promptLinkIcons";
import PromptLinkPopover, { type PromptLinkTarget } from "./PromptLinkPopover";
import {
  firstAuthoredLink,
  normalizeUserMessageMarkdown,
  unescapeAuthoredLabel,
  unescapeAuthoredPath,
} from "../../userMessageMarkdown";
import { libraryFileLink } from "../../libraryFileLinks";
import { libraryFileIcons } from "../../libraryFileIcons";
import { mountPromptFileName } from "../../promptFileName";
import { libraryIconKey } from "../LibraryFileLink";
import {
  createRichPromptSchema,
  parseRichPromptText,
  serializeRichPromptText,
  getRichPromptText,
  parsePlainRichPromptText,
} from "../../richPrompt";
import {
  historyEntries,
  historyStringHasReferences,
  historyText,
  moveHistory,
  readPromptHistory,
} from "../../promptHistory";
import {
  richEditorPlugins,
  richListNewline,
  richShiftNewline,
  richAltNewline,
  richTab,
  richInputKeymap,
} from "../../richEditorPlugins";
import type { ComposerSubmission } from "../../composerSubmission";
import {
  decodeLiteralClipboardText,
  literalRichPaste,
  normalizeRichPasteSlice,
  pasteInCodeContext,
  replaceRichPaste,
} from "../../richPaste";
import "./PromptEditor.css";

export interface PromptEditorHandle {
  focus: (position?: "start" | "end") => void;
  getText: () => string;
  getSubmission: () => ComposerSubmission;
  hasContent: () => boolean;
  isComposing: () => boolean;
  resetHistorySelection: () => void;
}

interface PromptEditorProps {
  value: string;
  onChange: (text: string) => void;
  onPlainTextChange?: (text: string) => void;
  onSubmit?: () => void;
  onAlternateSubmit?: () => void;
  onRecallQueuedMessage?: () => boolean;
  promptHistory?: { server: string; scope: string };
  richText?: boolean;
  enterBehavior?: "enter" | "newline";
  storageKey?: string;
  initialDocument?: PromptDocument;
  restorePathLinksAsFileMentions?: boolean;
  onPasteFiles?: (files: File[]) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

const nodeDataAttribute = "data-anywork-prompt-node";
let iconSequence = 0;

function restoredLink(
  element: HTMLElement,
  type: string,
  hrefAttribute = "data-prompt-link-href",
  labelAttribute = "data-prompt-link-label",
) {
  const href = element.getAttribute(hrefAttribute);
  if (href == null) return false;
  const label =
    element.getAttribute(labelAttribute) ?? element.textContent ?? "";
  const restored = parsePromptText(serializePromptLink(label, href), {
    restoreMarkdownLinksAsTextLinks: true,
  }).content[0]?.content?.[0];
  return restored?.type === type ? (restored.attrs ?? false) : false;
}

function nativeAtomRules(type: string): TagParseRule[] {
  const direct = (
    tag: string,
    fields: Record<string, string>,
  ): TagParseRule => ({
    tag,
    getAttrs: (element) =>
      Object.fromEntries(
        Object.entries(fields).map(([key, attribute]) => [
          key,
          element.getAttribute(attribute) ?? "",
        ]),
      ),
  });
  const rules: TagParseRule[] = [];
  if (type === "atMention")
    rules.push(
      direct("span[at-mention-label][at-mention-path][at-mention-fs-path]", {
        label: "at-mention-label",
        path: "at-mention-path",
        fsPath: "at-mention-fs-path",
      }),
    );
  if (type === "richLink")
    rules.push(
      direct(
        "span[rich-link-display-text][rich-link-href][rich-link-source-app-id]",
        {
          displayText: "rich-link-display-text",
          href: "rich-link-href",
          sourceAppId: "rich-link-source-app-id",
        },
      ),
    );
  if (type === "resourceMention")
    rules.push(
      {
        tag: "a[href]",
        getAttrs: (element) =>
          restoredLink(element, type, "href", "data-prompt-link-label"),
      },
      direct(
        "span[resource-mention-resource-uri][resource-mention-server][resource-mention-title]",
        {
          brandColor: "resource-mention-brand-color",
          iconSmall: "resource-mention-icon",
          resourceUri: "resource-mention-resource-uri",
          connectorId: "resource-mention-connector-id",
          linkId: "resource-mention-link-id",
          server: "resource-mention-server",
          title: "resource-mention-title",
        },
      ),
    );
  if (type === "chatGptLibraryFileMention")
    rules.push(
      {
        priority: 60,
        tag: "[data-prompt-link-href][data-prompt-link-label]",
        getAttrs: (element) => restoredLink(element, type),
      },
      {
        priority: 60,
        tag: '[data-inline-selection-pill][data-symbol="documentReference"][data-id^="file-library:"][data-keyword]',
        getAttrs: (element) => {
          const id = element.getAttribute("data-id")?.slice(13),
            title = element.getAttribute("data-keyword");
          return id && title
            ? {
                libraryFileId: id,
                fileId:
                  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                    id,
                  )
                    ? ""
                    : id,
                title,
                mimeType: element.getAttribute("data-mime-type") ?? "",
                libraryArtifactType:
                  element.getAttribute("data-library-artifact-type") ?? "",
              }
            : false;
        },
      },
      {
        tag: "span[chatgpt-library-file-mention-id][chatgpt-library-file-mention-title]",
        getAttrs: (element) => {
          const restored = restoredLink(element, type);
          const entrypoint = element.getAttribute(
            "chatgpt-library-file-mention-entrypoint",
          );
          return {
            entrypoint:
              entrypoint &&
              [
                "composer_library_picker",
                "library_start_chat",
                "at_mention",
                "pasted_url",
              ].includes(entrypoint)
                ? entrypoint
                : null,
            fileId:
              element.getAttribute("chatgpt-library-file-mention-file-id") ??
              "",
            libraryArtifactType:
              element.getAttribute(
                "chatgpt-library-file-mention-artifact-type",
              ) ?? "",
            libraryFileId: element.getAttribute(
              "chatgpt-library-file-mention-id",
            ),
            mimeType:
              element.getAttribute("chatgpt-library-file-mention-mime-type") ??
              "",
            sourceUrl: restored ? (restored.sourceUrl ?? "") : "",
            title: element.getAttribute("chatgpt-library-file-mention-title"),
          };
        },
      },
    );
  rules.push({
    tag: "span[data-prompt-link-href][data-prompt-link-label]",
    getAttrs: (element) => restoredLink(element, type),
  });
  return rules;
}

function codeLanguage(element: HTMLElement) {
  const code = element.querySelector<HTMLElement>(":scope > code");
  if (!code) return false;
  const language =
    code.getAttribute("data-language") ??
    code.getAttribute("data-lang") ??
    element.getAttribute("data-language") ??
    element.getAttribute("data-lang") ??
    [...code.classList, ...element.classList]
      .find((name) => /^(language|lang)-/.test(name))
      ?.replace(/^(language|lang)-/, "") ??
    null;
  const valid =
    language != null && /^[^`\s]+$/u.test(language) ? language : null;
  return { autoDetectLanguage: valid == null, language: valid };
}

/** The ordinary historical editor uses PZ, not the main composer's rich schema. */
export const promptSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", { dir: "auto" }, 0],
    },
    code_block: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      defining: true,
      attrs: {
        autoDetectLanguage: { default: true },
        language: { default: null },
      },
      parseDOM: [
        { tag: "pre", preserveWhitespace: "full", getAttrs: codeLanguage },
      ],
      toDOM: (node) => [
        "pre",
        { "data-composer-code-block": "", dir: "ltr" },
        [
          "code",
          {
            class: "hljs",
            spellcheck: "false",
            ...(typeof node.attrs.language === "string" &&
            /^[^`\s]+$/u.test(node.attrs.language) &&
            !(
              node.attrs.autoDetectLanguage !== false &&
              node.attrs.language === "plaintext"
            )
              ? { "data-language": node.attrs.language }
              : {}),
          },
          0,
        ],
      ],
    },
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
          parseDOM: [
            ...nativeAtomRules(name),
            {
              tag: `span[data-composer-node-type="${name}"]`,
              getAttrs: (element: HTMLElement) => {
                try {
                  const parsed: unknown = JSON.parse(
                    element.getAttribute(nodeDataAttribute) || "null",
                  );
                  return parsed &&
                    typeof parsed === "object" &&
                    !Array.isArray(parsed) &&
                    Object.entries(attrs).every(
                      ([key, spec]) =>
                        "default" in spec ||
                        typeof (parsed as Record<string, unknown>)[key] ===
                          "string",
                    )
                    ? parsed
                    : false;
                } catch {
                  return false;
                }
              },
            },
          ],
          toDOM: (node: ProseMirrorNode) => [
            "span",
            atomDOMAttributes(node),
            atomLabel(node),
          ],
        } satisfies NodeSpec,
      ]),
    ),
  },
  marks: {
    link: {
      attrs: promptLinkAttributes,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (element) =>
            editablePromptLinkHref(element.getAttribute("href") ?? "") == null
              ? false
              : {
                  href: editablePromptLinkHref(
                    element.getAttribute("href") ?? "",
                  ),
                  title: element.getAttribute("title"),
                },
        },
        {
          tag: "span[text-link-href]",
          getAttrs: (element) => {
            const href = editablePromptLinkHref(
              element.getAttribute("text-link-href") ?? "",
            );
            return href == null
              ? false
              : {
                  href,
                  title: element.getAttribute("text-link-title"),
                  isAutolink: element.hasAttribute("data-breakable-url"),
                  isGeneratedAutolink: element.hasAttribute(
                    "data-rich-text-generated-autolink",
                  ),
                };
          },
        },
      ],
      toDOM: (mark) => [
        "a",
        { href: mark.attrs.href, title: mark.attrs.title },
        0,
      ],
    },
  },
});

export const richPromptSchema = createRichPromptSchema(promptSchema);

function persistedText(doc: ProseMirrorNode) {
  return doc.type.schema === richPromptSchema
    ? serializeRichPromptText(doc)
    : outputText(doc);
}
function submittedText(doc: ProseMirrorNode) {
  return doc.type.schema === richPromptSchema
    ? getRichPromptText(doc)
    : outputText(doc);
}

function outputText(doc: ProseMirrorNode, clipboard = false) {
  const text = serializePromptText(doc.toJSON() as PromptDocument, {
    preserveTextLinkMarks: !clipboard,
    forClipboard: clipboard,
  });
  return normalizeUserMessageMarkdown(text);
}

function atomLabel(node: ProseMirrorNode) {
  if (node.type.name === "richLink")
    return node.attrs.isLoading
      ? (node.attrs.loadingDisplayText ?? node.attrs.displayText)
      : node.attrs.displayText;
  if (
    [
      "skillMention",
      "browserSkillMention",
      "appMention",
      "pluginMention",
      "agentMention",
    ].includes(node.type.name)
  )
    return node.attrs.displayName || node.attrs.name || "";
  if (
    node.type.name === "browserTabMention" ||
    node.type.name === "pageTaskMention"
  ) {
    const link = firstAuthoredLink(
      serializePromptText({
        type: "doc",
        content: [{ type: "paragraph", content: [node.toJSON()] }],
      }),
    );
    if (link) return unescapeAuthoredLabel(link.label);
  }
  for (const key of [
    "label",
    "title",
    "displayText",
    "displayName",
    "name",
    "path",
  ])
    if (typeof node.attrs[key] === "string" && node.attrs[key])
      return node.attrs[key] as string;
  return "";
}

function atomDOMAttributes(node: ProseMirrorNode) {
  const attrs = { ...node.attrs };
  for (const key of [
    "literalMarkdownOccurrenceId",
    "literalMarkdownSource",
    "markdownSourceEnd",
    "markdownSourceStart",
  ])
    delete attrs[key];
  if (node.type.name === "richLink") delete attrs.libraryFileId;
  const native: Record<string, string> = {};
  const write = (prefix: string, fields: Record<string, string>) => {
    for (const [key, attribute] of Object.entries(fields))
      native[prefix + attribute] = String(node.attrs[key] ?? "");
  };
  if (node.type.name === "atMention")
    write("at-mention-", { label: "label", path: "path", fsPath: "fs-path" });
  if (node.type.name === "richLink") {
    write("rich-link-", {
      displayText: "display-text",
      href: "href",
      sourceAppId: "source-app-id",
    });
    if (node.attrs.isLoading) native["rich-link-loading"] = "";
  }
  if (node.type.name === "resourceMention")
    write("resource-mention-", {
      brandColor: "brand-color",
      iconSmall: "icon",
      resourceUri: "resource-uri",
      connectorId: "connector-id",
      linkId: "link-id",
      server: "server",
      title: "title",
    });
  if (node.type.name === "chatGptLibraryFileMention") {
    write("chatgpt-library-file-mention-", {
      libraryArtifactType: "artifact-type",
      fileId: "file-id",
      libraryFileId: "id",
      mimeType: "mime-type",
      title: "title",
    });
    if (node.attrs.entrypoint)
      native["chatgpt-library-file-mention-entrypoint"] = node.attrs.entrypoint;
    if (node.attrs.serializeAsUrl) native["data-library-provider-file"] = "";
  }
  if (node.type.name !== "richLink") {
    const link = atomLink(node);
    if (link) {
      native["data-prompt-link-href"] = link.href;
      native["data-prompt-link-label"] = link.text;
    }
  }
  return {
    ...native,
    "data-composer-node-type": node.type.name,
    [nodeDataAttribute]: JSON.stringify(attrs),
    contenteditable: "false",
    class: "prompt-inline-atom",
  };
}

function atomLink(node: ProseMirrorNode) {
  if (node.type.name === "richLink")
    return {
      href: String(node.attrs.href),
      text: String(node.attrs.displayText),
    };
  if (node.type.name === "chatGptLibraryFileMention")
    return {
      href: serializeLibraryMention(node.attrs),
      text: String(node.attrs.title),
    };
  const value = serializePromptText({
    type: "doc",
    content: [{ type: "paragraph", content: [node.toJSON()] }],
  });
  const link = firstAuthoredLink(value);
  return link
    ? {
        href: unescapeAuthoredPath(link.path),
        text: unescapeAuthoredLabel(link.label),
      }
    : null;
}

function atomView(node: ProseMirrorNode) {
  const dom = document.createElement("span");
  for (const [name, value] of Object.entries(atomDOMAttributes(node)))
    dom.setAttribute(name, value);
  const icon = document.createElement("span");
  icon.className = "prompt-inline-atom-icon";
  icon.setAttribute("aria-hidden", "true");
  let artwork: { readonly viewBox: string; readonly body: string } =
    libraryFileIcons.file;
  if (node.type.name === "richLink") {
    if (node.attrs.isLoading) {
      dom.setAttribute("aria-busy", "true");
      icon.classList.add("prompt-link-loading");
    } else {
      dom.setAttribute(
        "role",
        promptThreadHref(node.attrs.href) ? "link" : "button",
      );
      dom.setAttribute("tabindex", "0");
      if (!promptThreadHref(node.attrs.href)) {
        dom.setAttribute("aria-expanded", "false");
        dom.setAttribute("aria-haspopup", "dialog");
      }
      dom.setAttribute("title", node.attrs.href);
      dom.setAttribute("data-interactive", "");
      dom.setAttribute("data-underline-on-hover", "");
    }
    artwork = node.attrs.isLoading
      ? promptLinkIcons.loading
      : promptLinkIcons.inline;
  } else if (node.type.name === "chatGptLibraryFileMention") {
    dom.setAttribute("data-layout", "selection-pill");
    dom.setAttribute("data-appearance", "inline-mention");
    dom.setAttribute("data-tone", "file-reference");
    const text = outputText(
      promptSchema.node(
        "doc",
        null,
        promptSchema.node("paragraph", null, node),
      ),
    );
    const match = /\]\((chatgpt-library-file:\/\/.+)\)$/.exec(text);
    const file = match && libraryFileLink(match[1]);
    let source = "about:blank";
    try {
      source = new URL(node.attrs.sourceUrl).href;
    } catch {
      /* Local library files have no source URL. */
    }
    const key = libraryIconKey(
      file || {
        libraryFileId: node.attrs.libraryFileId,
        mimeType: node.attrs.mimeType,
        href: source,
      },
      atomLabel(node),
    );
    artwork = libraryFileIcons[key];
    icon.setAttribute("data-file-icon", key);
    if (file) {
      dom.setAttribute("data-prompt-link-href", file.mentionPath);
    }
  } else if (node.type.name === "atMention") {
    const key = libraryIconKey(
      { libraryFileId: "", mimeType: "", href: "about:blank" },
      node.attrs.path,
    );
    artwork = libraryFileIcons[key];
    icon.setAttribute("data-file-icon", key);
  }
  // These paths are inert static artwork from the selected reference package.
  const id = `prompt-icon-${++iconSequence}`;
  const body = artwork.body
    .replace(/id="([^"]+)"/g, `id="${id}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${id}-$1)`);
  icon.innerHTML = `<svg width="16" height="16" viewBox="${artwork.viewBox}" fill="${"fill" in artwork ? artwork.fill : "none"}">${body}</svg>`;
  const label = document.createElement("span");
  label.className = "prompt-inline-atom-label";
  label.textContent = atomLabel(node);
  dom.append(icon, label);
  const dispose =
    node.type.name === "chatGptLibraryFileMention"
      ? mountPromptFileName(label, atomLabel(node))
      : undefined;
  if (node.type.name === "chatGptLibraryFileMention") {
    dom.setAttribute("aria-label", atomLabel(node));
    dom.setAttribute("title", atomLabel(node));
  }
  return {
    dom,
    destroy: dispose,
    ignoreMutation: (mutation: {
      type: string;
      target: Node;
      attributeName?: string | null;
    }) =>
      mutation.type !== "selection" &&
      (icon.contains(mutation.target) ||
        label.contains(mutation.target) ||
        (mutation.type === "attributes" &&
          mutation.target === dom &&
          [
            "style",
            "data-inline-mention-selected",
            "data-composer-inline-atom-selected",
            "aria-expanded",
          ].includes(mutation.attributeName ?? ""))),
  };
}

/** ola's live span; schema toDOM remains the ordinary clipboard anchor. */
function linkMarkView(mark: ProseMirrorNode["marks"][number]) {
  const dom = document.createElement("span"),
    label = document.createElement("span");
  dom.className = "prompt-text-link";
  dom.setAttribute("data-appearance", "inline-mention");
  dom.setAttribute("data-layout", "inline-flow");
  const explicit = mark.attrs.href != null && mark.attrs.isAutolink !== true;
  dom.setAttribute("data-font-weight", explicit ? "inherit" : "medium");
  if (typeof mark.attrs.href === "string")
    dom.setAttribute("text-link-href", mark.attrs.href);
  if (typeof mark.attrs.title === "string")
    dom.setAttribute("text-link-title", mark.attrs.title);
  if (mark.attrs.isGeneratedAutolink)
    dom.setAttribute("data-rich-text-generated-autolink", "");
  if (explicit) {
    dom.setAttribute("role", "button");
    dom.tabIndex = 0;
    dom.setAttribute("aria-expanded", "false");
    dom.setAttribute("aria-haspopup", "dialog");
    dom.setAttribute("data-interactive", "");
    dom.title = mark.attrs.href;
  } else dom.setAttribute("data-breakable-url", "");
  dom.append(label);
  return {
    dom,
    contentDOM: label,
    ignoreMutation: (mutation: {
      type: string;
      target: Node;
      attributeName?: string | null;
    }) =>
      mutation.type === "attributes" &&
      mutation.target === dom &&
      mutation.attributeName === "aria-expanded",
  };
}

function isMobileEnter() {
  return (
    !/Win/.test(navigator.platform) && matchMedia("(pointer: coarse)").matches
  );
}

// Native navigation can move the DOM caret before selectionchange reaches the
// editor. Keyboard commands must use the position the user can currently see.
function syncDOMTextSelection(editor: EditorView) {
  const selection = editor.dom.ownerDocument.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !editor.dom.contains(selection.anchorNode) ||
    !editor.dom.contains(selection.focusNode)
  )
    return;
  const anchor = editor.posAtDOM(selection.anchorNode, selection.anchorOffset),
    head = editor.posAtDOM(selection.focusNode, selection.focusOffset),
    current = editor.state.selection;
  if (anchor === current.anchor && head === current.head) return;
  const $anchor = editor.state.doc.resolve(anchor),
    $head = editor.state.doc.resolve(head);
  // Atomic and whole-document selections retain ProseMirror's own semantics.
  if (!$anchor.parent.inlineContent || !$head.parent.inlineContent) return;
  editor.dispatch(
    editor.state.tr
      .setSelection(TextSelection.between($anchor, $head))
      .setMeta("addToHistory", false),
  );
}

function plainSlice(text: string, view: EditorView) {
  const selection = view.state.selection;
  const marks =
    view.state.storedMarks ??
    (selection.empty
      ? selection.$from.marks()
      : (selection.$from.marksAcross(selection.$to) ?? []));
  return new Slice(
    Fragment.fromArray(
      text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line, index) =>
          view.state.schema.node(
            "paragraph",
            null,
            line
              ? view.state.schema.text(line, index === 0 ? marks : [])
              : undefined,
          ),
        ),
    ),
    1,
    1,
  );
}

function webURL(text: string) {
  const value = text.trim();
  if (!value || /\s/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function sanitizedPasteHTML(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const element of document.body.querySelectorAll(
    'script,style,template,noscript,[hidden],[aria-hidden="true"]',
  ))
    element.remove();
  for (const element of document.body.querySelectorAll<HTMLElement>("[style]"))
    if (
      element.style.display === "none" ||
      element.style.visibility === "hidden" ||
      Number.parseFloat(element.style.opacity) === 0
    )
      element.remove();
  for (const element of document.body.querySelectorAll<HTMLElement>(
    '[data-prompt-link-href^="chatgpt-library-file://"], [chatgpt-library-file-mention-id], [data-inline-selection-pill][data-symbol="documentReference"][data-id^="file-library:"]',
  ))
    element.style.fontWeight = "";
  for (const element of Array.from(document.body.querySelectorAll("math"))) {
    const source =
      element.querySelector('annotation[encoding="application/x-tex"]')
        ?.textContent ??
      element.getAttribute("alttext") ??
      element.textContent;
    if (!source?.trim()) continue;
    const root =
      element.closest(".katex-display") ?? element.closest(".katex") ?? element;
    const code = document.createElement("code");
    code.textContent = source;
    if (
      element.getAttribute("display") === "block" ||
      root.matches(".katex-display, .math-display")
    ) {
      code.className = "language-math";
      const pre = document.createElement("pre");
      pre.append(code);
      root.replaceWith(pre);
    } else root.replaceWith(code);
  }
  let didNormalizeMedia = false;
  const tails = new Map<Element, ChildNode>();
  for (const element of Array.from(
    document.body.querySelectorAll(
      "img,svg,video,audio,canvas,iframe,object,embed",
    ),
  )) {
    didNormalizeMedia = true;
    const label =
      element.getAttribute("alt")?.trim() ||
      element.getAttribute("aria-label")?.trim() ||
      element.getAttribute("title")?.trim() ||
      element.textContent?.trim() ||
      (element.localName === "img" ? "image" : element.localName);
    const href =
      element.getAttribute("src") ||
      element.getAttribute("data") ||
      element.querySelector('source[src]:not([src=""])')?.getAttribute("src");
    let link: HTMLAnchorElement | null = null;
    if (href) {
      const candidate = document.createElement("a");
      candidate.href = href;
      if (candidate.protocol !== "data:") link = candidate;
    }
    let parent = element.closest<HTMLAnchorElement>("a[href]");
    if (parent?.protocol === "data:") {
      parent.replaceWith(...Array.from(parent.childNodes));
      parent = null;
    }
    if (parent) {
      element.replaceWith(document.createTextNode(label));
      if (link && href !== parent.getAttribute("href")) {
        link.textContent =
          element.localName === "img" ? "image" : element.localName;
        const end = document.createTextNode(")");
        const tail = tails.get(parent) ?? parent;
        tail.after(document.createTextNode(" ("), link, end);
        tails.set(parent, end);
      }
    } else if (link) {
      link.textContent = label;
      element.replaceWith(link);
    } else element.replaceWith(document.createTextNode(label));
  }
  return { document, didNormalizeMedia };
}

function stripPasteStyles(document: Document) {
  const unwrap: Element[] = [];
  for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
    for (const name of [
      "color",
      "backgroundColor",
      "fontFamily",
      "fontSize",
      "lineHeight",
      "textDecoration",
      "textShadow",
    ] as const)
      element.style[name] = "";
    if (element.closest("h1,h2,h3,h4,h5,h6")) element.style.fontWeight = "";
    if (element.getAttribute("style") === "") element.removeAttribute("style");
    if (element.matches("span,font") && !element.hasAttributes())
      unwrap.push(element);
  }
  for (const element of unwrap.reverse())
    element.replaceWith(...Array.from(element.childNodes));
}

function structuredPasteHTML(document: Document, schema: Schema) {
  if (
    /\bdocs-internal-guid/i.test(document.body.innerHTML) ||
    document.body.querySelector(":is(p,ul,ol) + :is(p,ul,ol)")
  )
    return true;
  let structured = false;
  ProseMirrorDOMParser.fromSchema(schema)
    .parse(document.body)
    .descendants((node) => {
      structured ||=
        (node.isBlock && node.type !== schema.nodes.paragraph) ||
        (node.isInline &&
          !node.isText &&
          node.isAtom &&
          node.type !== schema.nodes.hard_break) ||
        (node.isText &&
          node.marks.some(
            (mark) => !["startend", "literalPaste"].includes(mark.type.name),
          ));
      return !structured;
    });
  return structured;
}

function pastedHTML(html: string, editor: EditorView) {
  const { document, didNormalizeMedia } = sanitizedPasteHTML(html);
  const cleanedHTML = document.body.innerHTML;
  let formatted = false;
  ProseMirrorDOMParser.fromSchema(richPromptSchema)
    .parse(document.body)
    .descendants((node) => {
      formatted ||=
        (node.isBlock && node.type.name !== "paragraph") ||
        node.marks.some(
          (mark) =>
            !["literalPaste", "startend", "link"].includes(mark.type.name),
        );
      return !formatted;
    });
  const nativeSlice = /^\d+ \d+(?: -\d+)? /.test(
    document.body
      .querySelector("[data-pm-slice]")
      ?.getAttribute("data-pm-slice") ?? "",
  );
  stripPasteStyles(document);
  const structured = structuredPasteHTML(document, editor.state.schema);
  if (!editor.state.schema.nodes.hard_break) {
    for (const item of document.body.querySelectorAll("li")) {
      const list = item.parentElement;
      let depth = 0;
      for (
        let parent = list?.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (parent.matches("ol,ul")) depth++;
      const marker =
        list?.tagName === "OL"
          ? `${Number(list.getAttribute("start") ?? 1) + Array.from(list.children).indexOf(item)}. `
          : "- ";
      (item.querySelector(":scope > p") ?? item).prepend(
        document.createTextNode("  ".repeat(depth) + marker),
      );
    }
  } else if (!nativeSlice) {
    for (const paragraph of document.body.querySelectorAll("p + p")) {
      if (
        paragraph.previousElementSibling?.textContent
          ?.replaceAll("\u200b", "")
          .trim() &&
        paragraph.textContent?.replaceAll("\u200b", "").trim() &&
        !paragraph.closest("li,td,th")
      ) {
        const gap = document.createElement("p");
        gap.setAttribute("data-composer-paragraph-gap", "true");
        paragraph.before(gap);
      }
    }
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode;
    if (!/[\r\n]/.test(text.textContent ?? "")) continue;
    let preserve = false;
    for (
      let parent = text.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (
        parent.tagName === "PRE" ||
        /^\d+ \d+(?: -\d+)? /.test(
          parent.getAttribute("data-pm-slice") ?? "",
        ) ||
        /^(pre|pre-wrap|pre-line|break-spaces)$/.test(parent.style.whiteSpace)
      ) {
        preserve = true;
        break;
      }
      if (/^(normal|nowrap)$/.test(parent.style.whiteSpace)) break;
    }
    if (!preserve)
      text.textContent = text.textContent?.replace(/\r\n?|\n/g, " ") ?? "";
  }
  const schema = editor.state.schema;
  const parser = ProseMirrorDOMParser.fromSchema(schema);
  const rules = parser.rules.map((rule) =>
    "node" in rule && rule.node && schema.nodes[rule.node].isTextblock
      ? { ...rule, preserveWhitespace: "full" as const }
      : rule,
  );
  const parsed = new ProseMirrorDOMParser(schema, rules).parse(document.body, {
    preserveWhitespace: true,
    context: editor.state.selection.$from,
  });
  const slice = Slice.maxOpen(parsed.content);
  const transform = new Transform(parsed);
  parsed.descendants((node, position) => {
    if (node.isInline && !node.isText && atomLink(node))
      transform.removeMark(
        position,
        position + node.nodeSize,
        schema.marks.link,
      );
  });
  const stripped = new Slice(
    transform.doc.content,
    slice.openStart,
    slice.openEnd,
  );
  return {
    document,
    parsed,
    slice,
    structured,
    formatted,
    cleanedHTML,
    didNormalizeMedia,
    preferredSlice: nativeSlice
      ? stripped
      : normalizeRichPasteSlice(stripped, schema),
  };
}

function leafAwareText(doc: ProseMirrorNode) {
  return doc.textBetween(0, doc.content.size, "\n", (node) =>
    node.type.name === "richLink"
      ? String(node.attrs.displayText)
      : atomLabel(node),
  );
}

/** Native mte bounds hidden link material, rather than the visible document length. */
function excessiveHiddenLinks(doc: ProseMirrorNode, baseline: number) {
  let hidden = 0;
  const add = (text: string, href: string, title = "", visible = text) => {
    hidden +=
      (text.includes(href) ? 0 : href.length) +
      title.length +
      Math.max(0, text.length - visible.length);
  };
  const visit = (node: ProseMirrorNode) => {
    if (node.type.name === "code_block") return;
    let run = "",
      link: ProseMirrorNode["marks"][number] | undefined;
    const flush = () => {
      if (
        link &&
        typeof link.attrs.href === "string" &&
        (link.attrs.title || !run.includes(link.attrs.href))
      )
        add(run, link.attrs.href, link.attrs.title ?? "");
      run = "";
      link = undefined;
    };
    node.forEach((child) => {
      if (child.isText) {
        const mark = child.marks.find((mark) => mark.type.name === "link");
        if (run && !(mark ? link?.eq(mark) : !link)) flush();
        run += child.text;
        link = mark;
      } else {
        flush();
        if (child.isInline) {
          const atom = atomLink(child);
          if (atom) add(atom.text, atom.href, "", atomLabel(child));
        } else visit(child);
      }
    });
    flush();
  };
  visit(doc);
  return hidden >= 5000 && hidden >= baseline;
}

const selectCodeBody: Command = (state, dispatch) => {
  const { $from, $to, from, to } = state.selection;
  if (
    $from.parent.type.name !== "code_block" ||
    !$from.sameParent($to) ||
    (from === $from.start() && to === $from.end())
  )
    return false;
  dispatch?.(
    state.tr.setSelection(
      TextSelection.create(state.doc, $from.start(), $from.end()),
    ),
  );
  return true;
};

const leaveCodeBlock: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  if ($from.parent.type.name !== "code_block" || !$from.sameParent($to))
    return false;
  const after = $from.after();
  const transaction =
    state.doc.nodeAt(after)?.type.name === "paragraph"
      ? state.tr
      : state.tr.insert(after, state.schema.node("paragraph"));
  dispatch?.(
    transaction
      .setSelection(TextSelection.create(transaction.doc, after + 1))
      .scrollIntoView(),
  );
  return true;
};

const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(
  function PromptEditor(props, ref) {
    const navigateThreadLink = useThreadLinkNavigation();
    const mount = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const latest = useRef(props);
    const emitted = useRef(props.value);
    const initialDocument = useRef(props.initialDocument);
    const plainPaste = useRef(false);
    const compositionEndedAt = useRef(-Infinity);
    const historySelection = useRef<number | null>(null);
    const [linkTarget, setLinkTarget] = useState<PromptLinkTarget | null>(null);
    const linkTargetRef = useRef<PromptLinkTarget | null>(null);
    latest.current = props;
    function closeLink(restoreFocus = true) {
      const element = linkTargetRef.current?.element;
      element?.setAttribute("aria-expanded", "false");
      linkTargetRef.current = null;
      setLinkTarget(null);
      if (restoreFocus) {
        if (element?.isConnected) element.focus({ preventScroll: true });
        else view.current?.focus();
      }
    }
    function preventThreadMiddlePaste(event: {
      button: number;
      target: EventTarget;
      preventDefault: () => void;
    }) {
      if (event.button !== 1 || !(event.target instanceof Element)) return;
      const element = event.target.closest<HTMLElement>(
        "[rich-link-href]:not([rich-link-loading])",
      );
      if (
        element &&
        promptThreadHref(element.getAttribute("rich-link-href") ?? "")
      )
        event.preventDefault();
    }
    function openLink(event: Event) {
      const editor = view.current;
      if (
        !editor ||
        latest.current.disabled ||
        latest.current.readOnly ||
        !(event.target instanceof Element)
      )
        return false;
      const element = event.target.closest<HTMLElement>(
        ":is([rich-link-display-text][rich-link-href]:not([rich-link-loading]), [text-link-href], [data-breakable-url])",
      );
      if (!element || !editor.dom.contains(element)) return false;
      const displayText =
        element.getAttribute("rich-link-display-text") ?? element.textContent;
      const href =
        element.getAttribute("rich-link-href") ??
        element.getAttribute("text-link-href") ??
        httpPromptHref(element.textContent ?? "");
      if (displayText == null || href == null) return false;
      event.preventDefault();
      event.stopPropagation();
      if (element.hasAttribute("rich-link-href") && promptThreadHref(href)) {
        closeLink(false);
        navigateThreadLink?.(href, event as MouseEvent);
        return true;
      }
      linkTargetRef.current?.element.setAttribute("aria-expanded", "false");
      element.setAttribute("aria-expanded", "true");
      const target = { element, displayText, href };
      linkTargetRef.current = target;
      setLinkTarget(target);
      return true;
    }
    function saveLink(text: string, href: string | null) {
      const editor = view.current,
        target = linkTargetRef.current;
      if (
        !editor ||
        !target ||
        latest.current.disabled ||
        latest.current.readOnly ||
        !editor.dom.contains(target.element)
      ) {
        closeLink(false);
        return;
      }
      const from = editor.posAtDOM(target.element, 0);
      const node = editor.state.doc.nodeAt(from);
      const to = node?.isText
        ? editor.posAtDOM(target.element, target.element.childNodes.length)
        : from + (node?.nodeSize ?? 0);
      const transaction = editPromptLink(editor.state, from, to, text, href);
      if (transaction) {
        editor.dispatch(transaction);
        editor.focus();
      }
      closeLink();
    }
    function checkHistorySelection(doc: ProseMirrorNode) {
      const scope = latest.current.promptHistory;
      if (historySelection.current === null) return;
      const entry = scope
        ? historyEntries(readPromptHistory(scope.server), scope.scope)[
            historySelection.current
          ]
        : undefined;
      if (entry == null || historyText(entry) !== persistedText(doc))
        historySelection.current = null;
    }
    function navigateHistory(editor: EditorView, direction: "up" | "down") {
      const scope = latest.current.promptHistory;
      if (!scope) return false;
      const next = moveHistory(
        historyEntries(readPromptHistory(scope.server), scope.scope),
        historySelection.current,
        direction,
        persistedText(editor.state.doc),
      );
      if (!next) {
        historySelection.current = null;
        return false;
      }
      historySelection.current = next.index;
      const entry = next.entry;
      const schema = editor.state.schema;
      let document: ProseMirrorNode | undefined;
      if (entry && typeof entry !== "string" && entry.document) {
        try {
          const restored = schema.nodeFromJSON(entry.document);
          restored.check();
          if (restored.type === schema.topNodeType) document = restored;
        } catch {
          /* Incompatible old documents use their explicit text format. */
        }
      }
      if (!document) {
        const source = entry === null ? "" : historyText(entry);
        const markdown =
          entry !== null &&
          (typeof entry === "string"
            ? historyStringHasReferences(entry)
            : "markdown" in entry);
        document = markdown
          ? latest.current.richText
            ? parseRichPromptText(schema, source, {
                restoreMarkdownLinksAsTextLinks: true,
                restorePathLinksAsFileMentions:
                  latest.current.restorePathLinksAsFileMentions,
              })
            : schema.nodeFromJSON(parsePromptText(source))
          : latest.current.richText
            ? parsePlainRichPromptText(schema, source)
            : schema.nodes.doc.create(
                null,
                source
                  .split("\n")
                  .map((line) =>
                    schema.nodes.paragraph.create(
                      null,
                      line ? schema.text(line) : null,
                    ),
                  ),
              );
      }
      const transaction = editor.state.tr.replaceWith(
        0,
        editor.state.doc.content.size,
        document.content,
      );
      transaction.setSelection(TextSelection.atEnd(transaction.doc));
      editor.dispatch(transaction.scrollIntoView());
      editor.focus();
      return true;
    }
    function parseValue(value: string) {
      const schema = latest.current.richText ? richPromptSchema : promptSchema;
      if (latest.current.richText) {
        const restoreDocument = (candidate: PromptDocument | undefined) => {
          if (!candidate) return null;
          try {
            const document = schema.nodeFromJSON(candidate);
            document.check();
            return serializeRichPromptText(document) === value
              ? document
              : null;
          } catch {
            return null;
          }
        };
        const initial = restoreDocument(latest.current.initialDocument);
        if (initial) return initial;
        let candidate: PromptDocument | undefined;
        if (latest.current.storageKey) {
          try {
            const saved = JSON.parse(
              sessionStorage.getItem(
                `anywork.composer-document.${latest.current.storageKey}`,
              ) || "null",
            );
            const match = [
              saved,
              ...(Array.isArray(saved?.history) ? saved.history : []),
            ].find((entry) => entry?.markdown === value);
            if (match) candidate = match.document;
          } catch {
            /* A blocked or invalid browser draft falls back to Markdown. */
          }
        }
        const cached = restoreDocument(candidate);
        if (cached) return cached;
        if (latest.current.storageKey && !latest.current.initialDocument)
          return schema.nodeFromJSON(
            parsePromptText(value, { restoreMarkdownLinksAsTextLinks: true }),
          );
        return parseRichPromptText(schema, value, {
          restorePathLinksAsFileMentions:
            latest.current.restorePathLinksAsFileMentions,
          restoreMarkdownLinksAsTextLinks: true,
        });
      }
      return schema.nodeFromJSON(
        parsePromptText(value, { restoreMarkdownLinksAsTextLinks: true }),
      );
    }
    function saveDocument(doc: ProseMirrorNode, markdown: string) {
      if (!latest.current.richText || !latest.current.storageKey) return;
      try {
        const key = `anywork.composer-document.${latest.current.storageKey}`;
        let saved;
        try {
          saved = JSON.parse(sessionStorage.getItem(key) || "null");
        } catch {
          saved = null;
        }
        const history = [
          saved,
          ...(Array.isArray(saved?.history) ? saved.history : []),
        ]
          .filter((entry) => entry?.markdown !== markdown && entry?.document)
          .slice(0, 8)
          .map((entry) => ({
            markdown: entry.markdown,
            document: entry.document,
          }));
        sessionStorage.setItem(
          key,
          JSON.stringify({ markdown, document: doc.toJSON(), history }),
        );
      } catch {
        /* The controlled Markdown draft still remains available. */
      }
    }

    useImperativeHandle(
      ref,
      () => ({
        focus(position = "end") {
          const editor = view.current;
          if (!editor) return;
          editor.dispatch(
            editor.state.tr.setSelection(
              position === "start"
                ? TextSelection.atStart(editor.state.doc)
                : TextSelection.atEnd(editor.state.doc),
            ),
          );
          editor.focus();
        },
        getText: () =>
          view.current
            ? submittedText(view.current.state.doc)
            : latest.current.value,
        hasContent: () => {
          const editor = view.current;
          if (!editor) return !!latest.current.value.trim();
          let content = false;
          editor.state.doc.descendants((node) => {
            if (node.type === editor.state.schema.nodes.code_block) {
              content ||= !!node.textContent.trim();
              return false;
            }
            if (node.isText) content ||= !!node.textContent?.trim();
            else if (node.isInline) content = true;
            return !content;
          });
          return content;
        },
        getSubmission: () => {
          const doc =
            view.current?.state.doc ?? parseValue(latest.current.value);
          return {
            text: submittedText(doc),
            composer: {
              markdown: persistedText(doc),
              document: doc.toJSON() as PromptDocument,
            },
          };
        },
        isComposing: () =>
          !!view.current?.composing ||
          performance.now() - compositionEndedAt.current < 100,
        resetHistorySelection: () => {
          historySelection.current = null;
        },
      }),
      [],
    );

    useLayoutEffect(() => {
      if (!mount.current) return;
      const schema = latest.current.richText ? richPromptSchema : promptSchema;
      const newline = chainCommands(
        newlineInCode,
        richListNewline,
        createParagraphNear,
        liftEmptyBlock,
        splitBlock,
      );
      const submit: Command = () => {
        if (latest.current.disabled || latest.current.readOnly) return true;
        if (performance.now() - compositionEndedAt.current < 100) return true;
        latest.current.onSubmit?.();
        return true;
      };
      const alternateSubmit: Command = () => {
        if (
          latest.current.disabled ||
          latest.current.readOnly ||
          performance.now() - compositionEndedAt.current < 100
        )
          return true;
        (latest.current.onAlternateSubmit ?? latest.current.onSubmit)?.();
        return true;
      };
      const editor: EditorView = new EditorView(mount.current, {
        state: EditorState.create({
          schema,
          doc: parseValue(latest.current.value),
          plugins: [
            history({ depth: 100, newGroupDelay: 500 }),
            ...(latest.current.richText ? richEditorPlugins(schema) : []),
            keymap({
              ...richInputKeymap(schema),
              "Mod-z": undo,
              Tab: (state, dispatch, view) =>
                richTab(false)(state, dispatch, view),
              "Shift-Tab": (state, dispatch, view) =>
                richTab(true)(state, dispatch, view),
              "Mod-a": selectCodeBody,
              "Mod-y": redo,
              "Shift-Mod-z": redo,
              "Shift-Enter": (state, dispatch, view) =>
                chainCommands(
                  newlineInCode,
                  richShiftNewline(latest.current.enterBehavior !== "newline"),
                  createParagraphNear,
                  liftEmptyBlock,
                  splitBlock,
                )(state, dispatch, view),
              "Alt-Enter": chainCommands(
                newlineInCode,
                richAltNewline,
                createParagraphNear,
                liftEmptyBlock,
                splitBlock,
              ),
              "Mod-Enter": chainCommands(leaveCodeBlock, alternateSubmit),
              Enter: (state, dispatch, editor) =>
                isMobileEnter() ||
                latest.current.enterBehavior === "newline" ||
                !latest.current.onSubmit
                  ? newline(state, dispatch, editor)
                  : submit(state, dispatch, editor),
            }),
            keymap(baseKeymap),
          ],
        }),
        editable: () => !latest.current.disabled && !latest.current.readOnly,
        attributes: () => ({
          class: `prompt-editor${latest.current.richText ? " prompt-editor-rich" : ""}`,
          ...(latest.current.richText ? { "data-composer-markdown": "" } : {}),
          role: "textbox",
          "aria-label": latest.current.label,
          "aria-multiline": "true",
          "aria-disabled": String(!!latest.current.disabled),
          "aria-readonly": String(!!latest.current.readOnly),
          ...(latest.current.invalid ? { "aria-invalid": "true" } : {}),
          ...(latest.current.describedBy
            ? { "aria-describedby": latest.current.describedBy }
            : {}),
          dir: "auto",
          spellcheck: "true",
          tabindex: "0",
        }),
        decorations(state) {
          const decorations: Decoration[] = [];
          // Xca emits one inline icon at the beginning of each link mark run.
          state.doc.descendants((node, position) => {
            if (!node.isText) return;
            const link = node.marks.find(
              (mark) => mark.type === state.schema.marks.link,
            );
            if (
              !link ||
              state.doc
                .resolve(position)
                .nodeBefore?.marks.some((mark) => mark.eq(link))
            )
              return;
            decorations.push(
              Decoration.widget(
                position,
                () => {
                  const element = document.createElement("span");
                  element.className = "prompt-inline-atom-icon";
                  element.setAttribute("data-inline-url-icon", "");
                  element.setAttribute("aria-hidden", "true");
                  element.contentEditable = "false";
                  const icon = promptLinkIcons.inline;
                  element.innerHTML = `<svg width="16" height="16" viewBox="${icon.viewBox}" fill="${icon.fill}">${icon.body}</svg>`;
                  return element;
                },
                {
                  key: `prompt-url:${position}:${String(link.attrs.href)}`,
                  marks: node.marks,
                  side: 1,
                  relaxedSide: true,
                },
              ),
            );
          });
          if (!state.selection.empty) {
            const { from, to } = state.selection;
            state.doc.nodesBetween(from, to, (node, position) => {
              if (
                node.isInline &&
                !node.isText &&
                from <= position &&
                to >= position + node.nodeSize
              )
                decorations.push(
                  Decoration.node(position, position + node.nodeSize, {
                    "data-composer-inline-atom-selected": "",
                  }),
                );
            });
          }
          const child = state.doc.firstChild;
          if (
            state.doc.childCount === 1 &&
            child?.type.name === "paragraph" &&
            child.content.size === 0
          )
            decorations.push(
              Decoration.node(0, child.nodeSize, {
                class: "placeholder",
                "data-placeholder": latest.current.placeholder || "",
              }),
            );
          return DecorationSet.create(state.doc, decorations);
        },
        nodeViews: Object.fromEntries(
          Object.keys(promptAtomAttributes).map((name) => [name, atomView]),
        ),
        markViews: { link: linkMarkView },
        handleKeyDown(editor, event) {
          plainPaste.current = event.shiftKey && event.key !== "Insert";
          if (event.isComposing || editor.composing || event.keyCode === 229)
            return true;
          if (
            (event.key === "ArrowUp" || event.key === "ArrowDown") &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !latest.current.disabled &&
            !latest.current.readOnly &&
            performance.now() - compositionEndedAt.current >= 100 &&
            editor.state.selection.empty
          ) {
            const selection = editor.dom.ownerDocument.getSelection();
            if (
              selection?.isCollapsed &&
              selection.rangeCount > 0 &&
              selection.anchorNode &&
              editor.dom.contains(selection.anchorNode) &&
              editor.posAtDOM(
                selection.anchorNode,
                selection.anchorOffset,
                -1,
              ) === TextSelection.atEnd(editor.state.doc).from &&
              ((event.key === "ArrowUp" &&
                latest.current.onRecallQueuedMessage?.()) ||
                navigateHistory(
                  editor,
                  event.key === "ArrowUp" ? "up" : "down",
                ))
            ) {
              event.preventDefault();
              event.stopPropagation();
              return true;
            }
          }
          return false;
        },
        handleClick(_editor, _position, event) {
          if ((event.target as Element | null)?.closest("a"))
            event.preventDefault();
          return false;
        },
        handlePaste(editor, event) {
          if (event.defaultPrevented) return true;
          if (latest.current.disabled || latest.current.readOnly) return true;
          const data = event.clipboardData;
          if (!data) return false;
          const files = Array.from(data.files).filter((file) =>
            file.type.startsWith("image/"),
          );
          if (files.length && latest.current.onPasteFiles) {
            latest.current.onPasteFiles(files);
            return true;
          }
          const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
          const html = data.getData("text/html");
          const plain = plainPaste.current;
          plainPaste.current = false;
          if (html.length > 100000 && !text) return true;
          const rich = !!editor.state.schema.nodes.hard_break;
          const literalPaste = (value: string) => {
            const transaction = rich
              ? literalRichPaste(editor.state, value)
              : null;
            editor.dispatch(
              (
                transaction ??
                editor.state.tr.replaceSelection(plainSlice(value, editor))
              ).scrollIntoView(),
            );
          };
          if (editor.state.selection.$from.parent.type.name === "code_block") {
            editor.dispatch(
              editor.state.tr
                .insertText(text.replace(/\n+$/, ""))
                .scrollIntoView(),
            );
            return true;
          }
          if (plain) {
            if (text) literalPaste(text);
            return true;
          }
          if (html.length > 100000) {
            if (text) literalPaste(text);
            return true;
          }
          const parsedHTML = html ? pastedHTML(html, editor) : null;
          let hasLibrary = false;
          parsedHTML?.parsed.descendants((node) => {
            if (
              [
                "chatGptLibraryFileMention",
                "chatGptReferenceImageMention",
              ].includes(node.type.name)
            )
              hasLibrary = true;
          });
          const visible = parsedHTML ? leafAwareText(parsedHTML.parsed) : "";
          const excessive =
            parsedHTML &&
            excessiveHiddenLinks(
              parsedHTML.parsed,
              Math.max(text.length, visible.length),
            );
          if (
            parsedHTML &&
            hasLibrary &&
            !pasteInCodeContext(editor.state) &&
            /chatgpt-library-file-mention-id|data-inline-selection-pill|data-prompt-link-href/.test(
              html,
            )
          ) {
            if (excessive) literalPaste(text || visible);
            else
              editor.dispatch(
                replaceRichPaste(editor.state, parsedHTML.preferredSlice),
              );
            return true;
          }
          const formatted = parsedHTML?.formatted;
          const url = webURL(text),
            { from, to, empty } = editor.state.selection;
          let textSelected = false,
            atomSelected = false;
          if (!empty)
            editor.state.doc.nodesBetween(from, to, (node) => {
              if (node.isText && node.textContent.trim()) textSelected = true;
              if (node.isInline && !node.isText) atomSelected = true;
            });
          if (url && !formatted && !empty && textSelected && !atomSelected) {
            const transaction = editor.state.tr.addMark(
              from,
              to,
              editor.state.schema.marks.link.create({ href: url }),
            );
            transaction.setSelection(TextSelection.create(transaction.doc, to));
            editor.dispatch(transaction.scrollIntoView());
            return true;
          }
          if (url === text && !formatted) {
            const restored = parsePromptText(serializePromptLink(text, text))
              .content[0]?.content?.[0];
            const sourceAppId =
              restored?.marks?.find((mark) => mark.type === "link")?.attrs
                ?.sourceAppId ?? "";
            if (empty || sourceAppId !== "") {
              editor.dispatch(
                editor.state.tr
                  .replaceSelectionWith(
                    editor.state.schema.nodes.richLink.create({
                      displayText: text,
                      href: text,
                      sourceAppId,
                    }),
                    false,
                  )
                  .setStoredMarks([])
                  .scrollIntoView(),
              );
              return true;
            }
          }
          if (rich) {
            if (parsedHTML && !pasteInCodeContext(editor.state)) {
              const slice = parsedHTML.preferredSlice;
              if (
                text.length > 0 &&
                (!parsedHTML.cleanedHTML.trim() ||
                  (!parsedHTML.didNormalizeMedia && !parsedHTML.structured))
              ) {
                const decoded = decodeLiteralClipboardText(text);
                if (
                  decoded ===
                  slice.content.textBetween(0, slice.content.size, "\n", "\n")
                ) {
                  literalPaste(decoded);
                  return true;
                }
              } else if (slice.content.size > 0) {
                if (excessive) literalPaste(text || visible);
                else editor.dispatch(replaceRichPaste(editor.state, slice));
                return true;
              }
            }
            literalPaste(text);
            return true;
          }
          const normalized = (value: string) =>
            value.replace(/\s+/g, " ").trim();
          if (
            parsedHTML &&
            !excessive &&
            (normalized(visible) === normalized(text) ||
              (text.length < 5000 && visible !== "" && parsedHTML.structured))
          ) {
            editor.dispatch(
              editor.state.tr
                .replaceSelection(parsedHTML.slice)
                .scrollIntoView(),
            );
            return true;
          }
          if (text)
            editor.dispatch(
              editor.state.tr
                .replaceSelection(plainSlice(text, editor))
                .scrollIntoView(),
            );
          return true;
        },
        clipboardTextSerializer(content): string {
          let fragment = content.content;
          for (
            let level = 1;
            level < Math.min(content.openStart, content.openEnd);
            level++
          ) {
            if (fragment.childCount !== 1 || !fragment.firstChild) break;
            fragment = fragment.firstChild.content;
          }
          if (fragment.childCount !== 1 || !fragment.firstChild?.isTextblock)
            fragment = content.content;
          if (
            content.openStart > 0 &&
            fragment.childCount === 1 &&
            fragment.firstChild?.type.name === "code_block"
          )
            return fragment.firstChild.textContent;
          const children: ProseMirrorNode[] = [];
          fragment.forEach((node) => children.push(node));
          if (children.some((node) => node.isInline))
            return outputText(
              editor.state.schema.node(
                "doc",
                null,
                editor.state.schema.node("paragraph", null, children),
              ),
              true,
            );
          return outputText(
            editor.state.schema.node(
              "doc",
              null,
              children.length
                ? children
                : editor.state.schema.node("paragraph"),
            ),
            true,
          );
        },
        handleDOMEvents: {
          keydown: (editor, event) => {
            if (
              !event.isComposing &&
              !editor.composing &&
              event.keyCode !== 229 &&
              performance.now() - compositionEndedAt.current >= 100
            )
              syncDOMTextSelection(editor);
            // Android Chrome's ProseMirror input handler leaves Enter to beforeinput.
            // Modified Enter from a hardware keyboard still needs the Web shortcuts.
            if (
              /Android/.test(navigator.userAgent) &&
              event.key === "Enter" &&
              (event.shiftKey ||
                event.altKey ||
                event.metaKey ||
                event.ctrlKey) &&
              !event.isComposing &&
              !editor.composing &&
              event.keyCode !== 229
            ) {
              const handled = editor.someProp("handleKeyDown", (handler) =>
                handler(editor, event),
              );
              if (handled) event.preventDefault();
              return !!handled;
            }
            return false;
          },
          mousedown: (_editor, event) => {
            plainPaste.current = event.shiftKey;
            return false;
          },
          compositionstart: () => {
            latest.current.onCompositionStart?.();
            return false;
          },
          compositionend: () => {
            compositionEndedAt.current = performance.now();
            latest.current.onCompositionEnd?.();
            return false;
          },
          drop: (_editor, event) => {
            if (
              event.dataTransfer?.files.length ||
              latest.current.disabled ||
              latest.current.readOnly
            ) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        },
        dispatchTransaction(transaction) {
          if (
            transaction.docChanged &&
            (latest.current.disabled || latest.current.readOnly)
          )
            return;
          editor.updateState(editor.state.apply(transaction));
          if (transaction.docChanged) {
            const text = persistedText(editor.state.doc);
            checkHistorySelection(editor.state.doc);
            saveDocument(editor.state.doc, text);
            emitted.current = text;
            latest.current.onPlainTextChange?.(submittedText(editor.state.doc));
            latest.current.onChange(text);
          }
        },
      });
      view.current = editor;
      latest.current.onPlainTextChange?.(submittedText(editor.state.doc));
      checkHistorySelection(editor.state.doc);
      if (latest.current.autoFocus) {
        editor.dispatch(
          editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)),
        );
        editor.focus();
      }
      return () => {
        view.current = null;
        editor.destroy();
      };
    }, []);

    useLayoutEffect(() => {
      const editor = view.current;
      if (!editor) return;
      if (
        props.value !== emitted.current ||
        props.initialDocument !== initialDocument.current
      ) {
        initialDocument.current = props.initialDocument;
        emitted.current = props.value;
        const doc = parseValue(props.value);
        if (!doc.eq(editor.state.doc))
          editor.updateState(
            EditorState.create({
              doc,
              schema: editor.state.schema,
              selection: TextSelection.atEnd(doc),
              plugins: editor.state.plugins,
            }),
          );
      }
      latest.current.onPlainTextChange?.(submittedText(editor.state.doc));
      checkHistorySelection(editor.state.doc);
      editor.setProps({
        editable: () => !latest.current.disabled && !latest.current.readOnly,
      });
    }, [
      props.value,
      props.disabled,
      props.readOnly,
      props.label,
      props.placeholder,
      props.invalid,
      props.describedBy,
      props.initialDocument,
      props.richText,
    ]);

    useLayoutEffect(() => {
      historySelection.current = null;
      closeLink(false);
    }, [props.promptHistory?.server, props.promptHistory?.scope]);

    useLayoutEffect(() => {
      if (props.disabled || props.readOnly) closeLink(false);
    }, [props.disabled, props.readOnly]);

    return (
      <>
        <div
          className="prompt-editor-mount"
          ref={mount}
          // Cancel both default phases: Linux primary-selection paste can run
          // on mouseup, before auxclick opens the conversation in a new tab.
          onMouseDownCapture={preventThreadMiddlePaste}
          onMouseUpCapture={preventThreadMiddlePaste}
          onClickCapture={(event) => {
            openLink(event.nativeEvent);
          }}
          onAuxClickCapture={(event) => {
            if (event.button === 1) openLink(event.nativeEvent);
          }}
          onKeyDownCapture={(event) => {
            if (
              (event.key === "Enter" || event.key === " ") &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229 &&
              performance.now() - compositionEndedAt.current >= 100
            )
              openLink(event.nativeEvent);
          }}
        />
        {linkTarget && (
          <PromptLinkPopover
            key={linkTarget.href + linkTarget.displayText}
            target={linkTarget}
            onClose={closeLink}
            onSave={saveLink}
          />
        )}
      </>
    );
  },
);

export default PromptEditor;
