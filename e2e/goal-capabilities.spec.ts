import { expect, test, type Page } from "@playwright/test";
import { expectPromptText, fillPromptText } from "./prompt-editor-helpers";
const headers = { Authorization: "Bearer browser-integration-test-token" };
const reason =
  "当前桌面的会话跟随接口只支持读取和暂停目标；新建、恢复、编辑和删除目标需要以共享引擎方式启动桌面。输入和附件已保留，未发送消息。";
async function fixture(page: Page, existing = false, draftMode = false) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const { session } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { cwd: workspace, agent: "fixture", title: "目标能力验收" },
    })
  ).json();
  const path = `/api/sessions/${session.id}/composer`;
  if (existing)
    await page.request.post(path, {
      headers,
      data: { action: "goal", objective: "保留原生目标" },
    });
  await page.route(`**${path}*`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        goal_capabilities: {
          create: false,
          edit: false,
          resume: false,
          clear: false,
          pause: true,
          reason,
        },
      },
    });
  });
  await page.addInitScript(
    ({ id, mode }) => {
      localStorage.setItem(
        "ra.connection",
        JSON.stringify({
          url: location.origin,
          token: "browser-integration-test-token",
        }),
      );
      localStorage.setItem("ra.sidebar-pinned", "false");
      if (mode)
        sessionStorage.setItem(
          "anywork.goal-composer." + JSON.stringify([location.origin, id]),
          "true",
        );
    },
    { id: session.id, mode: draftMode },
  );
  await page.goto(`/#${session.id}`);
  await expect(page.getByLabel("消息", { exact: true })).toBeEditable();
  return { session, path };
}
test("unsupported goal selection explains the route and retains the text plus attachment without sending", async ({
  page,
}) => {
  await fixture(page);
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/messages$|\/queue$/.test(r.url()))
      requests.push(r.url());
  });
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "保留我的目标草稿",
  );
  await page.locator('.composer input[type="file"]').setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR6kAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.locator(".attachment-pending")).toHaveCount(0);
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "添加内容与模式" }),
  ).toContainText("当前连接暂不支持新建目标");
  await page
    .getByRole("group", { name: "添加内容与模式" })
    .getByRole("button", { name: /目标/ })
    .click();
  await expect(page.locator(".composer-add-error")).toContainText("未发送消息");
  await expectPromptText(
    page.getByLabel("消息", { exact: true }),
    "保留我的目标草稿",
  );
  await expect(page.locator(".attachments")).toContainText("reference.png");
  expect(requests).toEqual([]);
});
test("restored goal mode blocks send; existing goals remain readable with pause supported and unsupported changes disabled", async ({
  page,
}) => {
  const { path } = await fixture(page, true, true);
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "旧目标模式中的输入",
  );
  await expect(page.getByTitle("发送", { exact: true })).toBeDisabled();
  await expect(page.locator(".composer > .composer-add-error")).toContainText(
    "未发送消息",
  );
  const banner = page.locator(".goal-banner");
  await expect(banner.getByRole("button", { name: "清除目标" })).toBeDisabled();
  await expect(banner.getByRole("button", { name: "暂停目标" })).toBeEnabled();
  await banner.getByRole("button", { name: "编辑目标", exact: true }).click();
  const editor = page.locator(".goal-editor-panel");
  await expect(editor.getByRole("status")).toContainText("共享引擎");
  await fillPromptText(
    editor.getByLabel("目标", { exact: true }),
    "不能悄悄保存",
  );
  await expect(
    editor.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await page.request.post(path, {
    headers,
    data: { action: "goal_status", status: "paused" },
  });
  await page.reload();
  await expect(
    banner.getByRole("button", { name: "恢复目标", includeHidden: true }),
  ).toBeDisabled();
});
