import { test, expect } from "@playwright/test";
import { manager, calls, signInFixture } from "./desktop-fixture";
for (const [width, height] of [
  [1440, 1000],
  [960, 720],
  [800, 620],
  [390, 844],
]) {
  test(`onboarding and console at ${width}×${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await manager(page, {
      stage: "intro",
      signedIn: false,
      off: true,
      holdStart: true,
    });
    expect(await calls(page)).toEqual([]);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: info.outputPath(`intro-${width}.png`),
      fullPage: true,
    });
    await expect(
      page.getByRole("button", { name: "开始使用", exact: true }),
    ).toBeInViewport();
    await page.getByRole("button", { name: "开始使用", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "登录已有账号", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`account-${width}.png`),
      fullPage: true,
    });
    await signInFixture(page);
    await expect.poll(() => calls(page)).toEqual(["desktop_start"]);
    await expect(
      page.getByRole("heading", { name: "正在准备你的工作区", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`preparing-${width}.png`),
      fullPage: true,
    });
    await page.evaluate(() => {
      const w = window as unknown as {
        failStart: boolean;
        pendingStarts: (() => void)[];
      };
      w.failStart = true;
      w.pendingStarts[0]();
    });
    await expect(
      page.getByRole("button", { name: "重试准备", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`preparation-error-${width}.png`),
      fullPage: true,
    });
    await page.evaluate(
      () => ((window as unknown as { failStart: boolean }).failStart = false),
    );
    await page.getByRole("button", { name: "重试准备", exact: true }).click();
    await expect
      .poll(() => calls(page))
      .toEqual(["desktop_start", "desktop_start"]);
    await page.evaluate(() =>
      (
        window as unknown as { pendingStarts: (() => void)[] }
      ).pendingStarts[1](),
    );
    await expect(
      page.getByRole("heading", { name: "这台电脑的工作区", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => calls(page))
      .toEqual(["desktop_start", "desktop_start", "account_enable_default"]);
    await expect(page.getByTestId("local-address")).toHaveText(
      "http://127.0.0.1:3210/",
    );
    await expect(
      page.getByRole("button", { name: "打开本地工作区", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/本客户端的账号凭据和设备私钥只留在内存/),
    ).toHaveCount(0);
    await expect(
      page.getByText(/匿名隧道|固定隧道|WireGuard|连接器令牌|配对二维码/),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.evaluate(() =>
      Object.assign(
        (window as unknown as { accountFixture: object }).accountFixture,
        {
          enabled: true,
          installationId: "public-installation",
          publicKey: "public-key",
          remoteClients: [
            { id: "phone", kind: "ios", connectedAt: 1794300000 },
            { id: "web", kind: "desktop", connectedAt: 1794300060 },
          ],
        },
      ),
    );
    await expect(page.getByText("2 个活动连接", { exact: true })).toBeVisible();
    await expect(
      page.getByText("iPhone / iPad 浏览器", { exact: true }),
    ).not.toBeVisible();
    if (width >= 800) {
      await expect(
        page.getByRole("button", { name: "打开本地工作区", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "关闭远程访问", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByText("2 个活动连接", { exact: true }),
      ).toBeInViewport();
    }
    await page.screenshot({
      path: info.outputPath(`console-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "工作目录", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: /密钥|令牌|HTTPS|中继/ }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.getByText("连接与隐私说明", { exact: true }).click();
    await expect(
      page.getByText(/本客户端的账号凭据和设备私钥只留在内存/),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`settings-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "这台电脑的工作区", exact: true }),
    ).toBeVisible();
  });
}
test("introduction precedes account and preparation even for an existing ready service", async ({
  page,
}) => {
  await manager(page, { stage: "intro", signedIn: false });
  await page.waitForTimeout(1200);
  expect(await calls(page)).toEqual([]);
  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual([]);
  await expect(
    page.getByRole("button", { name: /打开本地工作区|开启远程访问/ }),
  ).toHaveCount(0);
  await signInFixture(page);
  await expect(
    page.getByRole("heading", { name: "这台电脑的工作区", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1200);
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
  ]);
});
test("preparation failure needs explicit retry and never opens the browser", async ({
  page,
}) => {
  await manager(page, {
    stage: "prepare",
    signedIn: true,
    off: true,
    failStart: true,
  });
  await expect(
    page.getByRole("button", { name: "重试准备", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1200);
  expect(await calls(page)).toEqual(["desktop_start"]);
  await page.evaluate(
    () => ((window as unknown as { failStart: boolean }).failStart = false),
  );
  await page.getByRole("button", { name: "重试准备", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "这台电脑的工作区", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => calls(page))
    .toEqual(["desktop_start", "desktop_start", "account_enable_default"]);
});
test("late preparation from logout cannot ready the next same-account login", async ({
  page,
}) => {
  await manager(page, {
    stage: "prepare",
    signedIn: true,
    holdStart: true,
    off: true,
  });
  await expect.poll(() => calls(page)).toEqual(["desktop_start"]);
  await page.getByRole("button", { name: "退出账号", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeVisible();
  await signInFixture(page);
  await expect
    .poll(() => calls(page))
    .toEqual(["desktop_start", "account_logout", "desktop_start"]);
  await page.evaluate(() =>
    (window as unknown as { pendingStarts: (() => void)[] }).pendingStarts[0](),
  );
  await page.waitForTimeout(1200);
  await expect(
    page.getByRole("heading", { name: "正在准备你的工作区", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { pendingStarts: (() => void)[] }).pendingStarts[1](),
  );
  await expect(
    page.getByRole("heading", { name: "这台电脑的工作区", exact: true }),
  ).toBeVisible();
});
test("a poll begun before logout cannot resurrect signed-in state", async ({
  page,
}) => {
  await manager(page);
  await page.evaluate(
    () =>
      ((
        window as unknown as { holdNextAccountSnapshot: boolean }
      ).holdNextAccountSnapshot = true),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as unknown as { releaseAccountSnapshot?: () => void })
            .releaseAccountSnapshot,
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "退出账号", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { releaseAccountSnapshot: () => void }
    ).releaseAccountSnapshot(),
  );
  await page.waitForTimeout(1200);
  await expect(
    page.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
    "account_logout",
  ]);
});
test("open uses only the browser handoff and supports explicit retry", async ({
  page,
}) => {
  await manager(page, { failOpen: true });
  for (let n = 1; n <= 2; n++) {
    await page
      .getByRole("button", { name: "打开本地工作区", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "无法建立本机浏览器会话",
    );
    expect(await calls(page)).toHaveLength(n + 2);
  }
});
test("settings preserve drafts and service ownership", async ({ page }) => {
  await manager(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const field = page.getByRole("textbox", { name: "工作目录", exact: true });
  await field.fill("/workspace/next");
  await page.waitForTimeout(1200);
  await expect(field).toHaveValue("/workspace/next");
  await expect(
    page.getByRole("button", { name: "停止本地服务", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "保存本机设置", exact: true }).click();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
    "desktop_action:save_service",
  ]);
});
test("owned service settings keep stop and running-directory constraints", async ({
  page,
}) => {
  await manager(page, { owned: true });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存本机设置", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "停止本地服务", exact: true }).click();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
    "desktop_action:stop_server",
  ]);
});

test("a new UI runtime always introduces itself even with a retained native grant", async ({
  page,
}) => {
  await manager(page, { stage: "intro", signedIn: true });
  await page.waitForTimeout(1200);
  expect(await calls(page)).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "AnyWork 功能介绍", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1200);
  expect(await calls(page)).toEqual([]);
  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "这台电脑的工作区", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => calls(page))
    .toEqual(["desktop_start", "account_enable_default"]);
});
test("a pending local browser handoff remains a single action", async ({
  page,
}) => {
  await manager(page, { holdOpen: true });
  await page
    .getByRole("button", { name: "打开本地工作区", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "正在打开…", exact: true }),
  ).toBeDisabled();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
    "desktop_open",
  ]);
  await page.evaluate(() =>
    (window as unknown as { finishOpen: () => void }).finishOpen(),
  );
  await expect(
    page.getByRole("button", { name: "打开本地工作区", exact: true }),
  ).toBeEnabled();
});
test("settings failures are visible without losing the current phase", async ({
  page,
}) => {
  await manager(page, { failSave: true });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "保存本机设置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存失败");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "这台电脑的工作区", exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
    "desktop_action:save_service",
  ]);
});
