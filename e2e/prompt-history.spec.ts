import { expect, test, type Page } from "./local-fixture";
import {
  expectPromptText,
  fillPromptText,
  pastePromptText,
  selectPromptText,
} from "./prompt-editor-helpers";

const headers = { Authorization: "Bearer browser-integration-test-token" };
async function fixture(page: Page, entries: unknown[] = []) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const { session } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { agent: "fixture", cwd: workspace, title: "输入历史验收" },
    })
  ).json();
  await page.addInitScript(
    ({ id, entries }) => {
      localStorage.setItem("ra.sidebar-pinned", "false");
      const key = `anywork.prompt-history.${location.origin}`;
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ [id]: entries }));
    },
    { id: session.id, entries },
  );
  await page.goto(`/#${session.id}`);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(input).toBeEditable();
  await input.focus();
  return { session, input, workspace };
}

test("submitted rich and literal prompts cycle in native order and Down clears after newest", async ({
  page,
}) => {
  const { input } = await fixture(page);
  await pastePromptText(
    input,
    "第一条格式",
    "<p><strong>第一条格式</strong></p>",
  );
  await page.getByTitle("发送", { exact: true }).click();
  await expectPromptText(input, "");
  await fillPromptText(input, "**第二条字面文本**");
  await page.getByTitle("发送", { exact: true }).click();
  await expectPromptText(input, "");
  await input.press("ArrowDown");
  await expectPromptText(input, "");
  await input.press("ArrowUp");
  await expectPromptText(input, "**第二条字面文本**");
  await expect(input.locator("strong")).toHaveCount(0);
  await input.press("ArrowUp");
  await expect(input.locator("strong")).toHaveText("第一条格式");
  await input.press("ArrowUp");
  await expectPromptText(input, "**第二条字面文本**");
  await input.press("ArrowDown");
  await expectPromptText(input, "");
  await input.press("ArrowUp");
  await input.press("ArrowUp");
  await input.press("ArrowDown");
  await expectPromptText(input, "**第二条字面文本**");
});

test("history persists through reload and remains scoped to its chat and server", async ({
  page,
}) => {
  const { input, session, workspace } = await fixture(page);
  await fillPromptText(input, "保存到当前会话");
  await page.getByTitle("发送", { exact: true }).click();
  await expectPromptText(input, "");
  await page.reload();
  await expect(input).toBeEditable();
  await input.press("ArrowUp");
  await expectPromptText(input, "保存到当前会话");
  const { session: other } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { agent: "fixture", cwd: workspace, title: "另一个会话" },
    })
  ).json();
  await page.evaluate((id) => (location.hash = id), other.id);
  await expectPromptText(input, "");
  await input.press("ArrowUp");
  await expectPromptText(input, "");
  await page.evaluate((id) => (location.hash = id), session.id);
  await expectPromptText(input, "保存到当前会话");
  await fillPromptText(input, "");
  await input.press("ArrowUp");
  await expectPromptText(input, "保存到当前会话");
  await fillPromptText(input, "");
  await page.evaluate((id) => {
    localStorage.setItem(
      "anywork.prompt-history.https://another.invalid",
      JSON.stringify({ [id]: ["其他服务器的输入"] }),
    );
    localStorage.setItem(`anywork.prompt-history.${location.origin}`, "{}");
  }, session.id);
  await page.reload();
  await expect(input).toBeEditable();
  await input.press("ArrowUp");
  await expectPromptText(input, "");
});

test("history resets on real edits and respects cursor, selection, modifiers and IME", async ({
  page,
}) => {
  const { input } = await fixture(page, ["first", "last"]);
  await fillPromptText(input, "   ");
  await input.press("Shift+ArrowUp");
  await input.press("Alt+ArrowUp");
  await input.press("ControlOrMeta+ArrowUp");
  await input.dispatchEvent("keydown", {
    key: "ArrowUp",
    isComposing: true,
    bubbles: true,
    cancelable: true,
  });
  await input.dispatchEvent("keydown", {
    key: "ArrowUp",
    keyCode: 229,
    bubbles: true,
    cancelable: true,
  });
  await selectPromptText(input, 0, 3);
  await input.press("ArrowUp");
  await expectPromptText(input, "   ");
  await selectPromptText(input, 0);
  await input.press("ArrowUp");
  await expectPromptText(input, "   ");
  await selectPromptText(input, 3);
  await input.press("ArrowUp");
  // Rich persisted Markdown escapes edge spaces; history uses persisted text,
  // unlike the queue's semantic-content gate.
  await expectPromptText(input, "   ");
  await fillPromptText(input, "");
  await input.press("ArrowUp");
  await expectPromptText(input, "last");
  await input.pressSequentially(" changed");
  await input.press("ArrowUp");
  await expectPromptText(input, "last changed");
  await input.press("ArrowDown");
  await expectPromptText(input, "last changed");
  await fillPromptText(input, "");
  await input.press("ArrowUp");
  await expectPromptText(input, "last");
});

test("failed submissions still enter history and duplicates remain separate attempts", async ({
  page,
}) => {
  const { input, session } = await fixture(page);
  await page.route(`**/api/sessions/${session.id}/messages`, (route) =>
    route.fulfill({ status: 500, json: { error: "历史验收发送失败" } }),
  );
  await fillPromptText(input, "失败也保留的输入");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(
    page.getByText("历史验收发送失败", { exact: true }),
  ).toBeVisible();
  await expect(input).toBeEditable();
  await page.getByTitle("发送", { exact: true }).click();
  await expect(input).toBeEditable();
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          JSON.parse(
            localStorage.getItem(`anywork.prompt-history.${location.origin}`)!,
          )[id].length,
        session.id,
      ),
    )
    .toBe(2);
  await expectPromptText(input, "失败也保留的输入");
  await fillPromptText(input, "");
  await input.press("ArrowUp");
  await expectPromptText(input, "失败也保留的输入");
  await input.press("ArrowUp");
  await input.press("ArrowDown");
  await expectPromptText(input, "失败也保留的输入");
  await input.press("ArrowDown");
  await expectPromptText(input, "");
});

