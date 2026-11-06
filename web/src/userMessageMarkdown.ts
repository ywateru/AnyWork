import {
  fromMarkdown,
  type Extension as MdastExtension,
  type Options,
} from "mdast-util-from-markdown";
import type { Link, PhrasingContent, Root, Text } from "mdast";
import type {
  Code,
  Effects,
  Extension,
  State,
  TokenizeContext,
} from "micromark-util-types";
import type { Plugin } from "unified";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    anyworkComposerProbe: "anyworkComposerProbe";
    anyworkComposerLink: "anyworkComposerLink";
    anyworkComposerLiteral: "anyworkComposerLiteral";
  }
}

export interface AuthoredLink {
  start: number;
  end: number;
  label: string;
  path: string;
}

/** The original Han scanner: authored paths stop at their first unescaped `)`. */
export function firstAuthoredLink(text: string, from = 0): AuthoredLink | null {
  let cursor = from;
  scan: while (cursor < text.length) {
    const start = text.indexOf("[", cursor);
    if (start === -1) return null;
    let labelEnd = start + 1;
    while (labelEnd < text.length) {
      const character = text[labelEnd],
        next = text[labelEnd + 1];
      if (character === "\n" || character === "\r") {
        cursor = labelEnd + 1;
        continue scan;
      }
      if (
        character === "\\" &&
        (next === "\\" || (next === "]" && text[labelEnd + 2] !== "("))
      )
        labelEnd += 2;
      else if (character === "]") break;
      else labelEnd++;
    }
    if (labelEnd >= text.length) return null;
    if (labelEnd === start + 1 || text[labelEnd + 1] !== "(") {
      cursor = labelEnd + 1;
      continue;
    }
    let pathEnd = labelEnd + 2;
    while (pathEnd < text.length) {
      const character = text[pathEnd],
        next = text[pathEnd + 1];
      if (character === "\n" || character === "\r") {
        cursor = pathEnd + 1;
        continue scan;
      }
      if (character === "\\" && (next === "\n" || next === "\r")) {
        cursor = pathEnd + 2;
        continue scan;
      }
      if (character === "\\" && next != null) pathEnd += 2;
      else if (character === ")") {
        if (pathEnd === labelEnd + 2) {
          cursor = pathEnd + 1;
          continue scan;
        }
        return {
          start,
          end: pathEnd + 1,
          label: text.slice(start + 1, labelEnd),
          path: text.slice(labelEnd + 2, pathEnd),
        };
      } else pathEnd++;
    }
    return null;
  }
  return null;
}

export function unescapeAuthoredLabel(label: string) {
  return label.replace(/\\([\\[\]()])/g, "$1");
}

