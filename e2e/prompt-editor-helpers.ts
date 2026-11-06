import { expect, type Locator } from "@playwright/test";

// Read the rendered document rather than a textarea property or a mirrored value.
// Paragraph boundaries are real newlines; ProseMirror's caret-only trailing br is not.
export async function readPromptText(editor: Locator) {
  return editor.evaluate((element) => {
    const text = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
      // Static SVG artwork can contain indentation text; it is decorative.
      if (
        node instanceof HTMLElement &&
        node.getAttribute("aria-hidden") === "true" &&
        node.classList.contains("prompt-inline-atom-icon")
      )
        return "";
      if (node instanceof HTMLBRElement)
        return node.classList.contains("ProseMirror-trailingBreak") ? "" : "\n";
      return Array.from(node.childNodes).map(text).join("");
    };
    return Array.from(element.childNodes).map(text).join("\n");
  });
}

export async function expectPromptText(editor: Locator, expected: string) {
  await expect.poll(() => readPromptText(editor)).toBe(expected);
}

// Clear through the editor's keyboard path, then use ordinary plain paste.
// CDP fill can bypass the document transaction while its DOM observer is pending.
export async function fillPromptText(editor: Locator, text: string) {
  await expect(editor).toBeEditable();
  await editor.focus();
  if (await readPromptText(editor)) {
    await editor.press("ControlOrMeta+A");
    await expect
      .poll(() =>
        editor.evaluate((element) => {
          const selection = getSelection();
          if (
            !selection?.rangeCount ||
            selection.isCollapsed ||
            !element.contains(selection.anchorNode) ||
            !element.contains(selection.focusNode)
          )
            return false;
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
          );
          let first: Node | null = null,
            last: Node | null = null;
          while (walker.nextNode()) {
            first ??= walker.currentNode;
            last = walker.currentNode;
          }
          if (!first || !last) return false;
          const range = selection.getRangeAt(0);
          return (
            range.comparePoint(first, 0) === 0 &&
            range.comparePoint(last, last.textContent?.length ?? 0) === 0
          );
        }),
      )
      .toBe(true);
    await editor.press("Backspace");
    await expectPromptText(editor, "");
  }
  await pastePromptText(editor, text, "", true);
}

export async function pastePromptText(
  editor: Locator,
  text: string,
  html = "",
  plain = false,
) {
  await editor.evaluate(
    (element, clipboard) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "v",
          shiftKey: clipboard.plain,
          bubbles: true,
          cancelable: true,
        }),
      );
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", clipboard.text);
      if (clipboard.html) clipboardData.setData("text/html", clipboard.html);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
      element.dispatchEvent(
        new KeyboardEvent("keyup", { key: "Shift", bubbles: true }),
      );
    },
    { text, html, plain },
  );
}

export async function selectPromptText(
  editor: Locator,
  from: number,
  to = from,
) {
  await editor.evaluate(
    (element, selection) => {
      element.focus();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const position = (offset: number): [Node, number] => {
        for (const node of nodes) {
          if (offset <= node.length) return [node, offset];
          offset -= node.length;
        }
        return [element, element.childNodes.length];
      };
      const range = document.createRange();
      range.setStart(...position(selection.from));
      range.setEnd(...position(selection.to));
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    },
    { from, to },
  );
}
