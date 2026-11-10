import { test, expect } from "@playwright/test";
import { manager, calls } from "./desktop-fixture";

for (const [width, height] of [
  [1440, 1000],
  [960, 720],
  [800, 620],
  [390, 844],
]) {
  test(`unified workspace and account remain usable at ${width}×${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await manager(page);
    await expect(
      page.getByRole("region", { name: "本地工作区", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "打开工作区", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "注册", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "开启远程访问", exact: true }),
    ).toBeDisabled();
    await expect(page.getByText(/账号凭据和设备私钥只留在内存/)).toBeVisible();
    await expect(page.locator(".route-node, .network-map")).toHaveCount(0);
    await expect(
      page.getByText(/匿名隧道|固定隧道|WireGuard|连接器令牌|配对二维码/),
    ).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: info.outputPath(`workspace-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "工作目录", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "服务数据目录", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: /密钥|令牌|HTTPS|中继/ }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: info.outputPath(`settings-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "这台电脑", exact: true }),
    ).toBeVisible();
  });
}

test("opening local workspace is a single action without cloud login", async ({
  page,
}) => {
  await manager(page, { off: true, holdOpen: true });
  await page.getByRole("button", { name: "打开工作区", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "正在打开…", exact: true }),
  ).toBeDisabled();
  expect(await calls(page)).toEqual(["desktop_open"]);
  await page.evaluate(() =>
    (window as unknown as { finishOpen: () => void }).finishOpen(),
  );
  await expect(
    page.getByRole("button", { name: "打开工作区", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("尚未登录", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开启远程访问", exact: true }),
  ).toBeDisabled();
});

test("failed local handoff gives feedback and permits manual retry", async ({
  page,
}) => {
  await manager(page, { failOpen: true });
  for (let n = 1; n <= 2; n++) {
    await page.getByRole("button", { name: "打开工作区", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "无法建立本机浏览器会话",
    );
    expect(await calls(page)).toHaveLength(n);
  }
});

test("settings preserve an unsaved draft through polling and save without a token", async ({
  page,
}) => {
  await manager(page, { off: true });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const workspace = page.getByRole("textbox", {
    name: "工作目录",
    exact: true,
  });
  await workspace.fill("/workspace/next");
  await page.waitForTimeout(1200);
  await expect(workspace).toHaveValue("/workspace/next");
  await page.getByRole("button", { name: "保存本机设置", exact: true }).click();
  await expect.poll(() => calls(page)).toEqual(["desktop_action:save_service"]);
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(page.locator(".workspace-path")).toContainText(
    "/workspace/next",
  );
});

test("save failures are visible", async ({ page }) => {
  await manager(page, { failSave: true });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "保存本机设置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存失败");
});

test("external service is reused without exposing a stop control", async ({
  page,
}) => {
  await manager(page);
  await expect(
    page.getByText("已就绪 · 复用已有服务", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止本地服务", exact: true }),
  ).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
});

test("owned service may stop and cannot change running directories", async ({
  page,
}) => {
  await manager(page, { owned: true });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存本机设置", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "停止本地服务", exact: true }).click();
  await expect.poll(() => calls(page)).toEqual(["desktop_action:stop_server"]);
  await expect(
    page.getByRole("button", { name: "停止本地服务", exact: true }),
  ).toHaveCount(0);
});
