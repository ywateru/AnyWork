import { expect, test, type Locator, type Page } from "@playwright/test";
import type { AgentEvent } from "../web/src/types";
import {
  expectPromptText,
  fillPromptText,
  pastePromptText,
  readPromptText,
  selectPromptText,
} from "./prompt-editor-helpers";

async function openEditor(page: Page, initialText = "等待编辑的问题") {
  const session = {
    id: "prompt-fixture",
    title: "真实文档编辑",
    thread_id: "prompt-thread",
    cwd: "/work/project",
    agent: "fixture",
    model: null,
    policy: "manual",
    status: "idle",
    archived: false,
    created_at: 1,
    updated_at: 1,
  };
  const events: AgentEvent[] = [
    {
      session_id: session.id,
      seq: 11,
      method: "user/message",
      created_at: 1,
      params: {
        text: initialText,
        history_turn_id: "prompt-turn",
        history_turn_status: "completed",
      },
    },
    {
      session_id: session.id,
      seq: 12,
      method: "item/completed",
      created_at: 1,
      params: {
        history_turn_id: "prompt-turn",
        history_turn_status: "completed",
        item: {
          id: "prompt-answer",
          type: "agentMessage",
          phase: "final_answer",
          text: "已有回答",
        },
      },
    },
  ];
  const state = {
    posts: [] as Record<string, unknown>[],
    hold: false,
    release: undefined as (() => void) | undefined,
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(4);
    let data: unknown = {};
    if (path === "/info")
      data = { workspace: session.cwd, hostname: "prompt-fixture" };
    else if (path === "/plugins")
      data = {
        plugins: [
          { id: "fixture", name: "Fixture", capabilities: ["message-edit"] },
        ],
      };
    else if (path === "/sessions") data = { sessions: [session] };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (
      /^\/sessions\/[^/]+\/edit\/[^/]+$/u.test(path) &&
      route.request().method() === "DELETE"
    )
      data = { ok: true };
    else if (path.endsWith("/edit")) {
      if (route.request().method() === "GET")
        data = url.searchParams.has("message_id")
          ? {
              editable: true,
              message_id: "user-11",
              turn_id: "prompt-turn",
              user_item_id: "prompt-user-item",
              text: initialText,
              input_types: ["text"],
              fingerprint: "prompt-fingerprint",
              limitations: [],
            }
          : { operation: null };
      else {
        const body = route.request().postDataJSON();
        state.posts.push(body);
        if (state.hold)
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
        data = {
          operation: { ...body, id: body.operation_id, phase: "completed" },
          turn_id: "prompt-replacement",
        };
      }
    } else if (path.endsWith("/history"))
      data = { events, next_cursor: null, latest_seq: 12 };
    else if (path.endsWith("/events/poll")) data = { events: [] };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (path === `/sessions/${session.id}`) data = { session };
    else throw new Error(`Unexpected prompt fixture request: ${path}`);
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({
        url: "https://prompt-fixture.trycloudflare.com",
        token: "prompt-fixture",
      }),
    );
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  await page.goto(`${process.env.USER_MESSAGE_TEST_URL || ""}/#${session.id}`);
  await page.getByRole("button", { name: "编辑消息", exact: true }).click();
  const form = page.getByRole("form", { name: "编辑消息", exact: true });
  const editor = form.getByRole("textbox", { name: "编辑消息", exact: true });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveClass(/\bProseMirror\b/);
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor).toHaveAttribute("aria-multiline", "true");
  expect(await editor.evaluate((element) => "value" in element)).toBe(false);
  return { state, form, editor };
}

