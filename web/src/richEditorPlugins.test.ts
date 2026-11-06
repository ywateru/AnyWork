import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "prosemirror-model";
import {
  EditorState,
  TextSelection,
  type Command,
  type Transaction,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { history, undo } from "prosemirror-history";
import { splitBlock } from "prosemirror-commands";
import { createRichPromptSchema } from "./richPrompt";
import { promptAtomAttributes, promptLinkAttributes } from "./promptText";
import {
  richAltNewline,
  richEditorPlugins,
  richInputKeymap,
  richListNewline,
  richShiftNewline,
  richTab,
  richTypedTable,
  richCodeArrow,
} from "./richEditorPlugins";

const base = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      attrs: {
        language: { default: null },
        autoDetectLanguage: { default: true },
      },
    },
    ...Object.fromEntries(
      Object.entries(promptAtomAttributes).map(([name, attrs]) => [
        name,
        { attrs, inline: true, group: "inline" },
      ]),
    ),
  },
  marks: { link: { attrs: promptLinkAttributes, inclusive: false } },
});
const schema = createRichPromptSchema(base);
const p = (text = "") =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
const code = (text: string) =>
  schema.nodes.code_block.create(null, text ? schema.text(text) : null);
const regular = (...children: PMNode[]) =>
  schema.nodes.regular_list_item.create(null, children);
const task = (checked: boolean, ...children: PMNode[]) =>
  schema.nodes.task_list_item.create({ checked }, children);
const list = (...children: PMNode[]) =>
  schema.nodes.list.create(null, children);
const doc = (...children: PMNode[]) => schema.nodes.doc.create(null, children);
function harness(
  document: PMNode,
  position = document.content.size - 1,
  end = position,
) {
  let state = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, position, end),
    plugins: [history(), ...richEditorPlugins(schema)],
  });
  const view = {
    get state() {
      return state;
    },
    composing: false,
    editable: true,
    dispatch(transaction: Transaction) {
      state = state.applyTransaction(transaction).state;
    },
  } as unknown as EditorView;
  return {
    view,
    get state() {
      return state;
    },
    command(command: Command) {
      return command(state, view.dispatch, view);
    },
    type(value: string) {
      for (const plugin of state.plugins) {
        if (
          plugin.props.handleTextInput?.call(
            plugin,
            view,
            state.selection.from,
            state.selection.to,
            value,
            () => state.tr.insertText(value),
          )
        )
          return true;
      }
      view.dispatch(state.tr.insertText(value));
      return false;
    },
    key(key: string, shiftKey = false) {
      let prevented = false;
      const event = {
        key,
        shiftKey,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        get defaultPrevented() {
          return prevented;
        },
        preventDefault() {
          prevented = true;
        },
      } as KeyboardEvent;
      const handled = state.plugins.some((plugin) =>
        plugin.props.handleKeyDown?.call(plugin, view, event),
      );
      return { handled, prevented };
    },
  };
}
function nodes(document: PMNode, name: string) {
  const result: PMNode[] = [];
  document.descendants((node) => {
    if (node.type.name === name) result.push(node);
  });
  return result;
}
function textPosition(document: PMNode, text: string) {
  let position = -1;
  document.descendants((node, pos) => {
    if (node.isText && node.text === text) position = pos;
  });
  if (position < 0) throw new Error(text);
  return position;
}

