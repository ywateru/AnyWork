import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 720 });
});

// Production UI with an explicit Native IPC boundary. This verifies renderer
// behavior, not macOS window controls, provider SSO or directory persistence.
async function desktop(page: Page, overlay = false) {
  const origin = "http://127.0.0.1:3341";
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const root = path.resolve("desktop/ui/dist");
    const file = path.resolve(
      root,
      `.${url.pathname === "/" ? "/index.html" : url.pathname}`,
    );
    if (!file.startsWith(root + path.sep)) return route.abort();
    await route.fulfill({
      contentType: file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "application/octet-stream",
      body: await readFile(file),
    });
  });
  await page.addInitScript((overlay) => {
    const scope = window as any;
    const config = {
      workspace: "/fixture",
      dataDirectory: "/fixture/data",
      port: 3210,
      allowLAN: false,
      serverBinary: "",
      cloudflaredBinary: "",
      tunwgBinary: "",
      publicURL: "",
      relayDomain: "",
      forceRelay: false,
      welcomed: true,
    };
    const account = {
      authorizationStatus: "signedIn",
      transactionId: null,
      signedIn: true,
      subject: "opaque-identity-do-not-display",
      accountLabel: "可信用户名",
      deviceName: "Mac · AB12",
      deviceNameSynced: true,
      enabled: true,
      busy: false,
      error: null,
      gridDeviceId: "fixture-grid",
      installationId: "fixture-installation",
      publicKey: "fixture-public-key",
      accountPortalUrl: "https://devices.fixture.invalid/app/",
      remoteClients: [],
    };
    const snapshot = {
      config,
      service: "running",
      owned: false,
      external: true,
      authorized: true,
      info: { workspace: "/fixture" },
      clients: [],
      error: "",
      notice: "",
    };
    scope.nameFixture = {
      account,
      snapshot,
      calls: [],
      failRename: false,
      holdRename: false,
      releaseRename: undefined,
    };
    scope.__TAURI__ = {
      core: {
        invoke: async (command: string, args?: any) => {
          if (command === "account_snapshot") return structuredClone(account);
          if (command === "desktop_snapshot") return structuredClone(snapshot);
          if (command === "desktop_chrome")
            return overlay ? "macos-overlay" : "standard";
          if (command === "desktop_update_snapshot")
            return {
              currentVersion: "0.1.26",
              version: "",
              phase: "idle",
              enabled: false,
              supported: true,
              showNotice: false,
              downloaded: 0,
              total: null,
              lastChecked: null,
              notes: "",
              error: "",
            };
          scope.nameFixture.calls.push({ command, args });
          if (
            [
              "desktop_start",
              "account_enable_default",
              "desktop_open",
              "desktop_drag",
            ].includes(command)
          )
            return;
          if (command === "account_rename_device") {
            if (scope.nameFixture.holdRename)
              await new Promise<void>((resolve) => {
                scope.nameFixture.releaseRename = resolve;
              });
            account.deviceNameSynced = false;
            if (scope.nameFixture.failRename)
              throw "private-network-error-must-not-render";
            if (args.expectedName !== account.deviceName)
              throw "设备名称未完成同步，账号目录已发生变化，请刷新后重试。";
            account.deviceName = args.name;
            account.deviceNameSynced = true;
            return structuredClone(account);
          }
          if (command === "desktop_action") {
            Object.assign(config, args.action.config);
            return;
          }
          throw new Error("Unexpected IPC " + command);
        },
      },
    };
  }, overlay);
  await page.goto(origin);
  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "这台电脑", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".device-name-value")).toHaveText("Mac · AB12");
}