test("real keyboard editing creates paragraphs, preserves whitespace and supports undo and redo", async ({
  page,
}, info) => {
  const { editor, state } = await openEditor(page);
  await fillPromptText(editor, "");
  await editor.pressSequentially("  first line  ");
  await editor.press("Shift+Enter");
  await editor.pressSequentially("second line");
  const text = "  first line  \nsecond line";
  await expectPromptText(editor, text);
  await expect(editor.locator(":scope > p")).toHaveCount(2);
  await editor.press("ControlOrMeta+Z");
  await expect.poll(() => readPromptText(editor)).not.toBe(text);
  await editor.press("ControlOrMeta+Shift+Z");
  await expectPromptText(editor, text);
  expect(state.posts).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/anywork-prompt-editor-${info.project.name}.png`,
  });
});

test("Enter submits on desktop and inserts a paragraph on mobile before Mod-Enter submits", async ({
  page,
}, info) => {
  const { editor, state } = await openEditor(page);
  await editor.fill("keyboard submission");
  await editor.press("Enter");
  if (info.project.name === "android-web") {
    await expectPromptText(editor, "keyboard submission\n");
    expect(state.posts).toEqual([]);
    await editor.press("ControlOrMeta+Enter");
  }
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0].text).toBe("keyboard submission");
});

test("Alt-Enter inserts a paragraph without submitting", async ({ page }) => {
  const { editor, state } = await openEditor(page);
  await editor.fill("first");
  await editor.press("End");
  await editor.press("Alt+Enter");
  await editor.pressSequentially("second");
  await expectPromptText(editor, "first\nsecond");
  expect(state.posts).toEqual([]);
});

test("historical text link edits use the shared popover without Escape cancelling the parent form", async ({
  page,
}) => {
  const { editor, form, state } = await openEditor(page);
  await fillPromptText(editor, "");
  await pastePromptText(
    editor,
    "link",
    '<p><a href="https://example.com/history">link</a></p>',
  );
  const link = editor.locator('[text-link-href="https://example.com/history"]');
  await link.click();
  await page.getByRole("button", { name: "编辑文字", exact: true }).click();
  const text = page.getByRole("textbox", { name: "文字", exact: true });
  await text.fill("unsaved");
  await text.press("Escape");
  await expect(form).toBeVisible();
  await page
    .getByRole("button", { name: "编辑文字", exact: true })
    .press("Escape");
  await expect(form).toBeVisible();
  await expect(link).toBeFocused();
  await link.click();
  await page.getByRole("button", { name: "编辑文字", exact: true }).click();
  await text.fill("edited link");
  await page.getByRole("button", { name: "保存链接文字", exact: true }).click();
  await expectPromptText(editor, "edited link");
  expect(state.posts).toEqual([]);
});

for (const key of ["Backspace", "Delete"]) {
  test(`${key} removes a library reference as one atom and undo restores it`, async ({
    page,
  }) => {
    const reference =
      "[项目文档](chatgpt-library-file://external-gdrive%3Afile%3Aabcde?asUrl=1&sourceUrl=https%3A%2F%2Fdocs.google.com%2Fdocument%2Fd%2Fabcde%2Fedit&mimeType=application%2Fvnd.google-apps.document)";
    const { editor, state } = await openEditor(
      page,
      `before ${reference} after`,
    );
    const mention = editor.locator(
      '[data-composer-node-type="chatGptLibraryFileMention"]',
    );
    await expect(mention).toHaveAttribute("contenteditable", "false");
    await expect(mention).toHaveText("项目文档");
    await expectPromptText(editor, "before 项目文档 after");
    await mention.evaluate((element, deletionKey) => {
      const editor = element.closest<HTMLElement>('[role="textbox"]')!;
      editor.focus();
      const range = document.createRange();
      if (deletionKey === "Backspace") range.setStartAfter(element);
      else range.setStartBefore(element);
      range.collapse(true);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    }, key);
    await editor.press(key);
    await expect(mention).toHaveCount(0);
    await expectPromptText(editor, "before  after");
    await editor.press("ControlOrMeta+Z");
    await expect(mention).toHaveCount(1);
    await expect(mention).toHaveText("项目文档");
    await expectPromptText(editor, "before 项目文档 after");
    expect(state.posts).toEqual([]);
  });
}

test("composition and legacy IME confirmation Enter do not submit or mutate the document", async ({
  page,
}) => {
  const { editor, state, form } = await openEditor(page);
  await editor.fill("中文输入法确认");
  await editor.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "确认" }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }),
    );
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "确认" }),
    );
  });
  await expectPromptText(editor, "中文输入法确认");
  expect(state.posts).toEqual([]);
  await page.waitForTimeout(120);
  await form.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0].text).toBe("中文输入法确认");
});

test("URL paste over selected text creates a link and preserves text and HTML on copy", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { editor } = await openEditor(page);
  await editor.fill("Selected label");
  await selectPromptText(editor, 0, "Selected label".length);
  await page.evaluate(() =>
    navigator.clipboard.writeText("https://example.com/reference?q=1"),
  );
  await editor.press("ControlOrMeta+V");
  await expectPromptText(editor, "Selected label");
  const link = editor.locator(
    '[text-link-href="https://example.com/reference?q=1"], a[href="https://example.com/reference?q=1"]',
  );
  await expect(link).toHaveCount(1);
  await selectPromptText(editor, 0, "Selected label".length);
  await editor.press("ControlOrMeta+C");
  const copied = await page.evaluate(async () => {
    const entries = await navigator.clipboard.read();
    const item = entries[0];
    return {
      text: await (await item.getType("text/plain")).text(),
      html: await (await item.getType("text/html")).text(),
    };
  });
  expect(copied.text).toBe(
    "[Selected label](https://example.com/reference?q=1)",
  );
  expect(copied.html).toContain('href="https://example.com/reference?q=1"');
  expect(copied.html).toContain("Selected label");
});

test("Shift paste ignores HTML formatting and CRLF text becomes separate paragraphs", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { editor, state } = await openEditor(page);
  await fillPromptText(editor, "");
  await page.evaluate(() =>
    navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob(["plain label"], { type: "text/plain" }),
        "text/html": new Blob(
          [
            '<p><strong><a href="https://example.com">plain label</a></strong></p>',
          ],
          { type: "text/html" },
        ),
      }),
    ]),
  );
  // Playwright maps Cmd+V to Chrome's paste command, but has no Cmd+Shift+V
  // command mapping on macOS. Issue that same real clipboard command with Shift.
  const cdp = await context.newCDPSession(page);
  const modifiers = 8 + (process.platform === "darwin" ? 4 : 2);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "v",
    code: "KeyV",
    modifiers,
    commands: ["paste"],
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "v",
    code: "KeyV",
    modifiers: 0,
  });
  await cdp.detach();
  await expectPromptText(editor, "plain label");
  await expect(editor.locator("a, [text-link-href], strong, b")).toHaveCount(0);
  await fillPromptText(editor, "");
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "  first\r\nsecond\rthird  \n");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expectPromptText(editor, "  first\nsecond\nthird  \n");
  await expect(editor.locator(":scope > p")).toHaveCount(4);
  expect(state.posts).toEqual([]);
});

test("an in-flight edit rejects keyboard changes and prevents duplicate submission", async ({
  page,
}) => {
  const { editor, state, form } = await openEditor(page);
  await editor.fill("submitted document");
  state.hold = true;
  await form.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  await expect(editor).not.toBeEditable();
  await expect(editor).toHaveAttribute("aria-disabled", "true");
  await editor.focus();
  await editor.pressSequentially("must not overwrite");
  await editor.press("ControlOrMeta+Enter");
  await pastePromptText(
    editor,
    "replacement pasted during submission",
    '<p><a href="https://example.com">replacement pasted during submission</a></p>',
  );
  await expectPromptText(editor, "submitted document");
  expect(state.posts).toHaveLength(1);
  state.release!();
});

const nativeClipboardReferences = [
  {
    type: "chatGptLibraryFileMention",
    label: "项目文档",
    attribute: "chatgpt-library-file-mention-id",
    value: "external-gdrive:file:abcde",
    html: '<span chatgpt-library-file-mention-id="external-gdrive:file:abcde" chatgpt-library-file-mention-title="项目文档" chatgpt-library-file-mention-mime-type="application/vnd.google-apps.document" data-prompt-link-href="chatgpt-library-file://external-gdrive%3Afile%3Aabcde?asUrl=1&amp;sourceUrl=https%3A%2F%2Fdocs.google.com%2Fdocument%2Fd%2Fabcde%2Fedit&amp;mimeType=application%2Fvnd.google-apps.document">项目文档</span>',
  },
  {
    type: "richLink",
    label: "Reference",
    attribute: "rich-link-href",
    value: "https://example.com/reference",
    html: '<span rich-link-display-text="Reference" rich-link-href="https://example.com/reference" rich-link-source-app-id="">Reference</span>',
  },
  {
    type: "atMention",
    label: "main.ts",
    attribute: "at-mention-path",
    value: "/work/project/src/main.ts",
    html: '<span at-mention-label="main.ts" at-mention-path="/work/project/src/main.ts" at-mention-fs-path="/work/project/src/main.ts">main.ts</span>',
  },
  {
    type: "resourceMention",
    label: "Reference resource",
    attribute: "resource-mention-resource-uri",
    value: "file:///reference.md",
    html: '<span resource-mention-resource-uri="file:///reference.md" resource-mention-server="fixture" resource-mention-title="Reference resource" resource-mention-connector-id="connector-1" resource-mention-link-id="link-1">Reference resource</span>',
  },
];

for (const reference of nativeClipboardReferences) {
  test(`native ${reference.type} clipboard HTML survives paste, copy and paste again`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { editor, state } = await openEditor(page);
    await fillPromptText(editor, "");
    await pastePromptText(editor, reference.label, reference.html);
    const atom = editor.locator(
      `[data-composer-node-type="${reference.type}"]`,
    );
    await expect(atom).toHaveCount(1);
    await expect(atom).toHaveAttribute("contenteditable", "false");
    await expectPromptText(editor, reference.label);
    await editor.press("ControlOrMeta+A");
    await editor.press("ControlOrMeta+C");
    const clipboard = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read())[0];
      return {
        text: await (await item.getType("text/plain")).text(),
        html: await (await item.getType("text/html")).text(),
      };
    });
    const attribute = await page.evaluate(
      ({ html, attribute }) =>
        new DOMParser()
          .parseFromString(html, "text/html")
          .body.querySelector(`[${attribute}]`)
          ?.getAttribute(attribute),
      { html: clipboard.html, attribute: reference.attribute },
    );
    expect(attribute).toBe(reference.value);
    await fillPromptText(editor, "");
    await editor.press("ControlOrMeta+V");
    await expect(atom).toHaveCount(1);
    await expectPromptText(editor, reference.label);
    expect(state.posts).toEqual([]);
  });
}

test("plain-text reference Markdown stays literal when pasted without reference HTML", async ({
  page,
}) => {
  const { editor, state } = await openEditor(page);
  const text =
    "[main.ts](/work/project/src/main.ts)\n[项目文档](chatgpt-library-file://file-plain-reference)\n[Example](https://example.com/reference)";
  await fillPromptText(editor, "");
  await pastePromptText(editor, text);
  await expectPromptText(editor, text);
  await expect(editor.locator("[data-composer-node-type], a")).toHaveCount(0);
  expect(state.posts).toEqual([]);
});

async function pasteCodeDocument(
  editor: Awaited<ReturnType<typeof openEditor>>["editor"],
) {
  await fillPromptText(editor, "");
  await pastePromptText(
    editor,
    "before\nlet value = 1;\nafter",
    '<p>before</p><pre><code data-language="rust">let value = 1;</code></pre><p>after</p>',
  );
  const code = editor.locator("pre > code");
  await expect(code).toHaveCount(1);
  await expect(code).toHaveAttribute("data-language", "rust");
  await expect(code).toHaveText("let value = 1;");
  return code;
}

async function clickInsideCode(code: Locator) {
  await code.click();
  await expect
    .poll(() =>
      code.evaluate((element) => {
        const selection = getSelection();
        return (
          selection?.isCollapsed &&
          element.contains(selection.anchorNode) &&
          document.activeElement === element.closest('[role="textbox"]')
        );
      }),
    )
    .toBe(true);
}

test("native code HTML preserves its language and keyboard shortcuts stay inside or leave the code block", async ({
  page,
}, info) => {
  const { editor, state } = await openEditor(page);
  const code = await pasteCodeDocument(editor);
  await clickInsideCode(code);
  await editor.press(process.platform === "darwin" ? "Meta+ArrowRight" : "End");
  await expect
    .poll(() =>
      code.evaluate((element) => {
        const selection = getSelection();
        return (
          selection?.isCollapsed &&
          element.contains(selection.anchorNode) &&
          selection.anchorOffset === selection.anchorNode?.textContent?.length
        );
      }),
    )
    .toBe(true);
  await editor.press("Shift+Enter");
  await editor.pressSequentially("// newline");
  await expect(code).toHaveText("let value = 1;\n// newline");
  await expect(editor.locator(":scope > p")).toHaveCount(2);
  await editor.press("ControlOrMeta+Enter");
  await editor.pressSequentially("outside ");
  await expect(editor.locator(":scope > p").last()).toHaveText("outside after");
  await expect(code).toHaveText("let value = 1;\n// newline");
  expect(state.posts).toEqual([]);
  await page.screenshot({
    path: `artifacts/anywork-prompt-code-${info.project.name}.png`,
  });
});

test("first Mod-A selects only code text, copy omits fences, and second Mod-A selects the document", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { editor, state } = await openEditor(page);
  const code = await pasteCodeDocument(editor);
  await clickInsideCode(code);
  await editor.press("ControlOrMeta+A");
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("let value = 1;");
  await editor.press("ControlOrMeta+C");
  const clipboard = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0];
    return {
      text: await (await item.getType("text/plain")).text(),
      html: await (await item.getType("text/html")).text(),
    };
  });
  expect(clipboard.text).toBe("let value = 1;");
  expect(clipboard.html).toContain('data-language="rust"');
  await editor.press("ControlOrMeta+A");
  const wholeDocument = await page.evaluate(() =>
    window.getSelection()?.toString(),
  );
  expect(wholeDocument).toContain("before");
  expect(wholeDocument).toContain("let value = 1;");
  expect(wholeDocument).toContain("after");
  expect(state.posts).toEqual([]);
});

test("long Unicode library names truncate in the middle while accessibility and clipboard retain the full title", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { editor, state } = await openEditor(page);
  const title = `${"👩🏽‍💻项目".repeat(20)}最终版.pdf`;
  await fillPromptText(editor, "");
  await pastePromptText(
    editor,
    title,
    `<span chatgpt-library-file-mention-id="long-unicode-file" chatgpt-library-file-mention-title="${title}" chatgpt-library-file-mention-mime-type="application/pdf">${title}</span>`,
  );
  const atom = editor.locator(
    '[data-composer-node-type="chatGptLibraryFileMention"]',
  );
  await expect(atom).toHaveAttribute("title", title);
  await expect(atom).toHaveAttribute("aria-label", title);
  await expect(atom.locator("[data-file-icon]")).toHaveAttribute(
    "data-file-icon",
    "pdf",
  );
  const display = atom.locator(".prompt-file-name-display");
  await expect(display).toHaveText(/^👩🏽‍💻.*….*\.pdf$/u);
  expect(await display.textContent()).not.toContain("�");
  expect(await display.textContent()).not.toBe(title);
  await editor.press("ControlOrMeta+A");
  await editor.press("ControlOrMeta+C");
  const clipboard = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0];
    return {
      text: await (await item.getType("text/plain")).text(),
      html: await (await item.getType("text/html")).text(),
    };
  });
  expect(clipboard.text).toBe(title);
  const copied = await page.evaluate((html) => {
    const atom = new DOMParser()
      .parseFromString(html, "text/html")
      .body.querySelector("[chatgpt-library-file-mention-title]");
    return {
      title: atom?.getAttribute("chatgpt-library-file-mention-title"),
      text: atom?.textContent,
    };
  }, clipboard.html);
  expect(copied).toEqual({ title, text: title });
  expect(state.posts).toEqual([]);
  await page.screenshot({
    path: `artifacts/anywork-prompt-long-file-${info.project.name}.png`,
  });
});
