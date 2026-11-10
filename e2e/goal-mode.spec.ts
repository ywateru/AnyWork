import { expect, test, type Page } from "./local-fixture";
import {
  expectPromptText,
  fillPromptText,
  pastePromptText,
} from "./prompt-editor-helpers";

const headers = { Authorization: "Bearer browser-integration-test-token" };
const image = {
  name: "goal-reference.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR6kAAAAASUVORK5CYII=",
    "base64",
  ),
};
const input = (page: Page) =>
  page.getByRole("textbox", { name: "消息", exact: true });
const chip = (page: Page) =>
  page.getByRole("button", { name: "退出目标模式", exact: true });
async function fixture(page: Page) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const create = async () =>
    (
      await (
        await page.request.post("/api/sessions", {
          headers,
          data: { cwd: workspace, agent: "fixture", title: "目标输入模式验收" },
        })
      ).json()
    ).session;
  const session = await create();
  await page.addInitScript(() => {
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  await page.goto(`/#${session.id}`);
  await expect(input(page)).toBeEditable();
  return { session, create, endpoint: `/api/sessions/${session.id}` };
}
async function goalMode(page: Page) {
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page
    .getByRole("group", { name: "添加内容与模式" })
    .getByRole("button", { name: /目标/ })
    .click();
  await expect(chip(page)).toBeVisible();
}
async function upload(page: Page) {
  await page.locator('.composer input[type="file"]').setInputFiles(image);
  await expect(page.locator(".attachments")).toContainText(image.name);
  await expect(page.locator(".attachment-pending")).toHaveCount(0);
}

test("goal mode shares one rich composer, keeps attachments on cancel and submits through normal send", async ({
  page,
}, testInfo) => {
  const { endpoint } = await fixture(page);
  await pastePromptText(
    input(page),
    "保留富文本目标",
    "<p><strong>保留富文本目标</strong></p>",
  );
  await upload(page);
  await goalMode(page);
  await expect(
    page.getByRole("dialog", { name: "设置目标", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".composer").getByRole("textbox")).toHaveCount(1);
  await expect(input(page).locator("strong")).toHaveText("保留富文本目标");
  await chip(page).click();
  await expect(chip(page)).toHaveCount(0);
  await expect(input(page).locator("strong")).toHaveText("保留富文本目标");
  await expect(page.locator(".attachments")).toContainText(image.name);
  await goalMode(page);
  expect(
    await page
      .locator(".composer")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/anywork-goal-mode-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const submitted = page.waitForRequest(
    (r) => r.url().endsWith("/messages") && r.method() === "POST",
  );
  await page.getByTitle("发送", { exact: true }).click();
  expect((await submitted).postDataJSON()).toMatchObject({
    text: "**保留富文本目标**",
    goal: true,
  });
  await expect(chip(page)).toHaveCount(0);
  await expectPromptText(input(page), "");
  await expect(page.locator(".attachments")).toHaveCount(0);
  await expect(page.locator(".goal-banner")).toContainText("进行中的目标");
  const { goal } = await (
    await page.request.get(endpoint + "/composer", { headers })
  ).json();
  expect(goal.objective).toContain("Referenced image files:");
  expect(goal.objective).toContain("**保留富文本目标**");
});

test("image-only goal sends and activates without requiring separate objective text", async ({
  page,
}) => {
  const { endpoint } = await fixture(page);
  await goalMode(page);
  await upload(page);
  await expect(page.getByTitle("发送", { exact: true })).toBeEnabled();
  await page.getByTitle("发送", { exact: true }).click();
  await expect(chip(page)).toHaveCount(0);
  await expect(page.locator(".goal-banner")).toContainText("进行中的目标");
  const { goal } = await (
    await page.request.get(endpoint + "/composer", { headers })
  ).json();
  expect(goal.objective).toMatch(/^Referenced image files:\n- \[Image #1\]: /);
});

test("failed delivery keeps goal draft, while accepted input with activation warning clears it once", async ({
  page,
}) => {
  const { endpoint } = await fixture(page);
  await goalMode(page);
  await fillPromptText(input(page), "保留失败草稿");
  await upload(page);
  await page.route("**/messages", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "fixture delivery rejected" }),
    }),
  );
  await page.getByTitle("发送", { exact: true }).click();
  await expect(
    page.getByText("fixture delivery rejected", { exact: true }),
  ).toBeVisible();
  await expect(chip(page)).toBeVisible();
  await expectPromptText(input(page), "保留失败草稿");
  await expect(page.locator(".attachments")).toContainText(image.name);
  await page.unroute("**/messages");
  // Real engine fixture accepts the message but rejects the separate goal mutation.
  await page.getByTitle("移除附件", { exact: true }).click();
  await fillPromptText(input(page), "goal-activation-rejected");
  let sends = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/messages") && r.method() === "POST") sends++;
  });
  await page.getByTitle("发送", { exact: true }).click();
  await expect(
    page.getByText(/消息已发送，但启用目标未确认/).first(),
  ).toBeVisible();
  await expect(chip(page)).toHaveCount(0);
  await expectPromptText(input(page), "");
  expect(sends).toBe(1);
  const { goal } = await (
    await page.request.get(endpoint + "/composer", { headers })
  ).json();
  expect(goal).toBeNull();
});

test("goal mode follows the chat draft across refresh and chat switches", async ({
  page,
}) => {
  const { session, create } = await fixture(page);
  await goalMode(page);
  await fillPromptText(input(page), "此会话的目标草稿");
  await page.reload();
  await expect(chip(page)).toBeVisible();
  await expectPromptText(input(page), "此会话的目标草稿");
  const other = await create();
  await page.goto(`/#${other.id}`);
  await expectPromptText(input(page), "");
  await expect(chip(page)).toHaveCount(0);
  await page.goto(`/#${session.id}`);
  await expect(chip(page)).toBeVisible();
  await expectPromptText(input(page), "此会话的目标草稿");
});

test("queued goal edit restores its mode, undo restores previous mode and refresh preserves a removed chip", async ({
  page,
}) => {
  const { endpoint } = await fixture(page);
  await page.request.post(endpoint + "/messages", {
    headers,
    data: { text: "slow" },
  });
  await page.reload();
  await expect(page.getByTitle("中断", { exact: true })).toBeVisible();
  await goalMode(page);
  await fillPromptText(input(page), "排队目标");
  await page.getByTitle("发送", { exact: true }).click();
  const queued = page.locator(".queue-item").filter({ hasText: "排队目标" });
  await expect(queued.locator(".queue-goal-label")).toHaveText("目标");
  await expect(chip(page)).toHaveCount(0);
  await fillPromptText(input(page), "已有普通草稿");
  await queued.locator('summary[aria-label="排队消息选项"]').click();
  await page.getByRole("menuitem", { name: "编辑消息", exact: true }).click();
  await expect(chip(page)).toBeVisible();
  await expectPromptText(input(page), "排队目标");
  await page
    .locator(".queue-edit-notice")
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  await expect(chip(page)).toHaveCount(0);
  await expectPromptText(input(page), "已有普通草稿");
  await queued.locator('summary[aria-label="排队消息选项"]').click();
  await page.getByRole("menuitem", { name: "编辑消息", exact: true }).click();
  await chip(page).click();
  await page.reload();
  await expect(page.locator(".queue-edit-notice")).toBeVisible();
  await expect(chip(page)).toHaveCount(0);
  await expectPromptText(input(page), "排队目标");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(queued).toBeVisible();
  await expect(queued.locator(".queue-goal-label")).toHaveCount(0);
});