export function unescapeAuthoredPath(path: string) {
  return path.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

/** This normalization is deliberately source-wide, as in the shipped AA/bNn. */
export function normalizeUserMessageMarkdown(text: string) {
  return text.replaceAll("](codex-text-link://", "](");
}

const noNestedLinks: Extension = {
  disable: {
    null: [
      "labelStartLink",
      "labelStartImage",
      "labelEnd",
      "autolink",
      "wwwAutolink",
      "protocolAutolink",
      "emailAutolink",
    ],
  },
};

export function composerLinkExtensions(labelOptions: Options = {}) {
  const syntax: Extension = {
    text: {
      91: { name: "anyworkComposerLink", tokenize },
    },
  };
  const mdast: MdastExtension = {
    enter: {
      anyworkComposerLink(token) {
        const found = firstAuthoredLink(this.sliceSerialize(token));
        if (!found) return;
        const parsed = fromMarkdown(found.label, {
          ...labelOptions,
          extensions: [...(labelOptions.extensions || []), noNestedLinks],
        });
        const paragraph = parsed.children[0];
        const children: PhrasingContent[] =
          paragraph?.type === "paragraph"
            ? withoutNestedLinks(paragraph.children)
            : [{ type: "text", value: unescapeAuthoredLabel(found.label) }];
        // No block structure or nested link is allowed inside an authored label.
        const node: Link = {
          type: "link",
          url: unescapeAuthoredPath(found.path),
          title: null,
          children,
        };
        this.enter(node, token);
      },
      anyworkComposerLiteral(token) {
        const node: Text = { type: "text", value: this.sliceSerialize(token) };
        this.enter(node, token);
      },
    },
    exit: {
      anyworkComposerLink(token) {
        this.exit(token);
      },
      anyworkComposerLiteral(token) {
        this.exit(token);
      },
    },
  };
  return { syntax, mdast };

  function tokenize(
    this: TokenizeContext,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    const context = this;
    let source = "",
      end = 0;
    let kind: "anyworkComposerLink" | "anyworkComposerLiteral";
    return start;

    function start(code: Code): State | undefined {
      // The common Markdown parser owns escaped brackets, code and image spans.
      // Its active label stack also prevents links from being generated in links.
      if (
        code !== 91 ||
        context.previous === 33 ||
        context._labelStarts?.some(
          (token) => !token._inactive && !token._balanced,
        )
      )
        return nok(code);
      return effects.check(
        { partial: true, tokenize: probe },
        decide,
        nok,
      )(code);
    }

    function probe(this: TokenizeContext, look: Effects, yes: State): State {
      const probeContext = this;
      look.enter("anyworkComposerProbe");
      return collect;
      function collect(code: Code): State | undefined {
        if (code === null) {
          const token = look.exit("anyworkComposerProbe");
          source = probeContext.sliceSerialize(token);
          return yes(code);
        }
        look.consume(code);
        return collect;
      }
    }

    function decide(code: Code): State | undefined {
      // Titles can span lines in the base grammar. The inexpensive hint avoids
      // parsing the remaining paragraph on every ordinary authored path.
      const first = /[ \t\r\n]["'(]/.test(source)
        ? fromMarkdown(source).children[0]
        : undefined;
      const standard =
        first?.type === "paragraph" ? first.children[0] : undefined;
      // Native composerLink defers standard links with titles to the base parser.
      if (
        standard?.type === "link" &&
        standard.title != null &&
        standard.position?.start.offset === 0
      )
        return nok(code);
      const line = source.split(/\r\n|\r|\n/, 1)[0];
      const found = firstAuthoredLink(line);
      if (found?.start === 0) {
        kind = "anyworkComposerLink";
        end = context.now().offset + found.end;
      } else if (line.includes("](")) {
        // Incomplete authored input remains one literal line. Never eat its newline.
        kind = "anyworkComposerLiteral";
        end = context.now().offset + line.length;
      } else return nok(code);
      effects.enter(kind);
      return consume(code);
    }

    function consume(code: Code): State | undefined {
      if (context.now().offset >= end || code === null || lineEnding(code)) {
        effects.exit(kind);
        return ok(code);
      }
      effects.consume(code);
      return consume;
    }
  }
}

function lineEnding(code: Code) {
  return code === -3 || code === -4 || code === -5;
}

function withoutNestedLinks(nodes: PhrasingContent[]): PhrasingContent[] {
  return nodes.flatMap((node): PhrasingContent[] => {
    if (node.type === "link" || node.type === "linkReference")
      return withoutNestedLinks(node.children);
    if ("children" in node)
      return [{ ...node, children: withoutNestedLinks(node.children) }];
    return [node];
  });
}

export const remarkUserMessageLinks: Plugin<[], Root> = function () {
  const data = this.data() as {
    micromarkExtensions?: Extension[];
    fromMarkdownExtensions?: MdastExtension[];
  };
  const { syntax, mdast } = composerLinkExtensions({
    extensions: [...(data.micromarkExtensions || [])],
    mdastExtensions: [...(data.fromMarkdownExtensions || [])],
  });
  (data.micromarkExtensions ||= []).push(syntax);
  (data.fromMarkdownExtensions ||= []).push(mdast);
};
