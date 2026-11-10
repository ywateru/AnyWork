import { fetchLocalRoute } from "./local-fixture";
import {
  expectPromptText,
  fillPromptText,
  pastePromptText,
  selectPromptText,
} from "./prompt-editor-helpers";
import { expect, test, type Page } from "./local-fixture";
const headers = { Authorization: "Bearer browser-integration-test-token" };

async function fixture(page: Page) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const { session } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { cwd: workspace, agent: "fixture", title: "排队和持续目标验收" },
    })
  ).json();
  await page.request.post(`/api/sessions/${session.id}/messages`, {
    headers,
    data: { text: "slow" },
  });
  for (const text of ["先处理这一条", "随后处理第二条"]) {
    expect(
      (
        await page.request.post(`/api/sessions/${session.id}/messages`, {
          headers,
          data: { text, mode: "queue" },
        })
      ).ok(),
    ).toBe(true);
  }
  await page.addInitScript(() => {
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  return {
    session,
    open: async () => {
      await page.goto(`/#${session.id}`);
      await expect(page.locator(".queue-item")).toHaveCount(2);
      await expect(page.getByLabel("消息", { exact: true })).toBeEditable();
    },
    read: async () =>
      (
        await page.request.get(`/api/sessions/${session.id}/queue`, { headers })
      ).json(),
  };
}
const queueMenu = (page: Page) =>
  page.getByRole("menu", { name: "排队消息选项", exact: true });
async function menu(page: Page) {
  await page.locator(".queue-item summary").first().click();
  await expect(queueMenu(page)).toBeVisible();
  await expect
    .poll(async () => {
      const trigger = (await page
        .locator(".queue-item summary")
        .first()
        .boundingBox())!;
      const popup = (await queueMenu(page).boundingBox())!;
      return (
        Math.abs(popup.x + popup.width - (trigger.x + trigger.width)) < 2 &&
        popup.y + popup.height <= trigger.y
      );
    })
    .toBe(true);
}

test("queued prompt preview reads and selects the full message without editing or sending", async ({
  page,
}, info) => {
  const { session, open, read } = await fixture(page);
  const text =
    "需要完整阅读的排队任务\n\n" +
    "检查输入框、权限确认和手机分屏，不覆盖原草稿。\n".repeat(45) +
    "最后一行也需要保留。";
  const first = (await read()).items[0];
  await page.request.post(`/api/sessions/${session.id}/queue`, {
    headers,
    data: { action: "edit", id: first.id, text },
  });
  await open();
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "保留主输入框草稿");
  const actions: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(messages|queue)$/.test(request.url())
    )
      actions.push(request.url());
  });
  const trigger = page.getByRole("group", { name: /^预览排队消息 1：/ });
  await trigger.click();
  const preview = page.getByRole("dialog", {
    name: "排队消息预览",
    exact: true,
  });
  await expect(preview).toHaveText(text);
  await expect(preview).toHaveAttribute("data-tooltip-keyboard-navigation", "");
  await expectPromptText(input, "保留主输入框草稿");
  expect((await read()).items).toHaveLength(2);
  expect((await read()).editing).toBeNull();
  await preview.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(text);
  await preview.focus();
  await expect(preview).toBeFocused();
  const bounds = (await preview.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  expect(
    await preview.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  await preview.evaluate(() => getSelection()?.removeAllRanges());
  await page.screenshot({
    path: `artifacts/anywork-queue-preview-${info.project.name}.png`,
    fullPage: true,
  });
  await preview.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(actions).toEqual([]);
  await menu(page);
  await queueMenu(page)
    .getByRole("menuitem", { name: "编辑消息", exact: true })
    .click();
  await expectPromptText(input, text);
  await expect(page.locator(".queue-item")).toHaveCount(1);
});