test("queued recall has priority while history remains available inside a cleared queue edit", async ({
  page,
}) => {
  const { input, session } = await fixture(page);
  await page.request.post(`/api/sessions/${session.id}/messages`, {
    headers,
    data: { text: "slow" },
  });
  await expect(page.getByTitle("中断", { exact: true })).toBeVisible();
  for (const text of ["排队第一条", "排队第二条"]) {
    await fillPromptText(input, text);
    await page.getByTitle("发送", { exact: true }).click();
    await expectPromptText(input, "");
  }
  await expect(page.locator(".queue-item")).toHaveCount(2);
  const actions: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/queue"))
      actions.push(request.postDataJSON().action);
  });
  await input.press("ArrowUp");
  await expect(page.locator(".queue-edit-notice")).toBeVisible();
  await expect(page.locator(".queue-item")).toHaveCount(1);
  await expectPromptText(input, "排队第二条");
  await fillPromptText(input, "");
  await input.press("ArrowUp");
  await expectPromptText(input, "排队第二条");
  await input.press("ArrowUp");
  await expectPromptText(input, "排队第一条");
  await expect(page.locator(".queue-edit-notice")).toBeVisible();
  expect(actions).toEqual(["take"]);
});

test("valid history JSON restores marks and mentions before text fallback", async ({
  page,
}) => {
  const { input } = await fixture(page, [
    {
      markdown: "**格式与引用** [file](src/example.rs)",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "格式与引用", marks: [{ type: "strong" }] },
              { type: "text", text: " " },
              {
                type: "atMention",
                attrs: {
                  label: "file",
                  path: "src/example.rs",
                  fsPath: "/fixture/from-json.rs",
                },
              },
            ],
          },
        ],
      },
    },
  ]);
  await input.press("ArrowUp");
  await expect(input.locator("strong")).toHaveText("格式与引用");
  await expect(
    input.locator('[data-composer-node-type="atMention"]'),
  ).toBeVisible();
  await expect(
    input.locator('[data-composer-node-type="atMention"]'),
  ).toHaveAttribute("at-mention-fs-path", "/fixture/from-json.rs");
  await expect(input).toBeFocused();
  const actions: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") actions.push(request.url());
  });
  await input.press("ArrowDown");
  await expectPromptText(input, "");
  expect(actions).toEqual([]);
});

test("invalid history documents fall back to their Markdown and plain formats", async ({
  page,
}) => {
  const { input, session } = await fixture(page, [
    { markdown: "**Markdown fallback**", document: { type: "obsolete" } },
  ]);
  await input.press("ArrowUp");
  await expect(input.locator("strong")).toHaveText("Markdown fallback");
  await input.press("ArrowDown");
  await expectPromptText(input, "");
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        `anywork.prompt-history.${location.origin}`,
        JSON.stringify({
          [id]: [
            {
              plain: "**literal**\n- item\n  3. *nested*\n```ts\n**code**\n```",
              document: { type: "obsolete" },
            },
          ],
        }),
      ),
    session.id,
  );
  await input.press("ArrowUp");
  await expect(input.locator("strong, em")).toHaveCount(0);
  await expect(input.locator("ul ol")).toBeVisible();
  await expect(input.locator("pre")).toHaveText("**code**");
  await expect(input.locator("p").first()).toHaveText("**literal**");
});

test("history changes only prompt text and retains current attachments", async ({
  page,
}) => {
  const { input } = await fixture(page, ["历史文字"]);
  await page.locator('input[type="file"]').setInputFiles({
    name: "current-draft.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("只属于当前草稿的附件"),
  });
  await expect(page.getByText("正在上传附件…", { exact: true })).toHaveCount(0);
  await expect(page.locator(".attachments .attachment-name")).toHaveText(
    "current-draft.txt",
  );
  await input.press("ArrowUp");
  await expectPromptText(input, "历史文字");
  await expect(page.locator(".attachments .attachment-name")).toHaveText(
    "current-draft.txt",
  );
  await input.press("ArrowDown");
  await expectPromptText(input, "");
  await expect(page.locator(".attachments .attachment-name")).toHaveText(
    "current-draft.txt",
  );
});

test("legacy history restores references but preserves ordinary Markdown as literal text", async ({
  page,
}) => {
  const { input } = await fixture(page, [
    "**literal legacy**",
    "[file](src/example.rs)",
  ]);
  await input.press("ArrowUp");
  await expect(
    input.locator('[data-composer-node-type="atMention"]'),
  ).toHaveAttribute("at-mention-path", "src/example.rs");
  await input.press("ArrowUp");
  await expectPromptText(input, "**literal legacy**");
  await expect(input.locator("strong")).toHaveCount(0);
  // Literal legacy text has different persisted Markdown. Native Dhr exits
  // navigation when a restored document no longer matches the saved text.
  await input.press("ArrowDown");
  await expectPromptText(input, "**literal legacy**");
});

test("valid JSON with mismatched saved text exits navigation instead of replacing the restored draft", async ({
  page,
}) => {
  const { input } = await fixture(page, [
    {
      markdown: "saved fallback",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "document wins" }],
          },
        ],
      },
    },
  ]);
  await input.press("ArrowUp");
  await expectPromptText(input, "document wins");
  await input.press("ArrowDown");
  await expectPromptText(input, "document wins");
  await input.press("ArrowUp");
  await expectPromptText(input, "document wins");
});
