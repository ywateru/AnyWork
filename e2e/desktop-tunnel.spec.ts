import { test, expect } from "@playwright/test";
import { manager, calls, signInFixture } from "./desktop-fixture";
test("login leaves remote off until explicit enable and identity remains verifiable", async ({
  page,
}) => {
  await manager(page);
  await expect(page.getByText("远程访问未开启", { exact: true })).toBeVisible();
  expect(await calls(page)).toEqual(["desktop_start"]);
  await page.getByRole("button", { name: "开启远程访问", exact: true }).click();
  await expect(page.getByText("远程访问已开启", { exact: true })).toBeVisible();
  await page.getByText("本机身份核对", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "设备身份", exact: true }),
  ).toHaveValue("public-installation");
  await expect(
    page.getByRole("textbox", { name: "设备公钥", exact: true }),
  ).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "关闭远程访问", exact: true }).click();
  await expect(page.getByText("远程访问未开启", { exact: true })).toBeVisible();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable",
    "account_disable",
  ]);
});
test("remote configuration failure is fixed, visible and retries only on click", async ({
  page,
}) => {
  await manager(page, { failEnable: true });
  await page.getByRole("button", { name: "开启远程访问", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "REMOTE_ENABLE_GRID_CONFIG",
  );
  await page.waitForTimeout(1200);
  expect(await calls(page)).toEqual(["desktop_start", "account_enable"]);
  await page.getByRole("button", { name: "开启远程访问", exact: true }).click();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable",
    "account_enable",
  ]);
});
test("logout returns to account, preserving the running local service", async ({
  page,
}) => {
  await manager(page, { enabled: true });
  await page.getByRole("button", { name: "退出账号", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开本地工作区", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { desktopFixture: { service: string } })
          .desktopFixture.service,
    ),
  ).toBe("running");
  expect(await calls(page)).toEqual(["desktop_start", "account_logout"]);
  await signInFixture(page);
  await expect(
    page.getByRole("heading", { name: "这台电脑的工作区", exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_logout",
    "desktop_start",
  ]);
});
test("pending authorization can cancel without starting", async ({ page }) => {
  await manager(page, { stage: "account", authorizing: true });
  await page.getByRole("button", { name: "取消登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual(["account_cancel"]);
});
test("reauthorization ends the old authorization before login", async ({
  page,
}) => {
  await manager(page, { stage: "account", reauth: true });
  await page
    .getByRole("button", { name: "结束本次授权后重新登录", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual(["account_logout"]);
});
test("unsupported platform explains the limitation and cannot start or open", async ({
  page,
}) => {
  await manager(page, { stage: "account", unsupported: true });
  await expect(
    page.getByText("当前平台暂不支持账号远程访问", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/本应用不会跳过账号验证/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /登录已有账号|打开本地工作区/ }),
  ).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
});
test("registration and login remain retryable after broker failure", async ({
  page,
}) => {
  await manager(page, { stage: "account" });
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "创建账号", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "登录已有账号", exact: true }).click();
  expect(await calls(page)).toEqual(["account_begin", "account_begin"]);
});
test("active remote clients are live account data, not historical manager heartbeats", async ({
  page,
}, info) => {
  await manager(page, {
    enabled: true,
    remoteClients: [
      { id: "one", kind: "ios", connectedAt: 1794300000 },
      { id: "two", kind: "desktop", connectedAt: 1794300060 },
      { id: "three", kind: "unknown", connectedAt: 1794300065 },
    ],
  });
  const region = page.getByRole("region", {
    name: "正在连接这台电脑的设备",
    exact: true,
  });
  await expect(region.getByRole("listitem")).toHaveCount(3);
  await expect(
    region.getByText("iPhone / iPad 浏览器", { exact: true }),
  ).toBeVisible();
  await expect(region.getByText("网页客户端", { exact: true })).toHaveCount(2);
  await expect(region.getByText("3 个活动连接", { exact: true })).toBeVisible();
  await expect(
    region.getByText("historical-local-client-not-remote"),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("connected-clients.png"),
    fullPage: true,
  });
  await page.evaluate(
    () =>
      ((
        window as unknown as { accountFixture: { remoteClients: unknown[] } }
      ).accountFixture.remoteClients = []),
  );
  await expect(
    region.getByText("还没有远程设备连接", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭远程访问", exact: true }).click();
  await expect(region.getByText(/远程访问已关闭/)).toBeVisible();
});
test("unavailable account snapshot never invents zero clients or permits new open", async ({
  page,
}) => {
  await manager(page, {
    enabled: true,
    remoteClients: [{ id: "one", kind: "android", connectedAt: 1794300000 }],
  });
  const region = page.getByRole("region", {
    name: "正在连接这台电脑的设备",
    exact: true,
  });
  await expect(
    region.getByText("Android 浏览器", { exact: true }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      ((
        window as unknown as { accountSnapshotFailure: boolean }
      ).accountSnapshotFailure = true),
  );
  await expect(
    region.getByText("连接状态暂不可用", { exact: true }),
  ).toBeVisible();
  await expect(region.getByRole("listitem")).toHaveCount(0);
  await expect(
    region.getByText("还没有远程设备连接", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打开本地工作区", exact: true }),
  ).toBeDisabled();
  expect(await calls(page)).toEqual(["desktop_start"]);
  await page.evaluate(
    () =>
      ((
        window as unknown as { accountSnapshotFailure: boolean }
      ).accountSnapshotFailure = false),
  );
  await expect(
    region.getByText("Android 浏览器", { exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual(["desktop_start"]);
});
test("missing or malformed remote client data is unavailable rather than empty", async ({
  page,
}) => {
  await manager(page, { enabled: true });
  await page.evaluate(
    () =>
      delete (
        window as unknown as { accountFixture: { remoteClients?: unknown[] } }
      ).accountFixture.remoteClients,
  );
  await expect(
    page.getByText("连接状态暂不可用", { exact: true }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      ((
        window as unknown as { accountFixture: { remoteClients: unknown[] } }
      ).accountFixture.remoteClients = [
        { id: "bad", kind: "invented-phone", connectedAt: 0 },
      ]),
  );
  await expect(
    page.getByText("连接状态暂不可用", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0 个活动连接", { exact: true })).toHaveCount(0);
});
