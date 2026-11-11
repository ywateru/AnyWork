import { test, expect } from "@playwright/test";
import {
  manager as prepareManager,
  calls,
  signInFixture,
  desktopNavigate,
  desktopLogout,
} from "./desktop-fixture";
const manager: typeof prepareManager = async (page, options = {}) => {
  await prepareManager(page, options);
  if (!options.stage || options.stage === "console")
    await desktopNavigate(page, "远程访问");
};
test("login prepares remote by default and identity remains verifiable", async ({
  page,
}) => {
  await manager(page);
  await expect(page.getByText("远程访问已开启", { exact: true })).toBeVisible();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
  ]);
  await page.getByText("本机身份核对", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "设备身份", exact: true }),
  ).toHaveValue("public-installation");
  await expect(
    page.getByRole("textbox", { name: "设备公钥", exact: true }),
  ).toHaveAttribute("readonly", "");
  await page.getByRole("switch", { name: "关闭远程访问", exact: true }).click();
  await expect(page.getByText("远程访问未开启", { exact: true })).toBeVisible();
  await desktopNavigate(page, "设置");
  await desktopNavigate(page, "远程访问");
  await page.waitForTimeout(1200);
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
    "account_disable",
  ]);
  await page.reload();
  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  await desktopNavigate(page, "远程访问");
  await expect(page.getByText("远程访问未开启", { exact: true })).toBeVisible();
  await expect
    .poll(() => calls(page))
    .toEqual(["desktop_start", "account_enable_default"]);
  await page.getByRole("switch", { name: "开启远程访问", exact: true }).click();
  await expect(page.getByText("远程访问已开启", { exact: true })).toBeVisible();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
    "account_enable",
  ]);
});
test("default failure leaves local access usable and details and retries require clicks", async ({
  page,
}) => {
  await manager(page, { failEnable: true });
  await expect(page.getByRole("alert")).toContainText(
    "设备协调服务配置校验未通过",
  );
  await expect(
    page.getByText("REMOTE_ENABLE_GRID_CONFIG", { exact: true }),
  ).not.toBeVisible();
  await page.getByText("诊断详情", { exact: true }).click();
  await expect(
    page.getByText("REMOTE_ENABLE_GRID_CONFIG", { exact: true }),
  ).toBeVisible();
  await desktopNavigate(page, "工作区");
  await page
    .getByRole("button", { name: "打开本地工作区", exact: true })
    .click();
  await page.waitForTimeout(1200);
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
    "desktop_open",
  ]);
  await desktopNavigate(page, "远程访问");
  await page.getByRole("switch", { name: "重试开启远程", exact: true }).click();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
    "desktop_open",
    "account_enable",
  ]);
});
test("same-account portal actions preserve a pending or visible remote failure", async ({
  page,
}) => {
  await manager(page, { holdEnable: true, failEnable: true });
  await expect(
    page.getByText("正在准备远程访问…", { exact: true }),
  ).toBeVisible();
  const portal = page.getByRole("button", {
    name: "打开账号入口",
    exact: true,
  });
  await portal.click();
  await expect(portal).toBeEnabled();
  await page.evaluate(() =>
    (
      window as unknown as { pendingEnables: (() => void)[] }
    ).pendingEnables[0](),
  );
  await expect(page.getByRole("alert")).toContainText(
    "设备协调服务配置校验未通过",
  );
  await expect(
    page.getByRole("switch", { name: "重试开启远程", exact: true }),
  ).toBeEnabled();
  await page.getByText("诊断详情", { exact: true }).click();
  await expect(
    page.getByText("REMOTE_ENABLE_GRID_CONFIG", { exact: true }),
  ).toBeVisible();
  await portal.click();
  await expect(portal).toBeEnabled();
  await expect(page.getByRole("alert")).toContainText(
    "设备协调服务配置校验未通过",
  );
  await expect(
    page.getByText("REMOTE_ENABLE_GRID_CONFIG", { exact: true }),
  ).toBeVisible();
  await desktopLogout(page);
  await expect(
    page.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("pending default remote does not block local open, settings or logout", async ({
  page,
}) => {
  await manager(page, { holdEnable: true, failEnable: true });
  await expect(
    page.getByText("正在准备远程访问…", { exact: true }),
  ).toBeVisible();
  await desktopNavigate(page, "工作区");
  await page
    .getByRole("button", { name: "打开本地工作区", exact: true })
    .click();
  await desktopNavigate(page, "设置");
  await expect(page.getByText("连接与隐私说明", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await desktopLogout(page);
  await expect(
    page.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { pendingEnables: (() => void)[] }
    ).pendingEnables[0](),
  );
  await page.waitForTimeout(1200);
  await expect(
    page.getByRole("button", { name: "打开本地工作区", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
    "desktop_open",
    "account_logout",
  ]);
});
test("logout returns to account, preserving the running local service", async ({
  page,
}) => {
  await manager(page, { enabled: true });
  await desktopLogout(page);
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
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
    "account_logout",
  ]);
  await signInFixture(page);
  await expect(
    page.getByRole("heading", { name: "这台电脑", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => calls(page))
    .toEqual([
      "desktop_start",
      "account_enable_default",
      "account_logout",
      "desktop_start",
      "account_enable_default",
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
  await expect(region.getByRole("listitem").first()).not.toBeVisible();
  await region.locator("summary").click();
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
  await page.getByRole("switch", { name: "关闭远程访问", exact: true }).click();
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
  await region.locator("summary").click();
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
  await expect(page.getByText("状态未知", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: /远程/ })).toHaveCount(0);
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
  ]);
  await page.evaluate(
    () =>
      ((
        window as unknown as { accountSnapshotFailure: boolean }
      ).accountSnapshotFailure = false),
  );
  await expect(
    region.getByText("Android 浏览器", { exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
  ]);
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

test("disclosures support the keyboard and settings privacy does not fill the console", async ({
  page,
}) => {
  await manager(page, {
    remoteClients: [{ id: "phone", kind: "ios", connectedAt: 1794300000 }],
  });
  const clients = page.getByRole("region", {
    name: "正在连接这台电脑的设备",
    exact: true,
  });
  await expect(
    clients.getByText("1 个活动连接", { exact: true }),
  ).toBeVisible();
  const summary = clients.locator("summary");
  await summary.focus();
  await summary.press("Enter");
  await expect(
    clients.getByText("iPhone / iPad 浏览器", { exact: true }),
  ).toBeVisible();
  await summary.press("Enter");
  await expect(
    clients.getByText("iPhone / iPad 浏览器", { exact: true }),
  ).not.toBeVisible();
  const help = page.getByText("如何连接其他设备", { exact: true });
  await help.focus();
  await help.press("Space");
  await expect(page.getByText(/在手机或网页打开上方账号入口/)).toBeVisible();
  const identity = page.getByText("本机身份核对", { exact: true });
  await identity.focus();
  await identity.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "设备公钥", exact: true }),
  ).toHaveAttribute("readonly", "");
  await expect(
    page.getByText(/本客户端的账号凭据和设备私钥只留在内存/),
  ).toHaveCount(0);
  await desktopNavigate(page, "设置");
  const privacy = page.getByText("连接与隐私说明", { exact: true });
  await privacy.focus();
  await privacy.press("Enter");
  await expect(
    page.getByText(/本客户端的账号凭据和设备私钥只留在内存/),
  ).toBeVisible();
  await desktopNavigate(page, "远程访问");
  await expect(
    clients.getByText("1 个活动连接", { exact: true }),
  ).toBeVisible();
  await expect(
    clients.getByText("iPhone / iPad 浏览器", { exact: true }),
  ).not.toBeVisible();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
  ]);
});

test("default remote waits for fresh account status after preparation completes", async ({
  page,
}) => {
  await manager(page, { stage: "prepare", holdStart: true });
  await expect.poll(() => calls(page)).toEqual(["desktop_start"]);
  await page.evaluate(
    () =>
      ((
        window as unknown as { accountSnapshotFailure: boolean }
      ).accountSnapshotFailure = true),
  );
  await expect(
    page.getByText("账号状态暂不可用，正在核验。", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { pendingStarts: (() => void)[] }).pendingStarts[0](),
  );
  await expect(
    page.getByRole("heading", { name: "这台电脑", exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual(["desktop_start"]);
  await page.evaluate(
    () =>
      ((
        window as unknown as { accountSnapshotFailure: boolean }
      ).accountSnapshotFailure = false),
  );
  await expect
    .poll(() => calls(page))
    .toEqual(["desktop_start", "account_enable_default"]);
  await expect(
    page.getByRole("button", { name: "管理远程访问" }),
  ).toContainText("已开启");
});
