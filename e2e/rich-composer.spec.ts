import { expect, test, type Page } from "./local-fixture";
import {
  expectPromptText,
  fillPromptText,
  pastePromptText,
  selectPromptText,
} from "./prompt-editor-helpers";

const headers = { Authorization: "Bearer browser-integration-test-token" };
async function fixture(page: Page) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const { session } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { agent: "fixture", cwd: workspace, title: "主输入框富文本验收" },
    })
  ).json();
  await page.addInitScript(() => {
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  await page.goto(`/#${session.id}`);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(input).toBeEditable();
  await input.focus();
  return { session, input };
}

test("main composer retains rich HTML, formatting shortcuts and the actual submitted document", async ({
  page,
}, testInfo) => {
  const { input } = await fixture(page);
  await pastePromptText(
    input,
    "重要任务\n名称\t状态\nAnyWork\t执行中",
    "<p><strong>重要任务</strong></p><table><thead><tr><th>名称</th><th>状态</th></tr></thead><tbody><tr><td>AnyWork</td><td>执行中</td></tr></tbody></table>",
  );
  await expect(input.locator("strong")).toHaveText("重要任务");
  await expect(input.locator("table")).toBeVisible();
  await expect(input.locator("th")).toHaveCount(2);
  await page.reload();
  await expect(input.locator("strong")).toHaveText("重要任务");
  await expect(input.locator("table")).toBeVisible();
  expect(
    await input.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/anywork-rich-composer-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const submitted = page.waitForRequest(
    (request) =>
      request.url().endsWith("/messages") && request.method() === "POST",
  );
  await page.getByTitle("发送", { exact: true }).click();
  const payload = (await submitted).postDataJSON();
  expect(payload.text).toContain("**重要任务**");
  expect(payload.text).toContain("| 名称");
  expect(
    payload.composer.document.content.some(
      (node: { type: string }) => node.type === "table",
    ),
  ).toBe(true);
  expect(payload.composer.markdown).toContain("**重要任务**");
  await expectPromptText(input, "");
  await fillPromptText(input, "快捷键格式");
  await input.press("ControlOrMeta+A");
  await input.press("ControlOrMeta+b");
  await expect(input.locator("strong")).toHaveText("快捷键格式");
  await input.press("ControlOrMeta+i");
  await expect(input.locator("em")).toHaveText("快捷键格式");
});

test("rich literal paste uses hard breaks and preserves every line's formatting across reload", async ({
  page,
}) => {
  const { input } = await fixture(page);
  await input.press("ControlOrMeta+b");
  await pastePromptText(
    input,
    "**literal**\r\n\r\nlast  \r",
    "<h1>wrong HTML</h1>",
    true,
  );
  await expect(input.locator(":scope > p")).toHaveCount(1);
  await expect(input.locator("br:not(.ProseMirror-trailingBreak)")).toHaveCount(
    3,
  );
  await expect(input.locator("h1")).toHaveCount(0);
  await expectPromptText(input, "**literal**\n\nlast  \n");
  await expect(input.locator("strong")).toHaveText("**literal**last  ");
  await page.reload();
  await expectPromptText(input, "**literal**\n\nlast  \n");
  await expect(input.locator("strong")).toHaveText("**literal**last  ");
  await expect(input.locator(":scope > p")).toHaveCount(1);
});

test("external paragraphs gain native spacing while internal slices and nested cells retain their own spacing", async ({
  page,
}) => {
  const { input } = await fixture(page);
  await pastePromptText(input, "one\ntwo", "<p>one</p><p>two</p>");
  await expectPromptText(input, "one\n\ntwo");
  await expect(
    input.locator('p[data-composer-paragraph-gap="true"]'),
  ).toHaveCount(1);
  await fillPromptText(input, "");
  await pastePromptText(
    input,
    "one\ntwo",
    '<div data-pm-slice="1 1 []"><p>one</p><p>two</p></div>',
  );
  await expectPromptText(input, "one\ntwo");
  await expect(
    input.locator('p[data-composer-paragraph-gap="true"]'),
  ).toHaveCount(0);
  await fillPromptText(input, "");
  await pastePromptText(
    input,
    "one\ntwo",
    "<ul><li><p>one</p><p>two</p></li></ul>",
  );
  await expect(input.locator("li p")).toHaveCount(2);
  await expect(
    input.locator('p[data-composer-paragraph-gap="true"]'),
  ).toHaveCount(0);
  await page.reload();
  await expect(input.locator("li p")).toHaveCount(2);
});

test("unformatted HTML requires an exact decoded literal match and otherwise keeps original clipboard text", async ({
  page,
}) => {
  const { input } = await fixture(page);
  await pastePromptText(input, "\\*literal\\* &amp;", "<p>*literal* &amp;</p>");
  await expectPromptText(input, "*literal* &");
  await expect(input.locator("em,strong")).toHaveCount(0);
  await fillPromptText(input, "");
  await pastePromptText(
    input,
    "keep  spaces\nsecond",
    "<p>keep spaces second</p>",
  );
  await expectPromptText(input, "keep  spaces\nsecond");
  await expect(input.locator(":scope > p")).toHaveCount(1);
  await fillPromptText(input, "");
  await pastePromptText(input, "plain clipboard", "<p>different HTML</p>");
  await expectPromptText(input, "plain clipboard");
});

test("HTML cleanup retains linked media sources and mathematical content without invisible clipboard material", async ({
  page,
}) => {
  const { input } = await fixture(page);
  await pastePromptText(
    input,
    "fallback",
    '<p style="color:red;font-family:serif;font-weight:600"><a href="https://example.test/page"><img src="https://example.test/image.png" alt="示意图"></a></p><p hidden>hidden content</p><p style="opacity:0">invisible content</p><script>bad()</script><math display="block"><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math>',
  );
  await expect(
    input.locator('[text-link-href="https://example.test/page"]'),
  ).toHaveText("示意图");
  await expect(
    input.locator('[text-link-href="https://example.test/image.png"]'),
  ).toHaveText("image");
  await expect(input.locator("pre")).toHaveText("x^2");
  await expect(input.locator("pre code")).toHaveAttribute(
    "data-language",
    "math",
  );
  await expect(input).not.toContainText("hidden content");
  await expect(input).not.toContainText("invisible content");
  await expect(input).not.toContainText("bad()");
  expect(
    await input.evaluate((element) =>
      Array.from(element.querySelectorAll<HTMLElement>("*")).every(
        (child) => !child.style.color && !child.style.fontFamily,
      ),
    ),
  ).toBe(true);
});

test("pasting a final table places typing after it and keeps the document editable after reload", async ({
  page,
}) => {
  const { input } = await fixture(page);
  await pastePromptText(
    input,
    "value",
    "<table><tr><td>value</td></tr></table>",
  );
  await expect(input.locator("td")).toHaveText("value");
  expect(
    await input.evaluate((element) => {
      const anchor = getSelection()?.anchorNode;
      return (
        !!anchor &&
        !!element.lastChild?.contains(anchor) &&
        element.lastChild instanceof HTMLParagraphElement
      );
    }),
  ).toBe(true);
  await input.pressSequentially("after table");
  await expect(input.locator("td")).toHaveText("value");
  await expect(input.locator(":scope > p").last()).toHaveText("after table");
  await page.reload();
  await expect(input.locator("td")).toHaveText("value");
  await expect(input.locator(":scope > p").last()).toHaveText("after table");
});

test("inline code paste keeps literal content while a mixed selection accepts structured HTML", async ({
  page,
}) => {
  const { input } = await fixture(page);
  await pastePromptText(input, "code plain", "<p><code>code</code> plain</p>");
  await selectPromptText(input, 1, 3);
  await pastePromptText(
    input,
    "**literal**",
    "<p><strong>formatted HTML</strong></p>",
  );
  await expect(input.locator("strong")).toHaveCount(0);
  await expect(input).toContainText("c**literal**e plain");
  await selectPromptText(input, 0, 17);
  await pastePromptText(
    input,
    "formatted HTML",
    "<p><strong>formatted HTML</strong></p>",
  );
  await expect(input.locator("strong")).toHaveText("formatted HTML");
});

test("oversized HTML and excessive hidden links fall back to literal text without converting a URL", async ({
  page,
}) => {
  const { input } = await fixture(page);
  const url = "https://example.test/keep-as-text";
  await pastePromptText(input, url, `<strong>${"x".repeat(100001)}</strong>`);
  await expectPromptText(input, url);
  await expect(input.locator(".prompt-inline-atom,a")).toHaveCount(0);
  await fillPromptText(input, "");
  await pastePromptText(
    input,
    "**literal**",
    `<p><a href="https://example.test/${"x".repeat(5000)}">visible</a></p>`,
  );
  await expectPromptText(input, "**literal**");
  await expect(input.locator("a,strong")).toHaveCount(0);
});

test("literal Markdown paste and old drafts keep their text across reload while agent text remains separate", async ({
  page,
}) => {
  const { input, session } = await fixture(page);
  const literal = "**保持字面文本**\n第二行";
  await fillPromptText(input, literal);
  await expect(input.locator("strong")).toHaveCount(0);
  await page.reload();
  await expectPromptText(input, literal);
  await expect(input.locator("strong")).toHaveCount(0);
  const submitted = page.waitForRequest(
    (request) =>
      request.url().endsWith("/messages") && request.method() === "POST",
  );
  await page.getByTitle("发送", { exact: true }).click();
  const payload = (await submitted).postDataJSON();
  expect(payload.text).toBe(literal);
  expect(payload.composer.markdown).toContain("\\*\\*保持字面文本\\*\\*");
  await expectPromptText(input, "");
  await expect(input).toBeEditable();
  // A draft written by the previous plain composer has no rich-document cache.
  await page.evaluate(
    ({ id }) => {
      sessionStorage.setItem(
        `anywork.draft.${JSON.stringify([location.origin, id])}`,
        "**旧版草稿**",
      );
      sessionStorage.removeItem(
        `anywork.composer-document.${JSON.stringify([location.origin, id])}`,
      );
    },
    { id: session.id },
  );
  await page.reload();
  await expectPromptText(input, "**旧版草稿**");
  await expect(input.locator("strong")).toHaveCount(0);
});

test("typed headings and lists follow the native Enter and indentation paths", async ({
  page,
}, testInfo) => {
  const { input } = await fixture(page);
  await input.pressSequentially("# 标题");
  await expect(input.locator("h1")).toHaveText("标题");
  await input.press("Tab");
  await expect(input.locator("h2")).toHaveText("标题");
  await input.press("Shift+Tab");
  await expect(input.locator("h1")).toHaveText("标题");
  await fillPromptText(input, "");
  await input.pressSequentially("- 第一项");
  await expect(input.locator("li")).toHaveText("第一项");
  await input.press("Shift+Enter");
  await input.pressSequentially("第二项");
  await expect(input.locator("li")).toHaveCount(2);
  await input.press("Tab");
  await expect(input.locator("ul ul li")).toHaveText("第二项");
  await input.press("Shift+Tab");
  await expect(input.locator("ul ul")).toHaveCount(0);
  let sends = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/messages") && request.method() === "POST")
      sends++;
  });
  await input.press("Enter");
  if (testInfo.project.name === "desktop") {
    await expect.poll(() => sends).toBe(1);
    await expectPromptText(input, "");
  } else {
    await expect(input.locator("li")).toHaveCount(3);
    expect(sends).toBe(0);
  }
});