describe("native rich Markdown input", () => {
  it("converts heading/quote/list prefixes and ordered starts without reparsing other blocks", () => {
    const heading = harness(doc(p("##")));
    heading.type(" ");
    expect(heading.state.doc.firstChild?.attrs.level).toBe(2);
    const quote = harness(doc(p(">")));
    quote.type(" ");
    expect(quote.state.doc.firstChild?.type.name).toBe("blockquote");
    const bullets = harness(doc(p("-")));
    bullets.type(" ");
    expect(bullets.state.doc.firstChild?.type.name).toBe("list");
    const ordered = harness(doc(p("13.")));
    ordered.type(" ");
    expect(ordered.state.doc.firstChild?.attrs.startingNumber).toBe(13);
    const checked = harness(doc(p("[X]")));
    checked.type(" ");
    expect(nodes(checked.state.doc, "task_list_item")[0].attrs.checked).toBe(
      true,
    );
    const unchecked = harness(doc(p("[]")));
    unchecked.type(" ");
    expect(nodes(unchecked.state.doc, "task_list_item")[0].attrs.checked).toBe(
      false,
    );
  });
  it("joins ordered lists only when their numbering is contiguous", () => {
    const ordered = schema.nodes.ordered_list.create(
      { startingNumber: 3 },
      regular(p("third")),
    );
    const contiguous = harness(doc(ordered, p("4.")));
    contiguous.type(" ");
    expect(contiguous.state.doc.childCount).toBe(1);
    expect(contiguous.state.doc.firstChild?.childCount).toBe(2);
    const separate = harness(doc(ordered, p("8.")));
    separate.type(" ");
    expect(separate.state.doc.childCount).toBe(2);
    expect(separate.state.doc.lastChild?.attrs.startingNumber).toBe(8);
  });
  it("marks authored spans only after a trailing character and keeps it outside the mark", () => {
    const strong = harness(doc(p("**bold**")));
    strong.type(" ");
    expect(strong.state.doc.textContent).toBe("bold ");
    expect(
      strong.state.doc.firstChild?.firstChild?.marks.some(
        (mark) => mark.type.name === "strong",
      ),
    ).toBe(true);
    expect(
      strong.state.doc.firstChild?.lastChild?.marks.some(
        (mark) => mark.type.name === "strong",
      ),
    ).toBe(false);
    const strike = harness(doc(p("~old~")));
    strike.type(" ");
    expect(
      strike.state.doc.firstChild?.firstChild?.marks.some(
        (mark) => mark.type.name === "strikethrough",
      ),
    ).toBe(true);
    const emphasis = harness(doc(p("_em_")));
    emphasis.type(".");
    expect(emphasis.state.doc.textContent).toBe("em.");
    expect(
      emphasis.state.doc.firstChild?.firstChild?.marks.some(
        (mark) => mark.type.name === "em",
      ),
    ).toBe(true);
  });
  it("requires the native inline-code boundary and protects existing code-marked text", () => {
    const inline = harness(doc(p("`code")));
    inline.type("`");
    expect(inline.state.doc.textContent).toBe("code");
    expect(inline.state.doc.firstChild?.firstChild?.marks[0].type.name).toBe(
      "code",
    );
    const noBoundary = harness(doc(p("word`literal")));
    noBoundary.type("`");
    expect(noBoundary.state.doc.textContent).toBe("word`literal`");
    const prefix = harness(doc(p("word `code")));
    prefix.type("`");
    expect(prefix.state.doc.textContent).toBe("word code");
    const escaped = harness(doc(p("\\**literal**")));
    escaped.type(" ");
    expect(escaped.state.doc.textContent).toBe("\\**literal** ");
    const marked = harness(
      doc(
        schema.nodes.paragraph.create(
          null,
          schema.text("**literal**", [schema.marks.code.create()]),
        ),
      ),
    );
    marked.type(" ");
    expect(marked.state.doc.textContent).toBe("**literal** ");
  });
  it("opens fences in empty paragraphs and after existing top-level text", () => {
    const start = harness(doc(p("``")));
    start.type("`");
    expect(start.state.doc.firstChild?.type.name).toBe("code_block");
    const suffix = harness(doc(p("Intro ``")));
    suffix.type("`");
    expect(suffix.state.doc.childCount).toBe(2);
    expect(suffix.state.doc.firstChild?.textContent).toBe("Intro ");
    expect(suffix.state.selection.$from.parent.type.name).toBe("code_block");
    const nested = harness(doc(list(regular(p("Intro ``")))), 13);
    nested.type("`");
    expect(nodes(nested.state.doc, "code_block")).toHaveLength(0);
  });
  it("closes a fence only when three backticks occupy the last code line", () => {
    const closing = harness(doc(code("value\n``")));
    closing.type("`");
    expect(closing.state.doc.firstChild?.textContent).toBe("value");
    expect(closing.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(closing.state.selection.$from.parent.type.name).toBe("paragraph");
    const ordinary = harness(doc(code("value``")));
    ordinary.type("`");
    expect(ordinary.state.doc.childCount).toBe(1);
    expect(ordinary.state.doc.textContent).toBe("value```");
  });
  it("turns a typed newline or paragraph split after --- into a divider", () => {
    const typed = harness(doc(p("---")));
    typed.type("\n");
    expect(typed.state.doc.firstChild?.type.name).toBe("horizontal_rule");
    expect(typed.state.doc.lastChild?.type.name).toBe("paragraph");
    const enter = harness(doc(p("---")));
    enter.command(splitBlock);
    expect(enter.state.doc.firstChild?.type.name).toBe("horizontal_rule");
  });
  it("keeps an input transformation separate from earlier editing in undo history", () => {
    const editor = harness(doc(p("**bold**")));
    editor.type(" ");
    expect(editor.command(undo)).toBe(true);
    expect(editor.state.doc.textContent).toBe("**bold**");
  });
});

describe("native rich keyboard commands", () => {
  it("resets checked only on Enter's task path, preserving text marks", () => {
    const marked = schema.nodes.paragraph.create(
      null,
      schema.text("done", [schema.marks.strong.create()]),
    );
    const document = doc(list(task(true, marked))),
      end = textPosition(document, "done") + 4;
    const enter = harness(document, end);
    enter.command(richListNewline);
    expect(
      nodes(enter.state.doc, "task_list_item").map(
        (node) => node.attrs.checked,
      ),
    ).toEqual([true, false]);
    expect(
      enter.state.storedMarks?.some((mark) => mark.type.name === "strong"),
    ).toBe(true);
    const shift = harness(document, end);
    shift.command(richShiftNewline(false));
    expect(
      nodes(shift.state.doc, "task_list_item").map(
        (node) => node.attrs.checked,
      ),
    ).toEqual([true, true]);
    const alt = harness(document, end);
    expect(alt.command(richAltNewline)).toBe(false);
  });
  it("uses different regular-list Shift/Alt paths in desktop and newline modes", () => {
    const document = doc(list(regular(p("one")))),
      position = textPosition(document, "one") + 3;
    expect(harness(document, position).command(richShiftNewline(false))).toBe(
      false,
    );
    const desktop = harness(document, position);
    expect(desktop.command(richShiftNewline(true))).toBe(true);
    expect(nodes(desktop.state.doc, "regular_list_item")).toHaveLength(2);
    expect(harness(document, position).command(richAltNewline)).toBe(true);
  });
  it("indents code with real tabs and excludes the selected terminal LF's next line", () => {
    const editor = harness(doc(code("one\ntwo\nthree")), 1, 9);
    editor.command(richTab(false));
    expect(editor.state.doc.textContent).toBe("\tone\n\ttwo\nthree");
    const outdent = harness(doc(code("\tone\n  two\n    three")), 1, 21);
    outdent.command(richTab(true));
    expect(outdent.state.doc.textContent).toBe("one\ntwo\nthree");
    const unchanged = harness(doc(code("code")));
    expect(unchanged.command(richTab(true))).toBe(true);
    expect(unchanged.state.doc.textContent).toBe("code");
  });
  it("moves between code line ends and creates a following paragraph on ArrowDown", () => {
    const editor = harness(doc(code("one\ntwo")), 4);
    expect(editor.command(richCodeArrow(1))).toBe(true);
    expect(editor.state.selection.from).toBe(8);
    editor.command(richCodeArrow(-1));
    expect(editor.state.selection.from).toBe(4);
    editor.command(richCodeArrow(1));
    editor.command(richCodeArrow(1));
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
  });
  it("gives the earlier list Tab plugin priority for code nested inside a list item", () => {
    const document = doc(
      list(regular(p("first")), task(false, p(), code("nested"))),
    );
    const editor = harness(document, textPosition(document, "nested") + 6);
    expect(editor.key("Tab")).toEqual({ handled: true, prevented: true });
    expect(editor.state.doc.textContent).toBe("firstnested");
    expect(nodes(editor.state.doc, "list")).toHaveLength(2);
    expect(nodes(editor.state.doc, "code_block")[0].textContent).toBe("nested");
    const outdent = editor.key("Tab", true);
    expect(outdent.handled).toBe(true);
    expect(nodes(editor.state.doc, "list")).toHaveLength(1);
  });
  it("consumes Tab on the first list item even when it cannot sink", () => {
    const document = doc(list(regular(p("first"))));
    const editor = harness(document, textPosition(document, "first") + 5);
    expect(editor.key("Tab")).toEqual({ handled: true, prevented: true });
    expect(editor.state.doc.eq(document)).toBe(true);
  });
  it("cycles heading levels with Tab, including paragraph on level zero", () => {
    const heading = schema.nodes.heading.create(
      { level: 1 },
      schema.text("title"),
    );
    const editor = harness(doc(heading));
    editor.command(richTab(false));
    expect(editor.state.doc.firstChild?.attrs.level).toBe(2);
    editor.command(richTab(true));
    editor.command(richTab(true));
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    const maximum = harness(
      doc(schema.nodes.heading.create({ level: 6 }, schema.text("title"))),
    );
    expect(maximum.command(richTab(false))).toBe(false);
  });
  it("toggles matching list style, converts task items, and flattens list content for Alt headings", () => {
    const bindings = richInputKeymap(schema);
    const document = doc(list(regular(p("item"))));
    const toggle = harness(document, textPosition(document, "item") + 4);
    toggle.command(bindings["Alt-Mod-5"]);
    expect(toggle.state.doc.firstChild?.type.name).toBe("paragraph");
    const checked = doc(list(task(true, p("done"))));
    const converted = harness(checked, textPosition(checked, "done") + 4);
    converted.command(bindings["Alt-Mod-5"]);
    expect(nodes(converted.state.doc, "task_list_item")).toHaveLength(0);
    expect(nodes(converted.state.doc, "regular_list_item")).toHaveLength(1);
    const heading = harness(document, textPosition(document, "item") + 4);
    heading.command(bindings["Alt-Mod-2"]);
    expect(heading.state.doc.firstChild?.type.name).toBe("heading");
    expect(heading.state.doc.firstChild?.attrs.level).toBe(2);
  });
  it("builds an inline-cell table from three typed pipe rows before Enter can submit", () => {
    const document = doc(
      p("| first | second |"),
      p("| :--- | ---: |"),
      p("| a\\|b | last |"),
    );
    const editor = harness(document);
    expect(editor.command(richTypedTable)).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("table");
    expect(
      nodes(editor.state.doc, "table_cell").map((cell) => [
        cell.textContent,
        cell.attrs.rowIndex,
        cell.attrs.align,
      ]),
    ).toEqual([
      ["first", 0, "left"],
      ["second", 0, "right"],
      ["a|b", 1, "left"],
      ["last", 1, "right"],
    ]);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    const malformed = harness(
      doc(p("| a | b |"), p("| -- | --- |"), p("| c | d |")),
    );
    expect(malformed.command(richTypedTable)).toBe(false);
  });
  it("provides native mark, list and heading shortcut bindings without overriding submission", () => {
    const bindings = richInputKeymap(schema);
    expect(bindings["Mod-Enter"]).toBeUndefined();
    expect(bindings["Shift-Enter"]).toBeUndefined();
    const editor = harness(doc(p("title")));
    editor.command(bindings["Shift-Mod-3"]);
    expect(editor.state.doc.firstChild?.attrs.level).toBe(3);
    expect(bindings).toHaveProperty("Alt-Mod-4");
    expect(bindings).toHaveProperty("Ctrl-`");
  });
});