test("queue preview uses delayed hover, keyboard entry and normal action navigation", async ({
  page,
}) => {
  const { session, open, read } = await fixture(page);
  const first = (await read()).items[0];
  await page.request.post(`/api/sessions/${session.id}/queue`, {
    headers,
    data: { action: "edit", id: first.id, text: "第一行\n需要预览的第二行" },
  });
  await open();
  const clockStart = new Date("2026-11-06T00:00:00Z");
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000));
  const trigger = page.getByRole("group", { name: /^预览排队消息 1：/ });
  const preview = page.getByRole("dialog", {
    name: "排队消息预览",
    exact: true,
  });
  await trigger.hover();
  await expect(preview).toHaveCount(0);
  await page.clock.runFor(650);
  await expect(preview).toHaveCount(0);
  await page.clock.runFor(100);
  await expect(preview).toBeVisible();
  await trigger.focus();
  await trigger.press("Tab");
  await expect(preview).toBeFocused();
  await preview.press("Shift+Tab");
  await expect(trigger).toBeFocused();
  await trigger.press("Tab");
  await preview.press("Tab");
  await expect(preview).toHaveCount(0);
  await expect(
    page.locator(".queue-item").first().getByTitle("立即发送，引导当前任务"),
  ).toBeFocused();
});

test("short queued text stays readable without turning its body into an edit action", async ({
  page,
}) => {
  const { open, read } = await fixture(page);
  await open();
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "主草稿");
  await page.getByRole("group", { name: /^预览排队消息 1：/ }).click();
  await expect(
    page.getByRole("dialog", { name: "排队消息预览", exact: true }),
  ).toHaveCount(0);
  await expectPromptText(input, "主草稿");
  expect((await read()).editing).toBeNull();
});

test("sending rows show progress and unconfirmed deliveries allow inspection and deletion without retrying", async ({
  page,
}) => {
  const { session, open, read } = await fixture(page);
  let status = "sending";
  const original = await read();
  original.items[0].text = "检查发送状态\n保留完整排队正文";
  await page.route(`**/api/sessions/${session.id}/queue`, async (route) => {
    if (route.request().method() === "POST") return route.continue();
    await route.fulfill({
      json: {
        ...original,
        items: [
          {
            ...original.items[0],
            status,
            error:
              status === "uncertain"
                ? "发送未确认，请检查对话后再操作"
                : undefined,
          },
          original.items[1],
        ],
      },
    });
  });
  await open();
  const first = page.locator(".queue-item").first();
  await expect(first).toHaveAttribute("data-status", "sending");
  await expect(first.locator(".spin")).toBeVisible();
  await expect(first.getByTitle("立即发送，引导当前任务")).toBeHidden();
  await expect(first.locator("details")).toBeHidden();
  await expect(
    first.getByRole("button", { name: "删除排队消息", exact: true }),
  ).toBeDisabled();
  status = "uncertain";
  await expect(first).toHaveAttribute("data-status", "uncertain");
  await expect(first.getByTitle("立即发送，引导当前任务")).toBeDisabled();
  await expect(first.locator("summary")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await first.locator("summary").click();
  await expect(first.getByRole("menu")).toBeHidden();
  await first.getByRole("group", { name: /^预览排队消息/ }).click();
  await expect(
    page.getByRole("dialog", { name: "排队消息预览", exact: true }),
  ).toHaveText("检查发送状态\n保留完整排队正文");
  await expect(
    first.getByRole("button", { name: "删除排队消息", exact: true }),
  ).toBeEnabled();
});

test("modified Enter follows the running queue preference and edited messages keep their original queue position", async ({
  page,
}) => {
  const { open, read } = await fixture(page);
  await open();
  const input = page.getByLabel("消息", { exact: true });
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/messages") && request.method() === "POST")
      sent.push(request.postDataJSON().mode);
  });
  await fillPromptText(input, "运行中反向引导");
  await input.press("ControlOrMeta+Enter");
  await expectPromptText(input, "");
  expect(sent).toEqual(["steer"]);
  await menu(page);
  await queueMenu(page)
    .getByRole("menuitem", { name: "关闭排队", exact: true })
    .click();
  await fillPromptText(input, "运行中反向排队");
  await input.press("ControlOrMeta+Enter");
  await expect(page.locator(".queue-item")).toHaveCount(3);
  expect(sent).toEqual(["steer", "queue"]);
  const original = (await read()).items;
  await menu(page);
  await queueMenu(page)
    .getByRole("menuitem", { name: "编辑消息", exact: true })
    .click();
  await expect(page.locator(".queue-edit-notice")).toBeVisible();
  await expectPromptText(input, original[0].text);
  await expect(page.locator(".queue-item")).toHaveCount(2);
  await fillPromptText(input, "编辑后仍恢复原位置");
  await input.press("ControlOrMeta+Enter");
  await expect(page.locator(".queue-item")).toHaveCount(3);
  const changed = await read();
  expect(changed.editing).toBeNull();
  expect(changed.items.map((item: { id: number }) => item.id)).toEqual(
    original.map((item: { id: number }) => item.id),
  );
  expect(changed.items[0].text).toBe("编辑后仍恢复原位置");
  expect(sent).toEqual(["steer", "queue"]);
});

