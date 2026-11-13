/** Real AccountApp/AccountHome/AccountLogtoClient profile fences and workspace
 * menus, synthetic OAuth/coordination/transport only. No real account assets.
 * Run from the worktree: PLAYWRIGHT_CHANNEL=chrome node web/scripts/account-identity.check.mjs */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";

const output = path.resolve("artifacts/account-identity-visible");
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: path.resolve("web/vite.config.ts"),
  configLoader: "runner",
  root: path.resolve("web"),
  cacheDir: path.join(output, "vite-cache"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, open: false },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
});
const device = "identity-device",
  grid = "identity-grid",
  key = "A".repeat(43);
async function fixture({ width = 390, locale = "zh-CN", ...options } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    locale,
    serviceWorkers: "block",
  });
  await context.addInitScript(
    ({ locale, options }) => {
      localStorage.setItem("anywork.account.locale", locale);
      window.identityFixture = {
        authenticated: true,
        claims: { sub: "synthetic-owner", username: "username-only" },
        info: { sub: "synthetic-owner", username: "backfilled-user" },
        infoCalls: 0,
        signIns: [],
        signOuts: 0,
        heldInfo: [],
        heldClaims: [],
        ...options,
      };
    },
    { locale, options },
  );
  await context.route("**/src/accountAuth.ts", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `import {AccountLogtoClient as RealOwner} from '/src/accountAuth.ts?identity-original';
      import {accountStorageNamespace} from '/src/accountConfig.ts';
      export {withAccountSubject,accountScopes} from '/src/accountAuth.ts?identity-original';
      const f=window.identityFixture;
      export class AccountLogtoClient extends RealOwner {
        constructor(...args){super(...args);f.client=this;f.scopes=args[0].scopes;f.prefix='logto:'+accountStorageNamespace(args[1])+':';}
        async isAuthenticated(){return f.authenticated;}
        async getIdTokenClaims(){const snapshot=structuredClone(f.claims);if(f.holdClaims)await new Promise(resolve=>f.heldClaims.push(resolve));if(!snapshot)throw Error('No current grant');return snapshot;}
        async fetchUserInfo(){f.infoCalls++;const snapshot=structuredClone(f.info),fail=f.infoFailure;if(f.holdInfo)await new Promise(resolve=>f.heldInfo.push(resolve));if(fail)throw Error('Synthetic network failure');return snapshot;}
        async getAccountAccessToken(){return 'synthetic-directory';}
        async getCyberGridAccessToken(){return 'synthetic-grid';}
        async signIn(options){f.signIns.push(options);}
        async signOut(){f.signOuts++;}
      }`,
    }),
  );
  await context.route("**/src/vendor/cybergrid/index.ts", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export class CyberGridClient {
      async connect(){} async disconnect(){}
      async devices(){return [{id:'${grid}',name:'Not the account name',online:true,ports:[{id:'anywork-remote',type:'anywork-noise-v1',tunnelUrl:'https://synthetic.invalid'}]}];}
      async getPortTunnelUrl(){return 'https://synthetic.invalid';}
    }`,
    }),
  );
  await context.route("**/src/remoteTransport.ts", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export * from '/src/remoteTransport.ts?identity-original';
      export class RemoteTransport {
        static async connect(){return new RemoteTransport();}
        constructor(){this.ended=new Promise(()=>{});} close(){}
        async request(p){const data=p==='/api/info'?{workspace:'/synthetic',hostname:'Synthetic computer',client_presence:false}:p==='/api/sessions'?{sessions:[]}:p==='/api/plugins'?{plugins:[]}:p==='/api/workspaces'?{workspaces:[]}:{events:[],cursor:0};return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});}
      }`,
    }),
  );
  await context.route("https://**/*", (route) => {
    if (new URL(route.request().url()).pathname !== "/api/my-account")
      return route.abort();
    return route.fulfill({
      json: {
        name: "Untrusted directory name",
        customData: {
          name: "Untrusted customData name",
          anywork: {
            schemaVersion: 1,
            devices: {
              [device]: {
                label: "Synthetic computer",
                platform: "macOS",
                publicKey: key,
                keyVersion: 1,
                gridDeviceId: grid,
              },
            },
          },
        },
      },
    });
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/app/");
  return {
    page,
    context,
    async close() {
      expect(errors).toEqual([]);
      await context.close();
    },
  };
}
const menu = (page) => page.locator(".account-user-menu");
async function assertNoOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function switchOwner(page, claims, extra = {}) {
  await page.evaluate(
    ({ claims, extra }) => {
      Object.assign(window.identityFixture, extra, { claims });
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: window.identityFixture.prefix + "idToken",
        }),
      );
    },
    { claims, extra },
  );
}
try {
  for (const width of [1440, 390])
    for (const locale of ["zh-CN", "en"]) {
      const fullName = (locale === "en" ? "Synthetic identity " : "合成账号名称🌊")
        .repeat(18)
        .trim();
      const email = "synthetic-person@example.test";
      const f = await fixture({
        width,
        locale,
        claims: {
          sub: "synthetic-owner",
          name: fullName,
          username: "secondary-username",
          email,
        },
      });
      const trigger = menu(f.page).locator("summary");
      await expect(trigger).toHaveAttribute("title", fullName);
      await expect(trigger.locator("span").nth(1)).toBeVisible();
      expect(
        await f.page.evaluate(() => window.identityFixture.scopes),
      ).toEqual(
        expect.arrayContaining(["profile", "email", "custom_data", "connect"]),
      );
      await trigger.focus();
      await f.page.keyboard.press("Enter");
      await expect(menu(f.page).locator(".account-identity-name")).toHaveText(
        fullName,
      );
      await expect(
        menu(f.page).getByText(email, { exact: true }),
      ).toBeVisible();
      await assertNoOverflow(f.page);
      await f.page.screenshot({
        path: path.join(output, `device-identity-${width}-${locale}.png`),
      });
      await f.page.keyboard.press("Escape");
      if ((await menu(f.page).getAttribute("open")) !== null)
        await trigger.click();
      await f.page
        .getByRole("button", {
          name: locale === "en" ? "Open workspace" : "打开工作区",
          exact: true,
        })
        .click();
      await f.page.getByRole("checkbox").check();
      await f.page
        .getByRole("button", {
          name: locale === "en" ? "Confirm and connect" : "确认并连接",
          exact: true,
        })
        .click();
      if (width < 720)
        await f.page
          .getByRole("button", { name: "会话列表", exact: true })
          .filter({ visible: true })
          .click();
      const workspace = f.page.locator(".workspace-account-menu");
      await expect(workspace.locator("summary")).toHaveAttribute(
        "title",
        fullName,
      );
      await workspace.locator("summary").click();
      await expect(workspace.locator(".account-identity-name")).toHaveText(
        fullName,
      );
      await expect(workspace.getByText(email, { exact: true })).toBeVisible();
      await assertNoOverflow(f.page);
      await f.page.screenshot({
        path: path.join(output, `workspace-identity-${width}-${locale}.png`),
      });
      expect(
        await f.page.evaluate(() => window.identityFixture.signIns),
      ).toEqual([]);
      await f.close();
      console.log(
        `Passed actual device/workspace name+email, keyboard, long Unicode identity: ${width}px ${locale}`,
      );
    }
  for (const [claims, expected] of [
    [{ sub: "synthetic-owner", username: "username-only" }, "username-only"],
    [
      { sub: "synthetic-owner", preferred_username: "preferred-only" },
      "preferred-only",
    ],
    [
      {
        sub: "synthetic-owner",
        name: "  ",
        username: " ",
        email: "email-only@example.test",
      },
      "email-only@example.test",
    ],
  ]) {
    const f = await fixture({ claims });
    await expect(menu(f.page).locator("summary")).toHaveAttribute(
      "title",
      expected,
    );
    expect(await f.page.evaluate(() => window.identityFixture.infoCalls)).toBe(
      0,
    );
    await f.close();
  }
  {
    const f = await fixture({
      claims: { sub: "synthetic-owner" },
      holdInfo: true,
    });
    await expect
      .poll(() => f.page.evaluate(() => window.identityFixture.heldInfo.length))
      .toBeGreaterThan(0);
    await expect(menu(f.page).locator("summary")).toHaveAttribute(
      "title",
      "已登录账号",
    );
    await f.page.evaluate(() =>
      window.identityFixture.heldInfo.splice(0).forEach((resolve) => resolve()),
    );
    await expect(menu(f.page).locator("summary")).toHaveAttribute(
      "title",
      "backfilled-user",
    );
    await f.close();
  }
  {
    const f = await fixture({
      claims: { sub: "synthetic-owner" },
      info: { sub: "foreign-owner", name: "Foreign name" },
    });
    await menu(f.page).locator("summary").click();
    await expect(menu(f.page).getByRole("status")).toContainText("暂时不可用");
    await expect(f.page.getByText("Foreign name", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      f.page.getByText("synthetic-owner", { exact: true }),
    ).toHaveCount(0);
    expect(await f.page.evaluate(() => window.identityFixture.signIns)).toEqual(
      [],
    );
    await f.close();
  }
  for (const unavailable of ["missing", "network"]) {
    const f = await fixture({
      claims: { sub: "synthetic-owner" },
      info: { sub: "synthetic-owner" },
      infoFailure: unavailable === "network",
    });
    await menu(f.page).locator("summary").click();
    await expect(menu(f.page).getByRole("status")).toContainText(
      unavailable === "missing" ? "未提供" : "暂时不可用",
    );
    await f.page.evaluate(() => {
      window.identityFixture.infoFailure = false;
      window.identityFixture.info = {
        sub: "synthetic-owner",
        username: "Recovered identity",
      };
    });
    await menu(f.page)
      .getByRole("button", { name: "重试账号资料", exact: true })
      .click();
    await expect(menu(f.page).locator("summary")).toHaveAttribute(
      "title",
      "Recovered identity",
    );
    expect(await f.page.evaluate(() => window.identityFixture.signIns)).toEqual(
      [],
    );
    await f.close();
  }
  {
    const f = await fixture({
      claims: { sub: "synthetic-owner" },
      holdInfo: true,
      info: { sub: "synthetic-owner", name: "Late old identity" },
    });
    await expect
      .poll(() => f.page.evaluate(() => window.identityFixture.heldInfo.length))
      .toBeGreaterThan(0);
    await switchOwner(
      f.page,
      { sub: "new-owner", username: "New account" },
      { holdInfo: false },
    );
    await expect(menu(f.page).locator("summary")).toHaveAttribute(
      "title",
      "New account",
    );
    await f.page.evaluate(() =>
      window.identityFixture.heldInfo.splice(0).forEach((resolve) => resolve()),
    );
    await expect(menu(f.page).locator("summary")).toHaveAttribute(
      "title",
      "New account",
    );
    await expect(
      f.page.getByText("Late old identity", { exact: true }),
    ).toHaveCount(0);
    await f.close();
  }
  {
    const f = await fixture({
      claims: { sub: "synthetic-owner", name: "Old visible identity" },
    });
    await expect(menu(f.page).locator("summary")).toHaveAttribute(
      "title",
      "Old visible identity",
    );
    await switchOwner(
      f.page,
      { sub: "new-owner", name: "New identity" },
      { holdClaims: true },
    );
    await expect(menu(f.page).locator("summary")).toHaveAttribute(
      "title",
      "已登录账号",
    );
    await expect(
      f.page.getByText("Old visible identity", { exact: true }),
    ).toHaveCount(0);
    await f.page.evaluate(() => {
      window.identityFixture.holdClaims = false;
      window.identityFixture.heldClaims
        .splice(0)
        .forEach((resolve) => resolve());
    });
    await expect(menu(f.page).locator("summary")).toHaveAttribute(
      "title",
      "New identity",
    );
    await f.close();
  }
  {
    const f = await fixture({
      claims: { sub: "synthetic-owner" },
      holdInfo: true,
      info: { sub: "synthetic-owner", name: "Late logout identity" },
    });
    await expect
      .poll(() => f.page.evaluate(() => window.identityFixture.heldInfo.length))
      .toBeGreaterThan(0);
    await menu(f.page).locator("summary").click();
    await menu(f.page)
      .getByRole("button", { name: "退出账号", exact: true })
      .click();
    await expect(
      f.page.getByRole("heading", { name: "登录账号", exact: true }),
    ).toBeVisible();
    await f.page.evaluate(() =>
      window.identityFixture.heldInfo.splice(0).forEach((resolve) => resolve()),
    );
    await expect(
      f.page.getByText("Late logout identity", { exact: true }),
    ).toHaveCount(0);
    expect(await f.page.evaluate(() => window.identityFixture.signIns)).toEqual(
      [],
    );
    await f.close();
  }
  console.log(
    "Passed username/email, authorized backfill, subject mismatch, unavailable/retry, account switch and late logout profile fences; no automatic sign-in.",
  );
} finally {
  await browser.close();
  await server.close();
}
