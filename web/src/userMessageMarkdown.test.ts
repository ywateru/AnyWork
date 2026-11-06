import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Link, RootContent } from "mdast";
import { describe, expect, it } from "vitest";
import type { Api } from "./api";
import Markdown from "./components/Markdown";
import {
  composerLinkExtensions,
  firstAuthoredLink,
  normalizeUserMessageMarkdown,
  unescapeAuthoredLabel,
  unescapeAuthoredPath,
} from "./userMessageMarkdown";

function parse(value: string) {
  const { syntax, mdast } = composerLinkExtensions();
  return fromMarkdown(value, {
    extensions: [syntax],
    mdastExtensions: [mdast],
  });
}

function nodes(
  value: { children?: readonly unknown[]; type?: string },
  type: string,
): any[] {
  return [
    ...(value.type === type ? [value] : []),
    ...(value.children || []).flatMap((child) =>
      nodes(child as RootContent, type),
    ),
  ];
}

function render(text: string, variant: "user" | "assistant" = "user") {
  return renderToStaticMarkup(
    createElement(Markdown, {
      text,
      variant,
      api: {} as Api,
      sessionId: "links",
      cwd: "/work",
      onOpenFile() {},
    }),
  );
}

describe("native composer-authored links", () => {
  it("scans same-line nonempty authored labels and paths with literal spaces", () => {
    expect(firstAuthoredLink("prefix [file name](/tmp/a b.md) suffix")).toEqual(
      {
        start: 7,
        end: 31,
        label: "file name",
        path: "/tmp/a b.md",
      },
    );
    const links = nodes(
      parse("open [file name](/tmp/a b.md) now"),
      "link",
    ) as Link[];
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("/tmp/a b.md");
    expect(links[0].children).toMatchObject([
      { type: "text", value: "file name" },
    ]);
  });

  it("uses the native first-unescaped closing parenthesis and exact punctuation unescape", () => {
    const value = "[a\\[b\\]c](/tmp/a\\(b\\)\\!\\+\\ x)";
    const link = nodes(parse(value), "link")[0] as Link;
    expect(link.url).toBe("/tmp/a(b)!+\\ x");
    expect(link.children).toMatchObject([{ type: "text", value: "a[b]c" }]);
    expect(firstAuthoredLink("[label](a(b)c)")?.path).toBe("a(b");
    expect(unescapeAuthoredLabel("a\\!\\[b\\]\\(c\\)\\\\")).toBe(
      "a\\![b](c)\\",
    );
    expect(unescapeAuthoredPath("a\\!\\[b\\]\\(c\\)\\\\\\ x")).toBe(
      "a![b](c)\\\\ x",
    );
  });

  it("retains standard nonempty titles and treats empty titles as native authored input", () => {
    for (const title of [
      "standard title",
      "another title",
      "first line\nsecond line",
    ]) {
      const link = nodes(
        parse(`[label](https://example.com/a(b) "${title}")`),
        "link",
      )[0] as Link;
      expect(link.url).toBe("https://example.com/a(b)");
      expect(link.title).toBe(title);
    }
    const emptyTitle = nodes(
      parse('[label](https://example.com/a(b) "")'),
      "link",
    )[0] as Link;
    expect(emptyTitle.url).toBe("https://example.com/a(b");
    expect(emptyTitle.title).toBeNull();
  });

  it("leaves escaped brackets, inline/fenced code, images and references to the base parser", () => {
    const source =
      "\\[escaped](/tmp/a b)\n`[code](/tmp/a b)`\n![image](https://example.com/i.png)\n[reference][id]\n\n[id]: https://example.com/reference\n\n```txt\n[fenced](/tmp/a b)\n```";
    const tree = parse(source);
    expect(nodes(tree, "link")).toHaveLength(0);
    expect(nodes(tree, "image")).toHaveLength(1);
    expect(nodes(tree, "linkReference")).toHaveLength(1);
    expect(nodes(tree, "inlineCode")[0].value).toBe("[code](/tmp/a b)");
    expect(nodes(tree, "code")[0].value).toBe("[fenced](/tmp/a b)");
  });

  it("does not manufacture nested links inside a titled standard link", () => {
    const tree = parse(
      '[outer [inner](/tmp/a b)](https://example.com/outer "title")',
    );
    const links = nodes(tree, "link") as Link[];
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://example.com/outer");
    expect(nodes(links[0], "link")).toHaveLength(1);
    expect(links[0].children).toMatchObject([
      { type: "text", value: "outer [inner](/tmp/a b)" },
    ]);
  });

  it("preserves an unfinished link as a literal line without consuming the next line", () => {
    const tree = parse(
      "[unfinished](path **literal stars**\nnext **bold** [valid](/tmp/a b)",
    );
    expect(nodes(tree, "text")[0].value).toContain(
      "[unfinished](path **literal stars**",
    );
    expect(nodes(tree, "strong")).toHaveLength(1);
    expect(nodes(tree, "strong")[0].children[0].value).toBe("bold");
    expect(nodes(tree, "link")).toHaveLength(1);
    expect(nodes(tree, "link")[0].url).toBe("/tmp/a b");
  });

  it("does not cross LF or CRLF boundaries and rejects empty labels and paths", () => {
    for (const source of [
      "[a\nb](path)",
      "[a](pa\r\nth)",
      "[a](path\\\nnext)",
      "[](path)",
      "[label]()",
    ])
      expect(firstAuthoredLink(source)).toBeNull();
    const source = "[bad\n[good](path)";
    expect(firstAuthoredLink(source)).toMatchObject({
      start: 5,
      label: "good",
      path: "path",
    });
  });

  it("retains the colon image prefix without turning images into authored links", () => {
    const tree = parse(
      ":[file](/tmp/a b) ![image](https://example.com/image.png)",
    );
    expect(nodes(tree, "text")[0].value).toBe(":");
    expect(nodes(tree, "link")).toHaveLength(1);
    expect(nodes(tree, "image")).toHaveLength(1);
    expect(nodes(parse("![incomplete](/tmp/a b)"), "link")).toHaveLength(0);
  });

  it("normalizes the exact codex-text-link prefix source-wide for user messages only", () => {
    const source =
      "[file](codex-text-link:///tmp/a b.md) `[code](codex-text-link:///tmp/code)`";
    expect(normalizeUserMessageMarkdown(source)).toBe(
      "[file](/tmp/a b.md) `[code](/tmp/code)`",
    );
    const user = render(source);
    expect(user).toContain('href="/tmp/a%20b.md"');
    expect(user).toContain("[code](/tmp/code)");
    const assistant = render(source, "assistant");
    expect(assistant).not.toContain('href="/tmp/a%20b.md"');
    expect(assistant).toContain("[code](codex-text-link:///tmp/code)");
  });

  it("preserves formatted labels without GFM rebuilding a link inside them", () => {
    const html = render("[www.example.com **bold** ~~gone~~](/tmp/a b.md)");
    expect(html.match(/<a\b/g) || []).toHaveLength(1);
    expect(html).toContain(
      "www.example.com <strong>bold</strong> <del>gone</del>",
    );
    expect(
      render('[**nested [brackets]**](https://example.com "title")'),
    ).toContain("<strong>nested [brackets]</strong>");
  });
});