test("modified Enter in an idle session sends immediately even when queueing is disabled", async ({
  page,
}) => {
  const { session, open } = await fixture(page);
  await open();
  await menu(page);
  await queueMenu(page)
    .getByRole("menuitem", { name: "关闭排队", exact: true })
    .click();
  await page.request.post(`/api/sessions/${session.id}/interrupt`, {
    headers,
    data: {},
  });
  await expect(page.getByTitle("中断", { exact: true })).toHaveCount(0);
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "空闲时立即发送");
  const submitted = page.waitForRequest(
    (request) =>
      request.url().endsWith("/messages") && request.method() === "POST",
  );
  await input.press("ControlOrMeta+Enter");
  expect((await submitted).postDataJSON().mode).toBe("steer");
  await expectPromptText(input, "");
});

test("empty modified Enter steers the oldest queued message through its exact queue id", async ({
  page,
}) => {
  const { open, read } = await fixture(page);
  const original = (await read()).items;
  await open();
  const input = page.getByLabel("消息", { exact: true });
  const requests: object[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(messages|queue)$/.test(request.url())
    )
      requests.push(request.postDataJSON());
  });
  await fillPromptText(input, "   ");
  await input.press("ControlOrMeta+Enter");
  await expect(page.locator(".queue-item")).toHaveCount(1);
  expect(requests).toEqual([{ action: "steer", id: original[0].id }]);
  expect((await read()).items.map((item: { id: number }) => item.id)).toEqual([
    original[1].id,
  ]);
  await expectPromptText(input, "   ");
  await expect(page.getByTitle("中断", { exact: true })).toBeVisible();
});

