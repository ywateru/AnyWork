import { chromium, expect } from "@playwright/test";
const origin = process.env.ANYWORK_LAYOUT_ORIGIN || "http://127.0.0.1:4184";
if (new URL(origin).hostname !== "127.0.0.1")
  throw new Error("Isolated loopback Vite fixture required");
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
});
const id = "11111111-1111-4111-8111-111111111111",
  grid = "22222222-2222-4222-8222-222222222222";
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      locale: "zh-CN",
      serviceWorkers: "block",
    });
    // Render-only adapters: no real account, OAuth grant or coordination service.
    await context.route("**/src/accountAuth.ts", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: `export class AccountLogtoClient { async isAuthenticated(){return true;} async getIdTokenClaims(){return {sub:'public-layout-fixture',name:'布局测试账号'};} async getAccountAccessToken(){return 'synthetic-layout-token';} async startAccountSignIn(){} async endAccountSession(){} }`,
      }),
    );
    await context.route("**/src/vendor/cybergrid/index.ts", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: `export class CyberGridClient {async connect(){} async disconnect(){} async devices(){return [{id:'${grid}',name:'工作电脑',online:true,ports:[{id:'anywork-remote',type:'anywork-noise-v1',tunnelUrl:'https://fixture.trycloudflare.com'}]}];}}`,
      }),
    );
    await context.route("https://**/*", (r) =>
      new URL(r.request().url()).pathname === "/api/my-account"
        ? r.fulfill({
            json: {
              customData: {
                anywork: {
                  schemaVersion: 1,
                  devices: {
                    [id]: {
                      label: "工作电脑",
                      platform: "macOS",
                      publicKey: "A".repeat(43),
                      keyVersion: 1,
                      gridDeviceId: grid,
                    },
                  },
                },
              },
            },
          })
        : r.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/app/");
    await expect(
      page.getByRole("heading", { name: "我的设备", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "工作电脑", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "打开工作区" }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/anywork-unified-devices-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "打开工作区" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("A".repeat(43), { exact: true })).toBeVisible();
    await page.screenshot({
      path: `/tmp/anywork-unified-key-confirm-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "打开工作区" }),
    ).toBeFocused();
    expect(errors).toEqual([]);
    await context.close();
    console.log(
      `Passed ${width}px authenticated device/key-confirm layout (render fixtures only)`,
    );
  }
} finally {
  await browser.close();
}
