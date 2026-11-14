/** Render AccountApp with the installed Logto client and actual vendored Grid
 * SDK. Only HTTP/storage grants are synthetic; no real login, user or device.
 * PLAYWRIGHT_CHANNEL=chrome node web/scripts/account-presence.check.mjs */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium, devices, expect } from "@playwright/test";

const output = path.resolve("artifacts/mobile-web-presence");
await mkdir(output, { recursive: true });
const config = {
  VITE_LOGTO_ENDPOINT: "https://identity.fixture.invalid",
  VITE_LOGTO_APP_ID: "presence-fixture",
  VITE_LOGTO_RESOURCE: "https://grid.fixture.invalid/api",
  VITE_CYBERGRID_URL: "https://grid.fixture.invalid",
  VITE_CYBERGRID_NATIVE_APP_ID: "native-fixture",
};
const issuer = config.VITE_LOGTO_ENDPOINT + "/oidc";
const epoch = "00000000-0000-4000-8000-000000000001";
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims) =>
  [encode({ alg: "ES384" }), encode(claims), "synthetic-stored-grant"].join(
    ".",
  );
const server = await createServer({
  configFile: path.resolve("web/vite.config.ts"),
  configLoader: "runner",
  root: path.resolve("web"),
  cacheDir: path.join(output, "vite-cache"),
  logLevel: "error",
  define: Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      "import.meta.env." + key,
      JSON.stringify(value),
    ]),
  ),
  server: { host: "127.0.0.1", port: 0, open: false },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
});
const results = [];
try {
  for (const [mode, stage, code, locale = "zh-CN", mobile = true] of [
    ["healthy", null, null],
    ["config-network", "在线状态服务配置", "NETWORK_ERROR"],
    ["config-mismatch", "在线状态服务配置", "CONFIGURATION_MISMATCH"],
    ["token-network", "在线状态授权", "AUTHENTICATION_FAILED"],
    ["exchange-denied", "在线状态服务会话", "FORBIDDEN / HTTP 403"],
    ["devices-network", "设备在线状态查询", "NETWORK_ERROR"],
    ["invalid-devices", "设备在线状态查询", "INVALID_RESPONSE"],
    ["account-network", "账号设备资料", "ACCOUNT_UNAVAILABLE"],
    [
      "config-network",
      "Presence service configuration",
      "NETWORK_ERROR",
      "en",
      false,
    ],
    ["healthy", null, null, "en", false],
  ].filter(
    ([mode]) =>
      !process.env.PRESENCE_CASE || mode === process.env.PRESENCE_CASE,
  )) {
    const context = await browser.newContext({
      ...(mobile ? devices["Pixel 7"] : devices["Desktop Chrome"]),
      locale,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [],
      calls = [];
    let recovered = false,
      accountReads = 0;
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    await page.addInitScript(
      ({ config, issuer, jwt, resourceToken, expires, locale }) => {
        localStorage.setItem("anywork.account.locale", locale);
        const prefix = `logto:anywork:${encodeURIComponent(issuer)}:${config.VITE_LOGTO_APP_ID}:`;
        localStorage.setItem(prefix + "idToken", jwt);
        localStorage.setItem(prefix + "refreshToken", "synthetic-refresh");
        localStorage.setItem(
          prefix + "accessToken",
          JSON.stringify({
            "@": {
              token: "synthetic-opaque",
              expiresAt: expires,
              scope: "openid profile custom_data",
            },
            ["@" + config.VITE_LOGTO_RESOURCE]: {
              token: resourceToken,
              expiresAt: expires,
              scope: "connect",
            },
          }),
        );
      },
      {
        config,
        issuer,
        locale,
        jwt: jwt({
          sub: "fixture-owner",
          username: "Synthetic user",
          iss: issuer,
          aud: config.VITE_LOGTO_APP_ID,
          iat: Date.now() / 1000,
          exp: Date.now() / 1000 + 3600,
        }),
        resourceToken: jwt({
          exp: Date.now() / 1000 + (mode === "token-network" ? 1 : 3600),
        }),
        expires: Date.now() / 1000 + 3600,
      },
    );
    await context.route("https://**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      calls.push({ path: url.pathname, method: request.method() });
      const active = recovered ? "healthy" : mode;
      const send = (json, status = 200) =>
        route.fulfill({
          status,
          json,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-expose-headers": "X-CyberGrid-Epoch",
            "x-cybergrid-epoch": epoch,
          },
        });
      if (url.pathname === "/api/my-account") {
        accountReads++;
        expect(request.headers().authorization).toBe("Bearer synthetic-opaque");
        // Retain an initial successful read just as in the reported screenshot.
        if (active === "account-network" && accountReads > 1)
          return route.abort();
        return send({
          customData: {
            anywork: {
              schemaVersion: 1,
              devices: {
                computer: {
                  label: "Synthetic computer",
                  platform: "macOS",
                  publicKey: "A".repeat(43),
                  keyVersion: 1,
                  gridDeviceId: "fixture-device",
                },
              },
            },
          },
        });
      }
      if (url.pathname.includes(".well-known"))
        return send({
          token_endpoint: config.VITE_LOGTO_ENDPOINT + "/oidc/token",
        });
      if (url.pathname === "/oidc/token") return route.abort();
      if (url.pathname === "/api/v1/console/auth/config") {
        if (active === "config-network") return route.abort();
        return send({
          provider: "logto",
          issuer,
          clientId:
            active === "config-mismatch"
              ? "wrong-fixture"
              : config.VITE_LOGTO_APP_ID,
          resource: config.VITE_LOGTO_RESOURCE,
          scope: "openid offline_access profile email connect",
          authorizationEndpoint: issuer + "/auth",
          tokenEndpoint: issuer + "/token",
          revocationEndpoint: issuer + "/token/revocation",
          jwksUri: issuer + "/jwks",
          coordination: { protocol: "memory-v1", epoch },
        });
      }
      if (url.pathname === "/api/v1/console/auth/exchange") {
        if (active === "exchange-denied")
          return send(
            {
              error: { code: "FORBIDDEN", message: "private-fixture-response" },
            },
            403,
          );
        return send({
          purpose: "console",
          sessionKey: "s".repeat(43),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          coordinatorEpoch: epoch,
          user: { id: "fixture-owner" },
        });
      }
      if (url.pathname === "/api/v1/console/devices") {
        expect(url.searchParams.get("appId")).toBe(
          config.VITE_CYBERGRID_NATIVE_APP_ID,
        );
        if (active === "devices-network") return route.abort();
        return send({
          devices: [
            {
              id: "fixture-device",
              name: "Synthetic computer",
              online: true,
              lastSeen:
                active === "invalid-devices"
                  ? "bad-date"
                  : new Date().toISOString(),
              ports: [
                {
                  id: "anywork-remote",
                  type: "anywork-noise-v1",
                  transport: "tcp",
                  port: 4000,
                  tunnelUrl: "https://fixture.trycloudflare.com",
                },
              ],
            },
          ],
        });
      }
      if (url.pathname === "/api/v1/console/session") return send({ ok: true });
      throw new Error("Unexpected fixture HTTP path: " + url.pathname);
    });
    await page.goto(origin + "/app/");
    await expect(
      page.getByRole("heading", { name: "Synthetic computer", exact: true }),
    ).toBeVisible();
    const open = page.getByRole("button", {
      name: locale === "en" ? "Open workspace" : "打开工作区",
      exact: true,
    });
    if (mode === "healthy") {
      await expect(open).toBeEnabled();
      await expect(page.locator(".account-warning")).toHaveCount(0);
    } else {
      const warning = page.locator(".account-warning");
      await expect(warning).toContainText(
        locale === "en"
          ? "Device status is temporarily unavailable."
          : "暂时无法确认设备状态，请刷新重试。",
      );
      await warning.locator("summary").click();
      await expect(warning).toContainText(stage);
      await expect(warning.locator("code")).toHaveText(code);
      await expect(open).toBeDisabled();
      await expect(warning.getByRole("link")).toHaveAttribute(
        "href",
        config.VITE_CYBERGRID_URL +
          "/api/v1/console/auth/config?clientId=" +
          encodeURIComponent(config.VITE_LOGTO_APP_ID),
      );
      await expect(warning).toContainText(
        locale === "en"
          ? "Reachability does not confirm account authorization."
          : "仅检查公网可达性，不代表账号授权已通过",
      );
      expect(await page.locator("body").innerText()).not.toMatch(
        /synthetic-(opaque|refresh)|private-fixture-response/,
      );
      await page.screenshot({
        path: path.join(output, mode + (mobile ? "" : "-desktop-en") + ".png"),
      });
      if (
        [
          "config-network",
          "config-mismatch",
          "token-network",
          "account-network",
        ].includes(mode)
      )
        expect(
          calls.some((call) => call.path === "/api/v1/console/auth/exchange"),
        ).toBe(false);
      if (mode === "devices-network") {
        expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
        recovered = true;
        await page.getByRole("button", { name: "刷新", exact: true }).click();
        await expect(open).toBeEnabled();
        await expect(warning).toHaveCount(0);
      }
    }
    expect(errors).toEqual([]);
    results.push({
      mode,
      locale,
      mobileEmulation: mobile,
      passed: true,
      requests: calls,
    });
    await context.close();
    console.log(mode + ": passed");
  }
  await writeFile(
    path.join(output, "component-results.json"),
    JSON.stringify(results, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
}