test("empty ArrowUp restores the newest rich queued prompt with attachments and keeps FIFO on resubmit", async ({
  page,
}, info) => {
  const { session, open, read } = await fixture(page);
  await open();
  const upload = await (
    await page.request.post(`/api/sessions/${session.id}/uploads`, {
      headers,
      multipart: {
        files: {
          name: "queue-notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("保留的排队附件"),
        },
      },
    })
  ).json();
  const composer = {
    markdown: "**富文本队尾**",
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "富文本队尾", marks: [{ type: "strong" }] },
          ],
        },
      ],
    },
  };
  const attachment = upload.files[0].path;
  await page.request.post(`/api/sessions/${session.id}/messages`, {
    headers,
    data: {
      mode: "queue",
      text: "**富文本队尾**",
      composer,
      attachments: [attachment],
    },
  });
  await expect(page.locator(".queue-item")).toHaveCount(3);
  const original = (await read()).items;
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "   ");
  await input.press("ArrowUp");
  await expect(input.locator("strong")).toHaveText("富文本队尾");
  await expect(page.locator(".queue-item")).toHaveCount(2);
  await expect(page.locator(".attachments .attachment-name")).toHaveText(
    "queue-notes.txt",
  );
  expect((await read()).editing.id).toBe(original[2].id);
  await page.screenshot({
    path: `artifacts/anywork-queue-edit-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .locator(".queue-edit-notice")
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  await expectPromptText(input, "   ");
  await expect(page.locator(".attachments")).toHaveCount(0);
  await expect(page.locator(".queue-item")).toHaveCount(3);
  await input.press("ArrowUp");
  await expect(input.locator("strong")).toHaveText("富文本队尾");
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/queue") &&
      request.postDataJSON().action === "replace",
  );
  await input.press("ControlOrMeta+Enter");
  const payload = (await submitted).postDataJSON();
  expect(payload.id).toBe(original[2].id);
  expect(payload.text).toBe("**富文本队尾**");
  expect(payload.composer.markdown).toBe(composer.markdown);
  expect(payload.attachments).toEqual([attachment]);
  await expect(page.locator(".queue-item")).toHaveCount(3);
  expect((await read()).items.map((item: { id: number }) => item.id)).toEqual(
    original.map((item: { id: number }) => item.id),
  );
});

test("queue recall respects content, literal line breaks, selection, modifiers and IME", async ({
  page,
}) => {
  const { open } = await fixture(page);
  await open();
  const input = page.getByLabel("消息", { exact: true });
  const actions: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/queue"))
      actions.push(request.postDataJSON().action);
  });
  await fillPromptText(input, "有内容的草稿");
  await input.press("ArrowUp");
  await expectPromptText(input, "有内容的草稿");
  await fillPromptText(input, "\n");
  await input.press("ControlOrMeta+End");
  await input.press("ArrowUp");
  await input.press("ControlOrMeta+Enter");
  expect(actions).toEqual([]);
  await input.press("ControlOrMeta+A");
  await input.press("Backspace");
  await expectPromptText(input, "");
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
  await fillPromptText(input, "   ");
  await selectPromptText(input, 0, 3);
  await input.press("ArrowUp");
  await selectPromptText(input, 0);
  await input.press("ArrowUp");
  expect(actions).toEqual([]);
  await selectPromptText(input, 3);
  await input.press("ArrowUp");
  await expectPromptText(input, "随后处理第二条");
  expect(actions).toEqual(["take"]);
});

test("empty send shortcuts follow queue preference and mobile Enter remains a newline", async ({
  page,
}, info) => {
  const { open } = await fixture(page);
  await open();
  await menu(page);
  await queueMenu(page)
    .getByRole("menuitem", { name: "关闭排队", exact: true })
    .click();
  const input = page.getByLabel("消息", { exact: true });
  const actions: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(messages|queue)$/.test(request.url())
    )
      actions.push(request.postDataJSON().action ?? "messages");
  });
  await input.press("ControlOrMeta+Enter");
  expect(actions).toEqual([]);
  await expect(page.locator(".queue-item")).toHaveCount(2);
  await input.press("Enter");
  if (info.project.name === "desktop") {
    await expect(page.locator(".queue-item")).toHaveCount(1);
    expect(actions).toEqual(["steer"]);
    await expectPromptText(input, "");
  } else {
    await expectPromptText(input, "\n");
    await expect(page.locator(".queue-item")).toHaveCount(2);
    expect(actions).toEqual([]);
  }
});

test("keyboard queue actions never skip an unavailable queue edge", async ({
  page,
}) => {
  const { session, open } = await fixture(page);
  await page.route(`**/api/sessions/${session.id}/queue`, async (route) => {
    if (route.request().method() === "GET") {
      const response = await fetchLocalRoute(route);
      const data = await response.json();
      data.items[0].status = "uncertain";
      data.items[1].status = "sending";
      return route.fulfill({ response, json: data });
    }
    await route.continue();
  });
  await open();
  await expect(page.locator(".queue-item").first()).toHaveAttribute(
    "data-status",
    "uncertain",
  );
  const actions: object[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(messages|queue)$/.test(request.url())
    )
      actions.push(request.postDataJSON());
  });
  const input = page.getByLabel("消息", { exact: true });
  await input.press("ControlOrMeta+Enter");
  await input.press("ArrowUp");
  expect(actions).toEqual([]);
  await expectPromptText(input, "");
  await expect(page.locator(".queue-item")).toHaveCount(2);
});

test("keyboard recall deduplicates pending actions and preserves typing during removal", async ({
  page,
}) => {
  const { session, open, read } = await fixture(page);
  let release!: () => void;
  let takes = 0;
  let restores = 0;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/sessions/${session.id}/queue`, async (route) => {
    if (route.request().method() === "POST") {
      const action = route.request().postDataJSON().action;
      if (action === "take") {
        takes++;
        await gate;
      }
      if (action === "restore") restores++;
    }
    await route.continue();
  });
  await open();
  const input = page.getByLabel("消息", { exact: true });
  await input.press("ArrowUp");
  await expect.poll(() => takes).toBe(1);
  await input.press("ArrowUp");
  await input.press("ControlOrMeta+Enter");
  await fillPromptText(input, "请求等待期间的新草稿");
  release();
  await expect.poll(() => restores).toBe(1);
  await expect.poll(async () => (await read()).editing).toBeNull();
  await expectPromptText(input, "请求等待期间的新草稿");
  expect(takes).toBe(1);
  expect(
    (await read()).items.map((item: { text: string }) => item.text),
  ).toEqual(["先处理这一条", "随后处理第二条"]);
  await expect(page.locator(".queue-edit-notice")).toHaveCount(0);
});

