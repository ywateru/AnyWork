/** Actual AccountApp storage listener + installed Logto SDK, opaque/resource
 * caches and refresh. No token/claims getter overrides. All grants/HTTP synthetic.
 * PLAYWRIGHT_CHANNEL=chrome node web/scripts/account-owner.check.mjs */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";

const output = path.resolve("artifacts/account-identity-visible");
await mkdir(output, { recursive: true });
const account = {
  VITE_LOGTO_ENDPOINT: "https://oidc.fixture.invalid",
  VITE_LOGTO_APP_ID: "identity-fixture",
  VITE_LOGTO_RESOURCE: "https://grid.fixture.invalid/api",
  VITE_CYBERGRID_URL: "https://grid.fixture.invalid",
  VITE_CYBERGRID_NATIVE_APP_ID: "native-fixture",
};
const issuer = account.VITE_LOGTO_ENDPOINT + "/oidc";
const resource = account.VITE_LOGTO_RESOURCE;
const prefix =
  "logto:anywork:" +
  encodeURIComponent(issuer) +
  ":" +
  account.VITE_LOGTO_APP_ID +
  ":";
function grant(subject, generation = subject, accessSeconds = 3600) {
  const now = Date.now() / 1000;
  const encoded = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    idToken: [
      encoded({ alg: "ES384" }),
      encoded({
        sub: subject,
        username: subject + " user",
        iss: issuer,
        aud: account.VITE_LOGTO_APP_ID,
        iat: now,
        exp: now + 3600,
      }),
      "synthetic-persisted-grant",
    ].join("."),
    refreshToken: "refresh-" + generation,
    accessToken: JSON.stringify(
      Object.fromEntries(
        ["", resource].map((r) => [
          "@" + r,
          {
            token: generation + (r ? "-resource" : "-opaque"),
            expiresAt: now + accessSeconds,
            scope: "openid profile connect",
          },
        ]),
      ),
    ),
  };
}
const server = await createServer({
  configFile: path.resolve("web/vite.config.ts"),
  configLoader: "runner",
  root: path.resolve("web"),
  cacheDir: path.join(output, "vite-owner-cache"),
  logLevel: "error",
  define: Object.fromEntries(
    Object.entries(account).map(([k, v]) => [
      "import.meta.env." + k,
      JSON.stringify(v),
    ]),
  ),
  server: { host: "127.0.0.1", port: 0, open: false },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
});
async function fixture() {
  const context = await browser.newContext({
    locale: "en",
    serviceWorkers: "block",
  });
  await context.route("**/identity-blank", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Synthetic grant writer</title>",
    }),
  );
  // Observe constructed instances only. All authentication, claims, token getter,
  // SDK storage and owner retirement methods remain the production implementation.
  await context.route("**/src/accountAuth.ts", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import {AccountLogtoClient as RealOwner} from '/src/accountAuth.ts?owner-original';
    export {withAccountSubject,accountScopes} from '/src/accountAuth.ts?owner-original';
    export class AccountLogtoClient extends RealOwner {
      constructor(...args){super(...args);(window.fixtureOwners??=[]).push(this);}
    }`,
    }),
  );
  await context.route("**/src/vendor/cybergrid/index.ts", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export class CyberGridClient {
    async connect(){} async disconnect(){} async devices(){return [];}
  }`,
    }),
  );
  const headers = [],
    navigations = [],
    errors = [];
  let held, tokenStarted;
  await context.route("https://**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/my-account") {
      const authorization = route.request().headers().authorization;
      headers.push(authorization);
      return route.fulfill({
        json: {
          customData: {
            anywork: {
              schemaVersion: 1,
              devices: {
                computer: {
                  label: "Computer for " + authorization,
                  platform: "macOS",
                  publicKey: "A".repeat(43),
                  keyVersion: 1,
                  gridDeviceId: "fixture-device",
                },
              },
            },
          },
        },
      });
    }
    if (url.pathname.includes(".well-known"))
      return route.fulfill({
        json: { token_endpoint: "https://oidc.fixture.invalid/token" },
      });
    if (url.pathname === "/token") {
      tokenStarted = route.request().postData();
      await new Promise((resolve) => {
        held = resolve;
      });
      return route.fulfill({
        json: {
          access_token: "late-A",
          refresh_token: "late-A-refresh",
          expires_in: 300,
          scope: "connect",
        },
      });
    }
    navigations.push(url.pathname);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  const writer = await context.newPage();
  await writer.goto(origin + "/identity-blank");
  const write = async (value) =>
    writer.evaluate(
      ({ prefix, value }) => {
        for (const key of ["accessToken", "refreshToken", "idToken"]) {
          if (value) localStorage.setItem(prefix + key, value[key]);
          else localStorage.removeItem(prefix + key);
        }
      },
      { prefix, value },
    );
  await write(grant("A", "A", 300));
  await page.goto(origin + "/app/");
  const summary = page.locator(".account-user-menu summary");
  await expect(summary).toHaveAttribute("title", "A user");
  await expect.poll(() => headers.length).toBeGreaterThan(0);
  expect(headers.every((value) => value === "Bearer A-opaque")).toBe(true);
  await page.evaluate(async (resource) => {
    for (const owner of window.fixtureOwners) {
      if ((await owner.getAccountAccessToken()) !== "A-opaque")
        throw Error("A opaque cache not loaded");
      if ((await owner.getAccountAccessToken(resource)) !== "A-resource")
        throw Error("A resource cache not loaded");
    }
    window.fixtureOldOwners = [...window.fixtureOwners];
  }, resource);
  return {
    page,
    writer,
    write,
    summary,
    headers,
    async startRotation() {
      await page.clock.setFixedTime(Date.now() + 600_000);
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect.poll(() => tokenStarted).toBeTruthy();
      expect(new URLSearchParams(tokenStarted).get("refresh_token")).toBe(
        "refresh-A",
      );
    },
    release() {
      held();
    },
    async snapshot() {
      return writer.evaluate(
        (prefix) =>
          Object.fromEntries(
            ["idToken", "refreshToken", "accessToken"].map((k) => [
              k,
              localStorage.getItem(prefix + k),
            ]),
          ),
        prefix,
      );
    },
    async close() {
      expect(errors).toEqual([]);
      expect(navigations).toEqual([]);
      await context.close();
    },
  };
}
async function assertCurrent(f, expected, token) {
  await expect(f.summary).toHaveAttribute("title", expected + " user");
  await expect.poll(() => f.headers.at(-1)).toBe("Bearer " + token + "-opaque");
  await expect(
    f.page.getByRole("heading", {
      name: "Computer for Bearer " + token + "-opaque",
      exact: true,
    }),
  ).toBeVisible();
  await f.page.evaluate(
    async ({ resource, token }) => {
      const old = new Set(window.fixtureOldOwners);
      let currentOwners = 0;
      for (const owner of window.fixtureOwners.filter((o) => !old.has(o))) {
        // A batch of cross-tab writes can retire an intermediate owner too.
        // Every owner that still returns tokens must belong to the final grant.
        let values;
        try {
          values = await Promise.all([
            owner.getAccountAccessToken(),
            owner.getAccountAccessToken(resource),
          ]);
        } catch {
          continue;
        }
        if (values[0] !== token + "-opaque")
          throw Error("New SDK returned wrong opaque cache");
        if (values[1] !== token + "-resource")
          throw Error("New SDK returned wrong resource cache");
        currentOwners++;
      }
      if (!currentOwners) throw Error("No current SDK owner");
      for (const owner of old) {
        try {
          await owner.getAccountAccessToken();
        } catch {
          continue;
        }
        throw Error("Old SDK owner still returned a token");
      }
    },
    { resource, token },
  );
}
try {
  {
    const f = await fixture();
    await f.write(grant("B"));
    await assertCurrent(f, "B", "B");
    await f.page.screenshot({
      path: path.join(output, "sdk-storage-owner-B.png"),
    });
    await f.close();
    console.log(
      "Passed real SDK A opaque/resource caches -> cross-tab storage event -> B UI, directory and tokens; old owner rejected.",
    );
  }
  for (const replacement of ["B", "logout", "A-again"]) {
    const f = await fixture();
    await f.startRotation();
    await f.write(grant("B"));
    if (replacement === "logout") await f.write(null);
    if (replacement === "A-again") await f.write(grant("A", "new-A"));
    const before = await f.snapshot();
    await expect(f.page.locator(".account-user-menu")).toHaveCount(0);
    f.release();
    if (replacement === "logout") {
      await expect(
        f.page.getByRole("heading", { name: "Sign in", exact: true }),
      ).toBeVisible();
    } else
      await assertCurrent(
        f,
        replacement === "B" ? "B" : "A",
        replacement === "B" ? "B" : "new-A",
      );
    expect(await f.snapshot()).toEqual(before);
    await f.close();
    console.log(
      `Passed held real SDK A rotation -> ${replacement}: drained retired owner, replacement storage preserved, no automatic login.`,
    );
  }
} finally {
  await browser.close();
  await server.close();
}
