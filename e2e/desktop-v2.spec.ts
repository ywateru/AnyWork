import { test, expect } from "@playwright/test";
import { manager, calls, desktopNavigate } from "./desktop-fixture";

test("v2 shell keeps the real mark, local address and only one readiness status together", async ({
  page,
}, info) => {
  await manager(page, { owned: true, port: 9521 });
  await expect(page.locator(".brand img")).toHaveAttribute("src", /svg/);
  await expect(
    page.getByRole("heading", { name: "这台电脑", exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText("已就绪", { exact: true })).toHaveCount(1);
  const local = page.getByRole("region", { name: "本地工作区", exact: true });
  await expect(local.getByTestId("local-address")).toHaveText(
    "http://127.0.0.1:9521/",
  );
  await expect(local.getByTestId("local-address")).toBeVisible();
  await expect(local.locator("details")).toHaveCount(0);
  await expect(page.locator(".sidebar-primary")).not.toContainText("活动连接");
  await expect(
    page.getByRole("button", { name: "管理远程访问", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("v2-ready.png"),
    fullPage: true,
  });
});

test("unsaved service and program drafts require an explicit choice on every navigation path", async ({
  page,
}) => {
  await manager(page);
  await desktopNavigate(page, "设置");
  const port = page.getByRole("spinbutton", { name: "本机端口", exact: true });
  await port.fill("9511");
  await page.waitForTimeout(1100);
  await expect(port).toHaveValue("9511");
  await desktopNavigate(page, "远程访问");
  const discard = page.getByRole("dialog", {
    name: "放弃未保存的更改？",
    exact: true,
  });
  await expect(discard).toBeVisible();
  await expect(
    discard.getByRole("button", { name: "继续编辑", exact: true }),
  ).toBeFocused();
  await discard.press("Escape");
  await expect(port).toHaveValue("9511");
  await expect(
    page.getByRole("heading", { name: "本机设置", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await discard.getByRole("button", { name: "放弃更改", exact: true }).click();
  await expect(page.getByTestId("local-address")).toHaveText(
    "http://127.0.0.1:3210/",
  );
  await desktopNavigate(page, "设置");
  await expect(port).toHaveValue("3210");
  await page.getByText("服务程序", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "服务程序路径", exact: true })
    .fill("/custom/server");
  await desktopNavigate(page, "更新");
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await page.getByRole("button", { name: "保存程序位置", exact: true }).click();
  await expect(page.getByText("程序位置已保存", { exact: true })).toBeVisible();
  await desktopNavigate(page, "更新");
  await expect(discard).toHaveCount(0);
});

test("saved settings drive the local address without stopping a reused external service", async ({
  page,
}) => {
  await manager(page, { port: 9520 });
  await desktopNavigate(page, "设置");
  await expect(
    page.getByRole("button", { name: "停止本地服务", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "工作目录", exact: true })
    .fill("/workspace/saved");
  await page
    .getByRole("spinbutton", { name: "本机端口", exact: true })
    .fill("9522");
  await page.getByRole("button", { name: "保存本机设置", exact: true }).click();
  await expect(page.getByText("本机设置已保存", { exact: true })).toBeVisible();
  await desktopNavigate(page, "工作区");
  await expect(page.getByTestId("local-address")).toHaveText(
    "http://127.0.0.1:9522/",
  );
  await expect(page.locator(".workspace-path")).toContainText(
    "/workspace/saved",
  );
  expect(await calls(page)).not.toContain("desktop_action:stop_server");
});

test("owned stop is cancellable, returns focus and preserves a native busy refusal", async ({
  page,
}) => {
  await manager(page, { owned: true, failStop: true });
  await desktopNavigate(page, "设置");
  await expect(
    page.getByRole("textbox", { name: "工作目录", exact: true }),
  ).toBeDisabled();
  const stop = page.getByRole("button", { name: "停止本地服务", exact: true });
  await stop.click();
  const dialog = page.getByRole("dialog", {
    name: "停止本地服务？",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await dialog.press("Escape");
  await expect(stop).toBeFocused();
  expect(await calls(page)).not.toContain("desktop_action:stop_server");
  await stop.click();
  await dialog.getByRole("button", { name: "确认停止", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "任务正在执行或状态无法核验",
  );
  await expect(
    page.getByRole("heading", { name: "本机设置", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "工作目录", exact: true }),
  ).toBeDisabled();
});

test("active connections need confirmation before remote closes, manual-off survives navigation", async ({
  page,
}) => {
  await manager(page, {
    remoteClients: [{ id: "one", kind: "ios", connectedAt: 1794300000 }],
  });
  await desktopNavigate(page, "远程访问");
  const close = page.getByRole("switch", { name: "关闭远程访问", exact: true });
  await close.click();
  const dialog = page.getByRole("dialog", {
    name: "关闭远程访问？",
    exact: true,
  });
  await expect(dialog).toContainText("1 个活动连接");
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await dialog.press("Escape");
  await expect(close).toBeFocused();
  expect(await calls(page)).not.toContain("account_disable");
  await close.click();
  await dialog
    .getByRole("button", { name: "确认关闭远程", exact: true })
    .click();
  await expect(page.getByText("远程访问未开启", { exact: true })).toBeVisible();
  const list = page.getByRole("region", {
    name: "正在连接这台电脑的设备",
    exact: true,
  });
  await expect(list).toContainText("远程访问已关闭");
  await expect(list.getByRole("listitem")).toHaveCount(0);
  await desktopNavigate(page, "工作区");
  await desktopNavigate(page, "远程访问");
  await page.waitForTimeout(1100);
  expect(
    (await calls(page)).filter((call) => call === "account_enable_default"),
  ).toHaveLength(1);
  await expect(
    page.getByRole("switch", { name: "开启远程访问", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
});

test("unknown observations do not expose cached readiness or allow writes", async ({
  page,
}) => {
  await manager(page, { owned: true });
  await page.evaluate(() => {
    (
      window as unknown as { desktopSnapshotFailure: boolean }
    ).desktopSnapshotFailure = true;
  });
  await expect(
    page.getByText("本机状态暂不可用", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开本地工作区", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "复制本地地址", exact: true }),
  ).toBeDisabled();
  await desktopNavigate(page, "设置");
  await expect(
    page.getByRole("button", { name: "停止本地服务", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "保存本机设置", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    (
      window as unknown as { accountSnapshotFailure: boolean }
    ).accountSnapshotFailure = true;
  });
  await desktopNavigate(page, "远程访问");
  await expect(page.getByText("状态未知", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByText("远程访问已开启", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("0 个活动连接", { exact: true })).toHaveCount(0);
  expect(await calls(page)).toEqual([
    "desktop_start",
    "account_enable_default",
  ]);
});