test("empty queued steer preserves a newer draft and deduplicates until its response", async ({
  page,
}) => {
  const { session, open, read } = await fixture(page);
  let release!: () => void;
  let steers = 0;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/sessions/${session.id}/queue`, async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().action === "steer"
    ) {
      steers++;
      await gate;
    }
    await route.continue();
  });
  await open();
  const input = page.getByLabel("消息", { exact: true });
  await input.press("ControlOrMeta+Enter");
  await expect.poll(() => steers).toBe(1);
  await input.press("ControlOrMeta+Enter");
  await input.press("ArrowUp");
  await fillPromptText(input, "引导过程中输入的新草稿");
  release();
  await expect(page.locator(".queue-item")).toHaveCount(1);
  await expectPromptText(input, "引导过程中输入的新草稿");
  expect(steers).toBe(1);
  expect((await read()).items[0].text).toBe("随后处理第二条");
});

test("clearing an edited queue draft cannot steer or recall another row", async ({
  page,
}) => {
  const { open, read } = await fixture(page);
  await open();
  const input = page.getByLabel("消息", { exact: true });
  await input.press("ArrowUp");
  await expectPromptText(input, "随后处理第二条");
  await fillPromptText(input, "");
  const actions: object[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(messages|queue)$/.test(request.url())
    )
      actions.push(request.postDataJSON());
  });
  await input.press("ArrowUp");
  await input.press("ControlOrMeta+Enter");
  expect(actions).toEqual([]);
  expect((await read()).editing.text).toBe("随后处理第二条");
  await expect(page.locator(".queue-item")).toHaveCount(1);
  await expect(page.locator(".queue-edit-notice")).toBeVisible();
});

test("keyboard recall restores the original queue after switching chats during removal", async ({
  page,
}) => {
  const { session, open, read } = await fixture(page);
  const { session: other } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { cwd: session.cwd, agent: "fixture", title: "切换后保留新草稿" },
    })
  ).json();
  let release!: () => void;
  let started = false;
  let restored = false;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/sessions/${session.id}/queue`, async (route) => {
    if (route.request().method() === "POST") {
      const action = route.request().postDataJSON().action;
      if (action === "take") {
        started = true;
        await gate;
      }
      if (action === "restore") restored = true;
    }
    await route.continue();
  });
  await open();
  const input = page.getByLabel("消息", { exact: true });
  await input.press("ArrowUp");
  await expect.poll(() => started).toBe(true);
  await page.evaluate((id) => (location.hash = id), other.id);
  await expect(page.locator(".queue-item")).toHaveCount(0);
  await fillPromptText(input, "下一会话中的新草稿");
  release();
  await expect.poll(() => restored).toBe(true);
  await expect.poll(async () => (await read()).editing).toBeNull();
  await expectPromptText(input, "下一会话中的新草稿");
  await expect(page.locator(".queue-edit-notice")).toHaveCount(0);
  await expect(page.locator(".queue-item")).toHaveCount(0);
  expect(
    (await read()).items.map((item: { text: string }) => item.text),
  ).toEqual(["先处理这一条", "随后处理第二条"]);
});

test("an attached draft blocks queue recall and idle empty send leaves the queue untouched", async ({
  page,
}) => {
  const { session, open } = await fixture(page);
  await open();
  await page.locator('input[type="file"]').setInputFiles({
    name: "draft-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("主输入框附件"),
  });
  await expect(page.locator(".attachments")).toContainText("draft-note.txt");
  await expect(page.getByText("正在上传附件…", { exact: true })).toHaveCount(0);
  const input = page.getByLabel("消息", { exact: true });
  const actions: object[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(messages|queue)$/.test(request.url())
    )
      actions.push(request.postDataJSON());
  });
  await input.press("ArrowUp");
  expect(actions).toEqual([]);
  await expect(page.locator(".queue-item")).toHaveCount(2);
  await expect(page.locator(".attachments")).toContainText("draft-note.txt");
  await page.getByTitle("移除附件", { exact: true }).click();
  // Pause prevents the fixture from automatically draining the queued rows.
  await page.request.post(`/api/sessions/${session.id}/queue`, {
    headers,
    data: { action: "pause", paused: true },
  });
  await page.request.post(`/api/sessions/${session.id}/interrupt`, {
    headers,
    data: {},
  });
  await expect(page.getByTitle("中断", { exact: true })).toHaveCount(0);
  await input.press("ControlOrMeta+Enter");
  expect(actions).toEqual([]);
  await expect(page.locator(".queue-item")).toHaveCount(2);
  await input.press("ArrowUp");
  await expectPromptText(input, "随后处理第二条");
});

