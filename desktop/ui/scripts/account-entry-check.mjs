// Local UI regression: synthetic Tauri bridge only; no OAuth/cloud/Keychain calls.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const origin = process.argv[2] ?? "http://127.0.0.1:3229";
const browser = await chromium.launch({
  executablePath:
    process.env.ANYWORK_TEST_CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.addInitScript(() => {
    const signedOut = () => ({
      authorizationStatus: "signedOut",
      transactionId: null,
      signedIn: false,
      subject: null,
      enabled: false,
      busy: false,
      accountLabel: null,
      error: null,
      gridDeviceId: null,
      installationId: null,
      publicKey: null,
      accountPortalUrl: "https://devices.fixture.invalid/app/",
      remoteClients: [],
    });
    window.fixtureAccount = signedOut();
    window.fixtureMode = "fail";
    window.fixtureUrls = [];
    window.fixtureCalls = [];
    let callbackReject;
    window.__TAURI__ = {
      core: {
        invoke: async (command, args) => {
          window.fixtureCalls.push(command);
          if (command === "desktop_snapshot")
            return {
              config: {
                workspace: "/isolated-fixture",
                dataDirectory: "/isolated-fixture/data",
                port: 9000,
                allowLAN: false,
                serverBinary: "",
                cloudflaredBinary: "",
                tunwgBinary: "",
                publicURL: "",
                relayDomain: "",
                forceRelay: false,
                welcomed: true,
              },
              token: "",
              secrets: ["", "", ""],
              secrets_loaded: false,
              service: window.fixtureLocalReady ? "running" : "off",
              owned: false,
              external: false,
              authorized: Boolean(window.fixtureLocalReady),
              clients: [],
              routes: [0, 1, 2].map(() => ({
                phase: "off",
                url: "",
                error: "",
              })),
              error: "",
              notice: "",
            };
          if (command === "desktop_start") {
            if (!window.fixtureAccount.signedIn)
              throw new Error("DESKTOP_SIGN_IN_REQUIRED");
            window.fixtureLocalReady = true;
            return;
          }
          if (command === "desktop_preview") return null;
          if (command === "desktop_update_snapshot")
            return {
              currentVersion: "0.1.13",
              version: "",
              notes: "",
              phase: "idle",
              downloaded: 0,
              total: null,
              lastChecked: null,
              error: "",
              enabled: false,
              showNotice: false,
              supported: true,
            };
          if (command === "account_snapshot") {
            if (window.fixtureSnapshotFailures > 0) {
              window.fixtureSnapshotFailures--;
              throw new Error("fixture IPC cleanup read failed");
            }
            return { ...window.fixtureAccount };
          }
          if (command === "account_begin") {
            if (window.fixtureMode === "fail")
              throw new Error("fixture timeout before grant");
            window.fixtureAccount = {
              ...signedOut(),
              authorizationStatus: "authorizing",
              busy: true,
              transactionId: "fixture-login",
            };
            return {
              transactionId: "fixture-login",
              endpoint: "https://identity.fixture.invalid",
              issuer: "https://identity.fixture.invalid/oidc",
              appId: "fixture-native",
              resource: "https://grid.fixture.invalid/api",
              scope: "openid profile offline_access custom_data connect",
              redirectUri: "http://127.0.0.1:17897/callback",
            };
          }
          if (command === "account_fetch")
            return {
              status: 200,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                issuer: "https://identity.fixture.invalid/oidc",
                authorization_endpoint:
                  "https://identity.fixture.invalid/oidc/auth",
                token_endpoint: "https://identity.fixture.invalid/oidc/token",
                jwks_uri: "https://identity.fixture.invalid/oidc/jwks",
                end_session_endpoint:
                  "https://identity.fixture.invalid/oidc/session/end",
              }),
            };
          if (command === "account_open") {
            window.fixtureUrls.push(args.url);
            if (window.fixtureMode === "cleanupReadFailure") {
              window.fixtureAccount = signedOut();
              window.fixtureSnapshotFailures = 1;
              throw new Error("fixture native already cancelled");
            }
            if (window.fixtureMode === "capture")
              throw new Error("fixture stops before external navigation");
            return;
          }
          if (command === "account_wait_callback")
            return new Promise((_, reject) => {
              callbackReject = reject;
            });
          if (command === "account_cancel") {
            window.fixtureAccount = signedOut();
            callbackReject?.(new Error("fixture cancelled"));
            return;
          }
          if (command === "account_enable_default") return;
          if (command === "account_enable") throw window.fixtureEnableError;
          if (command === "account_logout") {
            window.fixtureAccount = signedOut();
            return;
          }
          throw new Error("Unexpected fixture command " + command);
        },
      },
    };
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  const entry = page.getByRole("region", { name: "AnyWork 账号入口" });
  await expect(
    entry.getByRole("button", { name: "创建账号", exact: true }),
  ).toBeVisible();
  await expect(
    entry.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeVisible();
  await entry
    .getByRole("button", { name: "登录已有账号", exact: true })
    .click();
  await expect(entry.getByRole("alert")).toBeVisible();
  await expect(
    entry.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeEnabled();
  await expect(
    entry.getByRole("button", { name: "创建账号", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "退出账号", exact: true }),
  ).toHaveCount(0);
  await expect(
    entry.getByRole("status").filter({ hasText: "尚未登录" }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/anywork-desktop-account-entry.png" });
  for (const [button, screen] of [
    ["创建账号", "register"],
    ["登录已有账号", "signIn"],
  ]) {
    await page.evaluate(() => {
      window.fixtureMode = "capture";
    });
    await entry.getByRole("button", { name: button, exact: true }).click();
    await expect(
      entry.getByRole("button", { name: "登录已有账号", exact: true }),
    ).toBeEnabled();
    const raw = await page.evaluate(() => window.fixtureUrls.at(-1));
    const url = new URL(raw);
    assert.equal(url.searchParams.get("first_screen"), screen);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "http://127.0.0.1:17897/callback",
    );
    assert.ok(url.searchParams.get("state"));
  }
  await page.evaluate(() => {
    window.fixtureMode = "cleanupReadFailure";
  });
  await entry
    .getByRole("button", { name: "登录已有账号", exact: true })
    .click();
  await expect(
    entry.getByRole("button", { name: "取消登录", exact: true }),
  ).toBeVisible();
  await expect(
    entry.getByRole("button", { name: "退出账号", exact: true }),
  ).toHaveCount(0);
  await entry.getByRole("button", { name: "取消登录", exact: true }).click();
  await expect(
    entry.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeEnabled();
  // Cancel while the original login promise is pending, then retry: the stale
  // JS adapter must not survive an already completed native cancellation.
  await page.evaluate(() => {
    window.fixtureMode = "wait";
  });
  await entry
    .getByRole("button", { name: "登录已有账号", exact: true })
    .click();
  await expect(
    entry.getByRole("button", { name: "取消登录", exact: true }),
  ).toBeVisible();
  await entry.getByRole("button", { name: "取消登录", exact: true }).click();
  await expect(
    entry.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.fixtureMode = "capture";
  });
  const before = await page.evaluate(() => window.fixtureUrls.length);
  await entry
    .getByRole("button", { name: "登录已有账号", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.fixtureUrls.length))
    .toBe(before + 1);
  await expect(
    entry.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", {
      name: "登录，让其他设备找到这台电脑",
      exact: true,
    }),
  ).toBeVisible();

  for (const retired of [
    "匿名隧道",
    "固定隧道",
    "WireGuard",
    "访问密钥",
    "配对链接",
  ])
    await expect(page.getByText(retired, { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(/登录并准备工作区后，将默认开启远程访问/),
  ).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("连接与隐私说明", { exact: true }).click();
  await expect(
    page.getByText("账号凭据和设备私钥只留在内存", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.evaluate(() => {
    window.fixtureAccount = {
      ...window.fixtureAccount,
      authorizationStatus: "signedIn",
      signedIn: true,
      subject: "fixture-owner",
      accountLabel: "person@example.org",
    };
  });
  await expect(
    page.getByRole("status").filter({ hasText: "已登录 · person@example.org" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重试保存账号", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    window.fixtureLocalReady = true;
  });
  const enable = page.getByRole("button", {
    name: /^(开启远程访问|重试开启远程)$/,
  });
  await expect(enable).toBeEnabled();
  for (const code of [
    "REMOTE_ENABLE_PROVIDER",
    "REMOTE_ENABLE_GRID_CONFIG",
    "REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE",
    "REMOTE_ENABLE_GRID_REGISTER",
    "REMOTE_ENABLE_INDEX_READ",
    "REMOTE_ENABLE_INDEX_SCHEMA",
    "REMOTE_ENABLE_INDEX_WRITE",
    "REMOTE_ENABLE_INDEX_READBACK",
  ]) {
    await page.evaluate((code) => {
      window.fixtureEnableError = code;
    }, code);
    const before = await page.evaluate(
      () => window.fixtureCalls.filter((v) => v === "account_enable").length,
    );
    await enable.click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).not.toContainText(code);
    const details = page.locator(".error-details");
    if ((await details.getAttribute("open")) === null)
      await details.locator("summary").click();
    await expect(details.getByText(code, { exact: true })).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => window.fixtureCalls.filter((v) => v === "account_enable").length,
      ),
      before + 1,
    );
  }
  await page.evaluate(() => {
    window.fixtureEnableError =
      "provider body https://secret.invalid/?token=do-not-display";
  });
  await enable.click();
  await expect(page.getByRole("alert")).toHaveText(
    "账号操作未完成，请检查登录状态和网络后重试。",
  );
  await expect(page.getByText("do-not-display", { exact: false })).toHaveCount(
    0,
  );
  await page.evaluate(() => {
    window.fixtureAccount = {
      ...window.fixtureAccount,
      authorizationStatus: "reauthRequired",
      signedIn: false,
    };
  });
  await expect(
    page.getByRole("button", { name: "结束本次授权后重新登录", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "结束本次授权后重新登录", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "登录已有账号", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "本机设置", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("服务数据目录", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "访问密钥", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await entry.getByRole("button", { name: "创建账号", exact: true }).focus();
  const keyboardBefore = await page.evaluate(() => window.fixtureUrls.length);
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.fixtureUrls.length))
    .toBe(keyboardBefore + 1);
  await page.screenshot({
    path: "/tmp/anywork-desktop-unified-account-entry.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Desktop account entry: failure retry, separate official screens, pending cancellation race, memory-only notice, account identity, reauth and safe enable-stage controls passed.",
  );
} finally {
  await browser.close();
}
