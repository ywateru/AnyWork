import { test, expect } from "@playwright/test";
import { manager, calls } from "./desktop-fixture";

// Account remote access replaces every standalone transport control.
test("login alone leaves remote access disabled until explicit enable", async ({
  page,
}) => {
  await manager(page, { signedIn: true });
  await expect(
    page.getByText("已登录 · Test Account", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("远程访问未开启", { exact: true })).toBeVisible();
  expect(await calls(page)).toEqual([]);
  await page.getByRole("button", { name: "开启远程访问", exact: true }).click();
  await expect(page.getByText("远程访问已开启", { exact: true })).toBeVisible();
  expect(await calls(page)).toEqual(["account_enable"]);
  await page.getByText("身份核对", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "设备身份", exact: true }),
  ).toHaveValue("public-installation");
  await expect(
    page.getByRole("textbox", { name: "设备公钥", exact: true }),
  ).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "关闭远程访问", exact: true }).click();
  await expect(page.getByText("远程访问未开启", { exact: true })).toBeVisible();
  expect(await calls(page)).toEqual(["account_enable", "account_disable"]);
});

test("remote enable requires a ready local workspace", async ({ page }) => {
  await manager(page, { signedIn: true, off: true });
  await expect(
    page.getByRole("button", { name: "开启远程访问", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("先打开本地工作区，再开启远程访问。", { exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual([]);
});

test("remote config failure shows fixed diagnostic and retries only on click", async ({
  page,
}) => {
  await manager(page, { signedIn: true, failEnable: true });
  await page.getByRole("button", { name: "开启远程访问", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "REMOTE_ENABLE_GRID_CONFIG",
  );
  await page.waitForTimeout(1200);
  expect(await calls(page)).toEqual(["account_enable"]);
  await page.getByRole("button", { name: "开启远程访问", exact: true }).click();
  expect(await calls(page)).toEqual(["account_enable", "account_enable"]);
  await expect(page.getByText("远程访问未开启", { exact: true })).toBeVisible();
});

test("logout clears remote controls and identity", async ({ page }) => {
  await manager(page, { signedIn: true, enabled: true });
  await page.getByRole("button", { name: "退出账号", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开启远程访问", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "设备公钥", exact: true }),
  ).toHaveCount(0);
  expect(await calls(page)).toEqual(["account_logout"]);
});

test("pending authorization can be canceled", async ({ page }) => {
  await manager(page, { authorizing: true });
  await page.getByRole("button", { name: "取消登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual(["account_cancel"]);
});

test("reauthentication ends the old authorization before new login", async ({
  page,
}) => {
  await manager(page, { reauth: true });
  await page
    .getByRole("button", { name: "结束本次授权后重新登录", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual(["account_logout"]);
});

test("unsupported accounts retain local workspace and hosted device portal", async ({
  page,
}) => {
  await manager(page, { unsupported: true });
  await expect(
    page.getByText("当前平台暂不支持账号远程访问", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打开工作区", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "查看我的设备", exact: true }).click();
  expect(await calls(page)).toEqual(["desktop_account_portal"]);
});

test("registration and login remain available after broker failure", async ({
  page,
}) => {
  await manager(page);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "注册", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "登录", exact: true }).click();
  expect(await calls(page)).toEqual(["account_begin", "account_begin"]);
});