test("empty queued steer requires a confirmed running turn rather than a connecting session", async ({
  page,
}) => {
  const { session, open } = await fixture(page);
  await page.route(`**/api/sessions/${session.id}`, async (route) => {
    const response = await fetchLocalRoute(route);
    const data = await response.json();
    data.session.status = "starting";
    await route.fulfill({ response, json: data });
  });
  await open();
  await expect(
    page.getByText("正在连接 Agent…", { exact: true }),
  ).toBeVisible();
  const actions: object[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(messages|queue)$/.test(request.url())
    )
      actions.push(request.postDataJSON());
  });
  await page.getByLabel("消息", { exact: true }).press("ControlOrMeta+Enter");
  expect(actions).toEqual([]);
  await expect(page.locator(".queue-item")).toHaveCount(2);
});

test("queued steer confirmation preserves new typing and cancels when the turn becomes idle", async ({
  page,
}) => {
  const { session, open } = await fixture(page);
  await open();
  let release!: () => void;
  let confirmations = 0;
  let status = "running";
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/sessions/${session.id}`, async (route) => {
    confirmations++;
    await gate;
    const response = await fetchLocalRoute(route);
    const data = await response.json();
    data.session.status = status;
    await route.fulfill({ response, json: data });
  });
  const actions: object[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(messages|queue)$/.test(request.url())
    )
      actions.push(request.postDataJSON());
  });
  const input = page.getByLabel("消息", { exact: true });
  await input.press("ControlOrMeta+Enter");
  await expect.poll(() => confirmations).toBeGreaterThan(0);
  await input.press("ControlOrMeta+Enter");
  await input.press("ArrowUp");
  await fillPromptText(input, "确认状态期间继续输入");
  release();
  await expect(page.locator(".queue-item").first()).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expectPromptText(input, "确认状态期间继续输入");
  expect(actions).toEqual([]);
  await fillPromptText(input, "");
  status = "idle";
  const response = page.waitForResponse((response) =>
    response.url().endsWith(`/sessions/${session.id}`),
  );
  await input.press("ControlOrMeta+Enter");
  await response;
  await expect(page.getByTitle("中断", { exact: true })).toHaveCount(0);
  expect(actions).toEqual([]);
  await expect(page.locator(".queue-item")).toHaveCount(2);
});

test("closing queue changes future sends, preserves existing rows and survives refresh", async ({
  page,
}) => {
  const { open, read } = await fixture(page);
  await open();
  await menu(page);
  await queueMenu(page)
    .getByRole("menuitem", { name: "关闭排队", exact: true })
    .click();
  await expect(page.locator(".queue-item")).toHaveCount(2);
  const input = page.getByLabel("消息", { exact: true });
  const submitted: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/messages") && request.method() === "POST")
      submitted.push(request.postDataJSON().mode);
  });
  await fillPromptText(input, "立即引导");
  await page.getByTitle("发送", { exact: true }).click();
  await expectPromptText(input, "");
  expect(submitted).toEqual(["steer"]);
  expect(
    (await read()).items.map((item: { text: string }) => item.text),
  ).toEqual(["先处理这一条", "随后处理第二条"]);
  await page.reload();
  await expect(input).toBeEditable();
  await menu(page);
  await expect(
    queueMenu(page).getByRole("menuitem", { name: "开启排队", exact: true }),
  ).toBeVisible();
  await queueMenu(page)
    .getByRole("menuitem", { name: "开启排队", exact: true })
    .click();
  await fillPromptText(input, "新排队消息");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.locator(".queue-item")).toHaveCount(3);
  expect(submitted).toEqual(["steer", "queue"]);
});

test("editing protects a newer main draft while remove is pending and restores the original queue position", async ({
  page,
}) => {
  const { session, open, read } = await fixture(page);
  let release!: () => void;
  let started = false;
  let restored = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/sessions/${session.id}/queue`, async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().action === "take"
    ) {
      started = true;
      await gate;
    }
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().action === "restore"
    )
      restored = true;
    await route.continue();
  });
  await open();
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "原草稿");
  await menu(page);
  await queueMenu(page)
    .getByRole("menuitem", { name: "编辑消息", exact: true })
    .click();
  await expect.poll(() => started).toBe(true);
  await fillPromptText(input, "等待期间继续输入的新草稿");
  release();
  await expect.poll(() => restored).toBe(true);
  await expect.poll(async () => (await read()).editing).toBeNull();
  await expect(page.locator(".queue-item")).toHaveCount(2);
  await expectPromptText(input, "等待期间继续输入的新草稿");
  await expect(page.locator(".queue-edit-notice")).toHaveCount(0);
  expect(
    (await read()).items.map((item: { text: string }) => item.text),
  ).toEqual(["先处理这一条", "随后处理第二条"]);
});

