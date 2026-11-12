import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const origin = process.env.ANYWORK_LAYOUT_ORIGIN || "http://127.0.0.1:3322";
if (new URL(origin).hostname !== "127.0.0.1")
  throw new Error("Isolated loopback Vite fixture required");
const output = process.env.ANYWORK_LAYOUT_OUTPUT || "artifacts/ui-v2-web";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
});
const id = "11111111-1111-4111-8111-111111111111",
  grid = "22222222-2222-4222-8222-222222222222";
const key = "A".repeat(43);
// AccountHome and AccountStore are real. Only the SDK/coordination/encrypted transport
// boundaries are synthetic; this does not claim a real OAuth grant or Noise handshake.
async function fixture(width, options = {}) {
  const { height = 900, ...initialState } = options;
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width < 720,
    hasTouch: width < 720,
    locale: "zh-CN",
    serviceWorkers: "block",
  });
  const state = {
    authenticated: true,
    mode: "ready",
    hold: false,
    connects: 0,
    closes: 0,
    profile: {
      customData: {
        retained: { test: true },
        anywork: {
          schemaVersion: 1,
          devices: {
            [id]: {
              label: "工作电脑",
              platform: "macOS",
              publicKey: key,
              keyVersion: 1,
              gridDeviceId: grid,
            },
          },
        },
      },
    },
    ...initialState,
  };
  await context.addInitScript(
    ({ state, id, key }) => {
      localStorage.setItem("anywork.account.locale", "zh-CN");
      window.fixture = state;
      if (state.pin)
        localStorage.setItem(
          "anywork.device-key." +
            JSON.stringify([
              "https://account.anywork.ink",
              "public-layout-fixture",
              id,
            ]),
          state.pin === "current" ? key : "B".repeat(43),
        );
    },
    { state, id, key },
  );
  await context.route("**/src/accountAuth.ts", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `export class AccountLogtoClient { async isAuthenticated(){return window.fixture.authenticated;} async getIdTokenClaims(){return {sub:'public-layout-fixture',name:'布局测试账号'};} async getAccountAccessToken(){return 'synthetic-layout-token';} async startAccountSignIn(options){window.fixture.signIn=options;} async endAccountSession(url){window.fixture.signOut=url;} }`,
    }),
  );
  await context.route("**/src/vendor/cybergrid/index.ts", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `export class CyberGridClient {async connect(){if(window.fixture.mode==='error')throw Error('directory unavailable');} async disconnect(){} async devices(){return window.fixture.mode==='empty'?[]:[{id:'${grid}',name:'工作电脑',online:window.fixture.mode!=='offline',ports:window.fixture.mode==='unready'?[]:[{id:'anywork-remote',type:'anywork-noise-v1',tunnelUrl:'https://fixture.trycloudflare.com'}]}];} async getPortTunnelUrl(app,id,port,{signal}){window.fixture.tunnelRequests=(window.fixture.tunnelRequests||0)+1;if(window.fixture.hold)await new Promise(resolve=>window.fixture.releaseTunnel=resolve);return 'https://fixture.trycloudflare.com';}}`,
    }),
  );
  await context.route("**/src/remoteTransport.ts", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `export * from '/src/remoteTransport.ts?fixture-original'; export class RemoteTransport { static async connect(options){window.fixture.connects++;return new RemoteTransport();} constructor(){this.ended=new Promise(resolve=>window.fixture.endTransport=resolve);} close(){window.fixture.closes++;} async request(path){window.fixture.businessRequests=(window.fixture.businessRequests||[]).concat(path);let data=path==='/api/info'?{workspace:'/fixture-workspace',hostname:'fixture',client_presence:false}:path==='/api/sessions'?{sessions:[]}:path==='/api/plugins'?{plugins:[]}:path==='/api/workspaces'?{workspaces:[]}:{events:[],cursor:0};return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});} terminal(){throw Error('No fixture PTY');} }`,
    }),
  );
  await context.route("https://**/*", async (r) => {
    if (new URL(r.request().url()).pathname !== "/api/my-account")
      return r.abort();
    if (r.request().method() === "PATCH") {
      state.profile = r.request().postDataJSON();
      return r.fulfill({ json: {} });
    }
    return r.fulfill({ json: state.profile });
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/app/");
  return {
    context,
    page,
    state,
    errors,
    async close() {
      expect(errors).toEqual([]);
      await context.close();
    },
  };
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function centeredDialog(page) {
  const dialog = page.locator(".account-dialog[open]");
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(
    Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2),
  ).toBeLessThanOrEqual(1);
  expect(bounds.x).toBeGreaterThanOrEqual(16);
  expect(bounds.y).toBeGreaterThanOrEqual(19);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 16);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 19);
  expect(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
}
async function ready(page) {
  await expect(
    page.getByRole("heading", { name: "我的设备", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "刷新", exact: true }),
  ).toBeEnabled();
}
async function openKey(page, changed = false) {
  await page.getByRole("button", { name: "打开工作区" }).first().click();
  await expect(
    page.getByRole("heading", {
      name: changed ? "这台电脑的公钥已改变" : "确认这台电脑的身份",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "确认并连接" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await centeredDialog(page);
}
try {
  for (const width of [1440, 800, 390]) {
    let f = await fixture(width, { authenticated: false });
    await expect(
      f.page.getByRole("heading", { name: "登录账号", exact: true }),
    ).toBeVisible();
    await expect(f.page.locator("aside")).toHaveCount(0);
    await expect(f.page.locator("input")).toHaveCount(0);
    await expect(f.page.locator(".account-brand img")).toHaveAttribute(
      "src",
      "/icon.svg",
    );
    await f.page.getByRole("button", { name: "登录", exact: true }).click();
    expect(await f.page.evaluate(() => window.fixture.signIn)).toEqual({
      redirectUri: origin + "/app/callback",
    });
    await f.page.getByRole("button", { name: "注册账号", exact: true }).click();
    expect(
      await f.page.evaluate(() => window.fixture.signIn.interactionMode),
    ).toBe("signUp");
    await f.page.getByRole("button", { name: "切换主题" }).click();
    await expect(f.page.locator("html")).toHaveAttribute("data-theme", "dark");
    await f.page.getByRole("button", { name: "English", exact: true }).click();
    await expect(
      f.page.getByRole("heading", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await noOverflow(f.page);
    await f.page.screenshot({
      path: `${output}/login-${width}.png`,
      fullPage: true,
    });
    await f.close();

    f = await fixture(width);
    await ready(f.page);
    await expect(f.page.locator("h1")).toHaveCount(1);
    await expect(f.page.locator(".account-device")).toHaveCount(1);
    await noOverflow(f.page);
    await f.page.screenshot({
      path: `${output}/devices-${width}.png`,
      fullPage: true,
    });
    await f.page.locator(".account-device-menu > summary").click();
    await f.page.getByRole("button", { name: "修改名称", exact: true }).click();
    await centeredDialog(f.page);
    await f.page.getByRole("textbox", { name: "设备名称" }).fill("研发电脑");
    await f.page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      f.page.getByRole("heading", { name: "研发电脑", exact: true }),
    ).toBeVisible();
    expect(f.state.profile.customData.retained).toEqual({ test: true });
    await openKey(f.page);
    await f.page.screenshot({
      path: `${output}/key-${width}.png`,
      fullPage: true,
    });
    await f.page.keyboard.press("Escape");
    await expect(f.page.getByRole("dialog")).not.toBeVisible();
    await expect(
      f.page.getByRole("button", { name: "打开工作区" }),
    ).toBeFocused();
    await openKey(f.page);
    await f.page.getByRole("checkbox").check();
    await f.page.evaluate(() => (window.fixture.hold = true));
    await f.page.getByRole("button", { name: "确认并连接" }).click();
    await expect(
      f.page.getByText("正在建立加密连接…", { exact: true }),
    ).toHaveCount(1);
    await f.page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(
      f.page.getByRole("button", { name: "打开工作区" }),
    ).toBeEnabled();
    await f.page.evaluate(() => window.fixture.releaseTunnel());
    expect(await f.page.evaluate(() => window.fixture.connects)).toBe(0);
    await openKey(f.page); // canceled attempt never pins or bypasses identity verification
    await f.page.getByRole("checkbox").check();
    await f.page.evaluate(() => (window.fixture.hold = false));
    await f.page.getByRole("button", { name: "确认并连接" }).click();
    await expect(
      f.page.getByRole("heading", { name: "从哪里开始？" }),
    ).toBeVisible();
    if (width < 720)
      await f.page
        .getByRole("button", { name: "会话列表", exact: true })
        .click();
    await expect(f.page.locator(".workspace-device-trigger")).toContainText(
      "研发电脑",
    );
    await expect(f.page.locator(".workspace-device-trigger")).not.toContainText(
      "已连接",
    );
    await f.page.locator(".workspace-device-trigger").click();
    await f.page
      .getByRole("button", { name: "我的设备 / 切换电脑", exact: true })
      .click();
    await expect(
      f.page.getByRole("dialog", { name: "返回我的设备？" }),
    ).toBeVisible();
    await expect(
      f.page
        .getByRole("dialog", { name: "返回我的设备？" })
        .getByText("电脑上的 Agent 任务会继续执行。", { exact: false }),
    ).toBeVisible();
    await f.page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(f.page.locator(".workspace-device-trigger")).toBeFocused();
    await f.page.locator(".workspace-device-trigger").click();
    await f.page
      .getByRole("button", { name: "我的设备 / 切换电脑", exact: true })
      .click();
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "我的设备 / 切换电脑", exact: true })
      .click();
    await ready(f.page);
    expect(await f.page.evaluate(() => window.fixture.closes)).toBe(1);
    await f.page.getByRole("button", { name: "打开工作区" }).click();
    await expect(
      f.page.getByRole("heading", { name: "从哪里开始？" }),
    ).toBeVisible();
    await expect(f.page.getByRole("dialog")).toHaveCount(0);
    await f.page.evaluate(() =>
      window.fixture.endTransport("AUTHORIZATION_EXPIRED"),
    );
    await ready(f.page);
    await expect(
      f.page.getByText("连接授权已过期，请返回设备页重新连接。", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await f.page.evaluate(() => window.fixture.connects)).toBe(2);
    // Successful transport pins identity. Changed pin must require explicit confirmation again.
    await f.page.evaluate(() => {
      const pin = Object.keys(localStorage).find((k) =>
        k.startsWith("anywork.device-key."),
      );
      localStorage.setItem(pin, "B".repeat(43));
    });
    await openKey(f.page, true);
    await f.page.getByRole("button", { name: "取消", exact: true }).click();
    await f.page.locator(".account-device-menu > summary").click();
    await f.page.getByRole("button", { name: "移除显示", exact: true }).click();
    await centeredDialog(f.page);
    await expect(f.page.getByText(/不会关闭该电脑的远程访问/)).toBeVisible();
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "移除设备显示", exact: true })
      .click();
    await expect(
      f.page.getByText("新发现的设备", { exact: true }),
    ).toBeVisible();
    await expect(
      f.page.getByRole("button", { name: "打开工作区" }),
    ).toHaveCount(0);
    expect(f.state.profile.customData.anywork.devices).toEqual({});
    await f.close();

    for (const mode of ["empty", "error", "offline", "unready", "unknown"]) {
      f = await fixture(width, {
        mode,
        ...(["empty", "unknown"].includes(mode)
          ? { profile: { customData: {} } }
          : {}),
      });
      await ready(f.page);
      if (mode === "empty") {
        await expect(
          f.page.getByRole("heading", { name: "把你的第一台电脑添加进来" }),
        ).toBeVisible();
        await expect(
          f.page.getByRole("button", { name: "添加设备", exact: true }),
        ).toHaveCount(1);
        await f.page
          .getByRole("button", { name: "添加设备", exact: true })
          .click();
        await centeredDialog(f.page);
        await expect(
          f.page.getByText(/工作区就绪后将默认尝试开启远程访问/),
        ).toBeVisible();
        await f.page.keyboard.press("Escape");
      } else if (mode === "unknown") {
        await expect(
          f.page.getByText("新发现的设备", { exact: true }),
        ).toBeVisible();
        await expect(
          f.page.getByRole("button", { name: "打开工作区" }),
        ).toHaveCount(0);
      } else {
        await expect(
          f.page.getByText(
            mode === "error"
              ? "状态暂时未知"
              : mode === "offline"
                ? "离线"
                : "安全连接尚未就绪",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(
          f.page.getByRole("button", { name: "打开工作区" }),
        ).toBeDisabled();
        await expect(
          f.page.getByRole("heading", { name: "把你的第一台电脑添加进来" }),
        ).toHaveCount(0);
      }
      await noOverflow(f.page);
      await f.close();
    }
    console.log(
      `Passed ${width}px: centered OAuth entry, real AccountHome/AccountStore directory/mutation, empty/unknown/offline/unready, first/changed key, cancel ownership, connected shell and safe switch (synthetic service boundaries only)`,
    );
  }

  for (const [width, height] of [
    [1440, 480],
    [800, 480],
    [390, 480],
    [390, 320],
  ]) {
    const records = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        index
          ? `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`
          : id,
        {
          label: index ? `测试电脑 ${index}` : "工作电脑",
          platform: "macOS",
          publicKey: key,
          keyVersion: 1,
          gridDeviceId: index ? `offline-${index}` : grid,
        },
      ]),
    );
    const f = await fixture(width, {
      height,
      profile: {
        customData: { anywork: { schemaVersion: 1, devices: records } },
      },
    });
    try {
      await ready(f.page);
      await f.page
        .getByRole("button", { name: "添加设备", exact: true })
        .click();
      await centeredDialog(f.page);
      await f.page.screenshot({ path: `${output}/add-${width}x${height}.png` });
      await f.page.keyboard.press("Escape");
      await expect(
        f.page.getByRole("button", { name: "添加设备", exact: true }),
      ).toBeFocused();
      const menu = f.page.locator(".account-device-menu").last();
      const trigger = menu.locator("summary");
      await trigger.click();
      expect(await f.page.evaluate(() => scrollY)).toBeGreaterThan(0);
      await menu.getByRole("button", { name: "修改名称", exact: true }).click();
      await centeredDialog(f.page);
      await expect(
        f.page.getByRole("textbox", { name: "设备名称" }),
      ).toBeFocused();
      await f.page.screenshot({
        path: `${output}/rename-scrolled-${width}x${height}.png`,
      });
      await f.page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await trigger.click();
      await menu.getByRole("button", { name: "移除显示", exact: true }).click();
      await centeredDialog(f.page);
      await f.page.getByRole("button", { name: "取消", exact: true }).click();
      await expect(trigger).toBeFocused();
      await openKey(f.page);
      if (height === 320) {
        const dialog = f.page.locator(".account-dialog[open]");
        expect(
          await dialog.evaluate(
            (node) => node.scrollHeight > node.clientHeight,
          ),
        ).toBe(true);
        await f.page
          .getByRole("button", { name: "取消", exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          f.page.getByRole("button", { name: "取消", exact: true }),
        ).toBeInViewport({ ratio: 1 });
        await centeredDialog(f.page);
      }
      await f.page.screenshot({ path: `${output}/key-${width}x${height}.png` });
      await f.page.keyboard.press("Escape");
      await expect(
        f.page.getByRole("button", { name: "打开工作区", exact: true }).first(),
      ).toBeFocused();
      await noOverflow(f.page);
      console.log(
        `Passed ${width}x${height}: add/rename/remove/key dialogs centered in actual viewport, scrolled directory, internal overflow and focus restoration`,
      );
    } finally {
      await f.close();
    }
  }

  // The connected shell must retain its device and account actions when the
  // keyboard or a short browser window leaves little vertical space.
  const f = await fixture(390, { height: 480 });
  try {
    await ready(f.page);
    await openKey(f.page);
    await f.page.getByRole("checkbox").check();
    await f.page.getByRole("button", { name: "确认并连接" }).click();
    await expect(
      f.page.getByRole("heading", { name: "从哪里开始？" }),
    ).toBeVisible();
    await f.page.getByRole("button", { name: "会话列表", exact: true }).click();
    const device = f.page.locator(".workspace-device-trigger");
    const account = f.page.locator(".workspace-account-menu > summary");
    await expect(device).toBeInViewport({ ratio: 1 });
    await expect(account).toBeInViewport({ ratio: 1 });
    const metrics = await f.page.locator(".session-list").evaluate((list) => ({
      height: list.clientHeight,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
    }));
    expect(metrics.documentHeight).toBe(metrics.viewportHeight);
    await noOverflow(f.page);
    await f.page.screenshot({ path: `${output}/connected-390x480.png` });

    await device.click();
    const switchDevice = f.page.getByRole("button", {
      name: "我的设备 / 切换电脑",
      exact: true,
    });
    await expect(switchDevice).toBeInViewport({ ratio: 1 });
    await switchDevice.click();
    const switchDialog = f.page.getByRole("dialog", { name: "返回我的设备？" });
    await expect(switchDialog).toBeInViewport({ ratio: 1 });
    await expect(
      switchDialog.getByRole("button", { name: "取消" }),
    ).toBeFocused();
    await switchDialog.getByRole("button", { name: "取消" }).click();
    await expect(device).toBeFocused();
    expect(await f.page.evaluate(() => window.fixture.closes)).toBe(0);

    await account.click();
    const home = f.page.locator(".workspace-compact-home");
    await expect(home).toBeInViewport({ ratio: 1 });
    await home.click();
    await expect(f.page.locator(".workspace-account-menu")).not.toHaveAttribute(
      "open",
    );
    await expect(f.page.locator("aside.sidebar")).not.toHaveClass(/\bopen\b/);
    await f.page.getByRole("button", { name: "会话列表", exact: true }).click();
    await account.click();
    const signOut = f.page.getByRole("button", {
      name: "退出账号",
      exact: true,
    });
    await expect(signOut).toBeInViewport({ ratio: 1 });
    await f.page.screenshot({ path: `${output}/account-menu-390x480.png` });
    await signOut.click();
    const exitDialog = f.page.getByRole("dialog", { name: "退出 Web 账号？" });
    await expect(exitDialog).toBeInViewport({ ratio: 1 });
    await expect(
      exitDialog.getByRole("button", { name: "取消" }),
    ).toBeFocused();
    await f.page.screenshot({ path: `${output}/safe-exit-390x480.png` });
    await f.page.keyboard.press("Escape");
    await expect(exitDialog).not.toBeVisible();
    await expect(account).toBeFocused();
    expect(await f.page.evaluate(() => window.fixture.closes)).toBe(0);
    expect(await f.page.evaluate(() => window.fixture.signOut)).toBeUndefined();
    await account.click();
    await signOut.click();
    await exitDialog
      .getByRole("button", { name: "退出账号", exact: true })
      .click();
    await expect
      .poll(() => f.page.evaluate(() => window.fixture.signOut))
      .toBe(origin + "/app/");
    expect(await f.page.evaluate(() => window.fixture.closes)).toBe(1);
    console.log(
      `Passed 390x480 touch shell: ${metrics.height}px history, device switch cancellation, relocated home, account exit cancellation/focus and confirmed logout`,
    );
  } finally {
    await f.close();
  }
} finally {
  await browser.close();
}