test("code blocks indent real tabs and Mod Enter leaves code before submitting", async ({
  page,
}) => {
  const { input } = await fixture(page);
  await pastePromptText(
    input,
    "alpha\nbeta",
    "<pre><code>alpha\nbeta</code></pre>",
  );
  await expect(input.locator("pre")).toHaveText("alpha\nbeta");
  await input.press("ControlOrMeta+End");
  await input.press("ControlOrMeta+A");
  await input.press("Tab");
  await expect(input.locator("pre")).toHaveText("\talpha\n\tbeta");
  await input.press("Shift+Tab");
  await expect(input.locator("pre")).toHaveText("alpha\nbeta");
  let sends = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/messages") && request.method() === "POST")
      sends++;
  });
  await input.press("ControlOrMeta+Enter");
  await expect(input.locator(":scope > p")).toHaveCount(1);
  expect(sends).toBe(0);
  await input.pressSequentially("补充说明");
  await input.press("ControlOrMeta+Enter");
  await expect.poll(() => sends).toBe(1);
  await expectPromptText(input, "");
});

test("queue editing restores rich nodes and undo restores the previous rich main draft", async ({
  page,
}) => {
  const { input, session } = await fixture(page);
  await page.request.post(`/api/sessions/${session.id}/messages`, {
    headers,
    data: { text: "slow" },
  });
  await expect(page.getByTitle("中断", { exact: true })).toBeVisible();
  await pastePromptText(
    input,
    "排队的格式",
    "<p><strong>排队的格式</strong></p>",
  );
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.locator(".queue-item")).toHaveCount(1);
  await expectPromptText(input, "");
  await pastePromptText(
    input,
    "主输入框原格式",
    "<p><em>主输入框原格式</em></p>",
  );
  const edit = async () => {
    await page.locator(".queue-item summary").click();
    await page.getByRole("menuitem", { name: "编辑消息", exact: true }).click();
    await expect(page.locator(".queue-edit-notice")).toBeVisible();
    await expect(page.locator(".queue-item")).toHaveCount(0);
  };
  await edit();
  await expect(page.locator(".queue-item")).toHaveCount(0);
  await expect(input.locator("strong")).toHaveText("排队的格式");
  await page.reload();
  await expect(input.locator("strong")).toHaveText("排队的格式");
  await page
    .locator(".queue-edit-notice")
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  await expect(input.locator("em")).toHaveText("主输入框原格式");
  await expect(page.locator(".queue-item")).toHaveCount(1);
  await edit();
  await input.press("End");
  await input.pressSequentially("并补充");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.locator(".queue-item")).toHaveCount(1);
  const queue = await (
    await page.request.get(`/api/sessions/${session.id}/queue`, { headers })
  ).json();
  expect(
    queue.items[0].composer.document.content[0].content[0].marks.some(
      (mark: { type: string }) => mark.type === "strong",
    ),
  ).toBe(true);
  expect(queue.items[0].text).toContain("排队的格式");
});