test("failed queue editing leaves the queue and main draft intact", async ({
  page,
}) => {
  const { session, open } = await fixture(page);
  await page.route(`**/api/sessions/${session.id}/queue`, async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().action === "take"
    )
      return route.fulfill({
        status: 409,
        json: { error: "该消息正在发送，请稍后重试" },
      });
    await route.continue();
  });
  await open();
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "失败时保留的草稿");
  await menu(page);
  await queueMenu(page)
    .getByRole("menuitem", { name: "编辑消息", exact: true })
    .click();
  await expect(
    page.getByText("该消息正在发送，请稍后重试", { exact: true }),
  ).toBeVisible();
  await expectPromptText(input, "失败时保留的草稿");
  await expect(page.locator(".queue-item")).toHaveCount(2);
});

test("queue and live goal share the composer rail, support pause and deletion and hide complete goals", async ({
  page,
}, info) => {
  const { session, open } = await fixture(page);
  let goal: null | {
    objective: string;
    status: string;
    timeUsedSeconds: number;
    updatedAt: number;
  } = {
    objective: "任何时候、任何地方，完成任何工作。",
    status: "active",
    timeUsedSeconds: 65,
    updatedAt: Date.now() / 1000,
  };
  const changes: string[] = [];
  await page.route(`**/api/sessions/${session.id}/composer`, async (route) => {
    if (route.request().method() === "POST") {
      const data = route.request().postDataJSON();
      changes.push(data.action);
      if (data.action === "clear_goal") goal = null;
      if (data.action === "goal_status" && goal)
        goal = { ...goal, status: data.status };
    }
    await route.fulfill({ json: { goal, plan: false, plan_available: true } });
  });
  await open();
  const rail = page.locator(".composer-context"),
    banner = rail.getByLabel("持续目标", { exact: true });
  await expect(banner).toBeVisible();
  const actions = banner.locator(".goal-banner-actions button");
  expect(
    await actions.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    ),
  ).toEqual(["清除目标", "暂停目标", "编辑目标"]);
  const progress = banner.getByLabel("目标进度");
  const before = await progress.innerText();
  await expect(progress).not.toHaveText(before);
  const queueBox = (await rail.locator(".message-queue").boundingBox())!,
    goalBox = (await banner.boundingBox())!,
    composerBox = (await page.locator(".composer").boundingBox())!;
  expect(goalBox.y).toBeGreaterThanOrEqual(queueBox.y + queueBox.height);
  expect(goalBox.y + goalBox.height).toBeLessThanOrEqual(composerBox.y + 5);
  expect(goalBox.x).toBeGreaterThanOrEqual(0);
  expect(goalBox.x + goalBox.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await menu(page);
  await page.screenshot({
    path: `artifacts/anywork-queue-goal-${info.project.name}.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await banner.getByRole("button", { name: "暂停目标", exact: true }).click();
  await expect(banner).toContainText("目标已暂停");
  await banner.getByRole("button", { name: "恢复目标", exact: true }).click();
  await expect(banner).toContainText("进行中的目标");
  await banner.getByRole("button", { name: "清除目标", exact: true }).click();
  await expect(banner).toHaveCount(0);
  await expect(rail.locator(".queue-item")).toHaveCount(2);
  expect(changes).toEqual(["goal_status", "goal_status", "clear_goal"]);
  goal = {
    objective: "已经完成的目标",
    status: "complete",
    timeUsedSeconds: 65,
    updatedAt: Date.now() / 1000,
  };
  await page.reload();
  await expect(page.locator(".queue-item")).toHaveCount(2);
  await expect(banner).toHaveCount(0);
});