test("macOS overlay reserves the native control area and sends drag only from blank chrome", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 960, height: 720 });
  await desktop(page, true);
  for (const [width, height] of [
    [960, 720],
    [800, 620],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(".desktop-shell")).toHaveClass(/macos-overlay/);
    const brand = (await page.locator(".brand").boundingBox())!;
    expect(brand.y).toBeGreaterThanOrEqual(40);
    const safeArea = page.locator(".native-window-drag-region");
    expect(await safeArea.locator("*").count()).toBe(0);
    await expect(
      page.getByRole("button", { name: "编辑设备名称" }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`macos-overlay-${width}x${height}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).nameFixture.calls.filter(
          (call: any) => call.command === "desktop_drag",
        ).length,
    ),
  ).toBe(0);
  await page
    .locator(".native-window-drag-region")
    .click({ position: { x: 150, y: 20 } });
  expect(
    await page.evaluate(
      () =>
        (window as any).nameFixture.calls.filter(
          (call: any) => call.command === "desktop_drag",
        ).length,
    ),
  ).toBe(1);
});

test("device rename supports cancel, error retry, Unicode and stable native identity", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 960, height: 720 });
  await desktop(page);
  await expect(page.locator(".native-window-drag-region")).toHaveCount(0);
  const edit = page.getByRole("button", { name: "编辑设备名称", exact: true });
  const input = page.getByRole("textbox", { name: "设备名称", exact: true });
  const save = page.getByRole("button", { name: "保存设备名称", exact: true });
  await edit.click();
  await expect(input).toBeFocused();
  await input.fill("取消的名称");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(edit).toBeFocused();
  await expect(page.locator(".device-name-value")).toHaveText("Mac · AB12");
  await edit.click();
  await input.fill("   ");
  await expect(save).toBeDisabled();
  await input.fill("  书房电脑 🐈  ");
  await page.evaluate(() => {
    (window as any).nameFixture.failRename = true;
  });
  await save.click();
  await expect(page.getByRole("alert")).toContainText("输入的名称已保留");
  await expect(page.locator("body")).not.toContainText("private-network-error");
  await expect(page.locator(".device-name-panel")).not.toContainText(
    "已同步到设备目录",
  );
  await expect(input).toHaveValue("  书房电脑 🐈  ");
  await page.screenshot({
    path: info.outputPath("rename-error-retains-draft.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    (window as any).nameFixture.failRename = false;
  });
  await save.click();
  await expect(page.locator(".device-name-value")).toHaveText("书房电脑 🐈");
  await expect(edit).toBeFocused();
  await page.waitForTimeout(1100);
  await expect(page.locator(".device-name-value")).toHaveText("书房电脑 🐈");
  const state = await page.evaluate(() => (window as any).nameFixture);
  expect(state.account.installationId).toBe("fixture-installation");
  expect(state.account.publicKey).toBe("fixture-public-key");
  expect(state.account.enabled).toBe(true);
  expect(
    state.calls.filter((call: any) => call.command === "desktop_start"),
  ).toHaveLength(1);
  expect(
    state.calls.filter(
      (call: any) => call.command === "account_enable_default",
    ),
  ).toHaveLength(1);
  expect(
    state.calls.some((call: any) =>
      ["account_disable", "account_logout", "desktop_action"].includes(
        call.command,
      ),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("书房电脑");
});

test("a Web name change and unavailable snapshots preserve draft without stale overwrite", async ({
  page,
}) => {
  await desktop(page);
  await page.getByRole("button", { name: "编辑设备名称" }).click();
  const input = page.getByRole("textbox", { name: "设备名称", exact: true });
  const save = page.getByRole("button", { name: "保存设备名称", exact: true });
  await input.fill("本地未提交草稿");
  await page.getByRole("button", { name: "远程访问", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "放弃未保存的更改？" });
  await expect(discard.getByRole("button", { name: "继续编辑" })).toBeFocused();
  await discard.press("Escape");
  await expect(input).toHaveValue("本地未提交草稿");
  await page.evaluate(() => {
    (window as any).nameFixture.account.deviceName = "Web 刚刚改的名称";
  });
  await expect(page.getByRole("alert")).toContainText(
    "设备名称已在其他位置更新",
  );
  await expect(input).toHaveValue("本地未提交草稿");
  await expect(save).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as any).nameFixture.calls.some(
        (call: any) => call.command === "account_rename_device",
      ),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".device-name-value")).toHaveText(
    "Web 刚刚改的名称",
  );
  await page.getByRole("button", { name: "编辑设备名称" }).click();
  await input.fill("离线时的草稿");
  await page.evaluate(() => {
    const scope = window as any;
    const invoke = scope.__TAURI__.core.invoke;
    scope.__TAURI__.core.invoke = async (command: string, args?: any) => {
      if (command === "account_snapshot") throw "unavailable";
      return invoke(command, args);
    };
  });
  await expect(save).toBeDisabled();
  await expect(input).toHaveValue("离线时的草稿");
});

test("missing trusted profile renders an anonymous account label without exposing subject", async ({
  page,
}) => {
  await desktop(page);
  await page.evaluate(() => {
    (window as any).nameFixture.account.accountLabel = null;
  });
  await expect(page.locator(".sidebar-account")).toContainText("已登录账号");
  await page.locator(".sidebar-account button").click();
  await expect(
    page.getByRole("heading", { name: "已登录账号", exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    "opaque-identity-do-not-display",
  );
});

test("rename sends the editing baseline and retains the draft when fresh Native data conflicts", async ({
  page,
}) => {
  await desktop(page);
  await page.getByRole("button", { name: "编辑设备名称", exact: true }).click();
  const input = page.getByRole("textbox", { name: "设备名称", exact: true });
  await input.fill("准备保存的草稿");
  await page.evaluate(() => {
    (window as any).nameFixture.holdRename = true;
  });
  await page.getByRole("button", { name: "保存设备名称", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "正在保存…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "取消", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    const fixture = (window as any).nameFixture;
    fixture.account.deviceName = "提交后才观察到的 Web 名称";
    fixture.releaseRename();
  });
  await expect(
    page.getByText(
      "设备目录中的名称已发生变化，尚未覆盖。输入的草稿已保留，请取消后重新编辑。",
    ),
  ).toBeVisible();
  await expect(input).toHaveValue("准备保存的草稿");
  const request = await page.evaluate(() =>
    (window as any).nameFixture.calls.find(
      (call: any) => call.command === "account_rename_device",
    ),
  );
  expect(request.args).toEqual({
    name: "准备保存的草稿",
    expectedName: "Mac · AB12",
  });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".device-name-value")).toHaveText(
    "提交后才观察到的 Web 名称",
  );
});
