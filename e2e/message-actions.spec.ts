import { expectPromptText, fillPromptText } from "./prompt-editor-helpers";
import { expect, test, type Page } from "./local-fixture";
import { readFile } from "node:fs/promises";
const headers = { Authorization: "Bearer browser-integration-test-token" };
async function answer(page: Page) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const { session } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: {
        agent: "fixture",
        cwd: workspace,
        title: `回答操作 ${Date.now()}`,
      },
    })
  ).json();
  await page.request.post(`/api/sessions/${session.id}/messages`, {
    headers,
    data: { text: "hello" },
  });
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/sessions/${session.id}`, { headers })
          ).json()
        ).session.status,
    )
    .toBe("idle");
  await page.addInitScript(() => {
    localStorage.setItem("ra.appearance-v1", JSON.stringify({ mode: "light" }));

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).copiedAnswer = text;
        },
      },
    });
  });
  await page.goto(`/#${session.id}`);
  const message = page.locator(".message.assistant").last();
  await expect(message).toContainText("实时消息");
  const messageId = await message.getAttribute("data-message-id");
  return {
    session,
    message,
    path: `/api/sessions/${session.id}/feedback/${encodeURIComponent(messageId!)}`,
  };
}

test("answer actions copy rendered text and Markdown, download the answer and disclose unavailable reading", async ({
  page,
}, info) => {
  const { message } = await answer(page);
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "操作回答时保留草稿",
  );
  await message.getByRole("button", { name: "复制回答", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).copiedAnswer))
    .toContain("实时消息");
  expect(await page.evaluate(() => (window as any).copiedAnswer)).not.toContain(
    "**",
  );
  await expect(
    message.getByRole("button", { name: "复制回答", exact: true }),
  ).toBeFocused();
  const more = message.getByRole("button", {
    name: "更多回答操作",
    exact: true,
  });
  await more.click();
  const menu = page.getByRole("menu", { name: "更多回答操作", exact: true });
  await expect(
    menu.getByRole("menuitem", { name: "复制 Markdown", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    menu.getByRole("menuitem", { name: "下载回答", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await more.click();
  await menu
    .getByRole("menuitem", { name: "复制 Markdown", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).copiedAnswer))
    .toContain("**实时消息**");
  await more.click();
  const downloaded = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: "下载回答", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("AnyWork-answer.md");
  expect(await readFile((await download.path())!, "utf8")).toContain(
    "**实时消息**",
  );
  await message.getByRole("button", { name: "朗读", exact: true }).click();
  await expect(message.getByRole("status")).toContainText("此版本尚未提供朗读");
  await expectPromptText(
    page.getByLabel("消息", { exact: true }),
    "操作回答时保留草稿",
  );
  await page.screenshot({
    path: `artifacts/anywork-answer-actions-${info.project.name}.png`,
    fullPage: true,
  });
});

test("native feedback records bad before optional details, persists one selected reason and resets locally", async ({
  page,
}, info) => {
  const { message, path } = await answer(page);
  await message.getByRole("button", { name: "评价回复", exact: true }).click();
  const ratingMenu = page.getByRole("menu", { name: "评价回复", exact: true });
  await expect(ratingMenu).toContainText("仅保存到 AnyWork 本地工作空间");
  await ratingMenu
    .getByRole("menuitem", { name: "回复不佳", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "提交反馈", exact: true });
  await expect(dialog).toBeVisible();
  expect(
    (await (await page.request.get(path, { headers })).json()).feedback,
  ).toMatchObject({ rating: "bad", tags: [], text: null });
  await expect(
    dialog.getByRole("button", { name: "关闭评价", exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "提交", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole("radio")).toHaveCount(6);
  await dialog
    .getByRole("radio", { name: "不正确或不完整", exact: true })
    .click();
  await page.keyboard.press("ArrowRight");
  await expect(
    dialog.getByRole("radio", { name: "不是我想要的", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    dialog.getByRole("radio", { name: "不正确或不完整", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  await dialog
    .getByLabel("其他反馈", { exact: true })
    .fill("这份回答没有覆盖我提出的目标。\n请保留本地评价。");
  await dialog.getByRole("button", { name: "关闭评价", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "提交", exact: true }),
  ).toBeFocused();
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/anywork-feedback-${info.project.name}-light.png`,
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "提交", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await (await page.request.get(path, { headers })).json()).feedback,
  ).toMatchObject({
    rating: "bad",
    tags: ["not-what-i-asked-for"],
    text: "这份回答没有覆盖我提出的目标。\n请保留本地评价。",
  });
  await page.reload();
  const remove = message.getByRole("button", {
    name: "移除“回复不佳”反馈",
    exact: true,
  });
  await expect(remove).toBeVisible();
  await page.getByLabel("会话操作", { exact: true }).click();
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await message
    .getByRole("button", { name: "更多回答操作", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "编辑本地评价", exact: true })
    .click();
  await expect(
    dialog.getByRole("radio", { name: "不是我想要的", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByLabel("其他反馈", { exact: true })).toHaveValue(
    "这份回答没有覆盖我提出的目标。\n请保留本地评价。",
  );
  await page.screenshot({
    path: `artifacts/anywork-feedback-${info.project.name}-dark.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    message.getByRole("button", { name: "更多回答操作", exact: true }),
  ).toBeFocused();
  await remove.click();
  await expect(
    message.getByRole("button", { name: "评价回复", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(path, { headers })).json()).feedback,
  ).toBeNull();
  await message.getByRole("button", { name: "评价回复", exact: true }).click();
  await page.getByRole("menuitem", { name: "回复优秀", exact: true }).click();
  await expect(
    message.getByRole("button", { name: "移除“回复优秀”反馈", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(path, { headers })).json()).feedback.rating,
  ).toBe("good");
});

test("feedback failure keeps details for retry and late saves cannot open a dialog in another session", async ({
  page,
}) => {
  const { session, message, path } = await answer(page);
  await message.getByRole("button", { name: "评价回复", exact: true }).click();
  await page.getByRole("menuitem", { name: "回复不佳", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "提交反馈", exact: true });
  await dialog
    .getByLabel("其他反馈", { exact: true })
    .fill("保存失败后保留这条详情");
  let writes = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    if (writes === 1)
      return route.fulfill({
        status: 503,
        json: { error: "测试：本地工作空间暂时无法保存" },
      });
    await gate;
    await route.continue().catch(() => {});
  });
  await dialog.getByRole("button", { name: "提交", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "本地工作空间暂时无法保存",
  );
  await expect(dialog.getByLabel("其他反馈", { exact: true })).toHaveValue(
    "保存失败后保留这条详情",
  );
  await dialog.getByRole("button", { name: "提交", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "正在保存…", exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(2);
  const { session: other } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { agent: "fixture", cwd: session.cwd, title: "迟到响应隔离" },
    })
  ).json();
  await page.goto(`/#${other.id}`);
  await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
  release();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(path, { headers })).json()).feedback
          ?.text,
    )
    .toBe("保存失败后保留这条详情");
  await page.unroute(`**${path}`);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".answer-action-notice").filter({ hasText: "评价已保存" }),
  ).toHaveCount(0);
});
