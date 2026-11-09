import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

// Local UI fixtures only: this check never logs in or contacts cloud services.
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".html": "text/html",
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    const file =
      path === "/" || path.startsWith("/app")
        ? resolve(dist, "index.html")
        : resolve(dist, "." + path);
    if (!file.startsWith(dist)) throw new Error();
    const bytes = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
});
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      locale: "zh-CN",
      serviceWorkers: "block",
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin)
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<h1>Isolated account destination fixture</h1>",
        });
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const data =
        url.pathname === "/api/info"
          ? {
              workspace: "/isolated-workspace",
              hostname: "fixture",
              client_presence: false,
            }
          : url.pathname === "/api/sessions"
            ? { sessions: [] }
            : url.pathname === "/api/plugins"
              ? { plugins: [] }
              : url.pathname === "/api/workspaces"
                ? { workspaces: [] }
                : {};
      return route.fulfill({ json: data });
    });
    const page = await context.newPage();
    await page.goto(origin);
    await expect(
      page.getByRole("heading", { name: "登录查看你的设备" }),
    ).toBeVisible();
    const signup = page.getByRole("link", {
      name: "注册账号（在新标签页打开）",
      exact: true,
    });
    await expect(signup).toHaveAttribute(
      "href",
      "https://anywork-tau.vercel.app/app/?signup=1",
    );
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      signup.click(),
    ]);
    await expect(popup).toHaveURL(
      "https://anywork-tau.vercel.app/app/?signup=1",
    );
    await expect(
      page.getByRole("heading", { name: "登录查看你的设备" }),
    ).toBeVisible();
    await popup.close();
    const saved = JSON.stringify({ url: origin, token: "isolated-ui-fixture" });
    await page.evaluate(
      (value) => localStorage.setItem("ra.connection", value),
      saved,
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "从哪里开始？" }),
    ).toBeVisible();
    const entry = page.getByRole("link", {
      name: "登录查看设备（在新标签页打开）",
      exact: true,
    });
    await expect(entry).toBeVisible();
    await entry.focus();
    await expect(entry).toBeFocused();
    const [workspacePopup] = await Promise.all([
      page.waitForEvent("popup"),
      entry.press("Enter"),
    ]);
    await expect(workspacePopup).toHaveURL(
      "https://anywork-tau.vercel.app/app/",
    );
    await expect(
      page.getByRole("heading", { name: "从哪里开始？" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("ra.connection")),
    ).toBe(saved);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/anywork-client-account-${width}.png` });
    await workspacePopup.close();
    // Account mode must not restore the manual connection already stored above.
    await page.goto(origin + "/app/");
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "注册账号", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "从哪里开始？" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("ra.connection")),
    ).toBe(saved);
    await page.goto(origin + "/app/callback");
    await expect(
      page.getByRole("link", { name: "重新登录 / Try again" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "重新登录 / Try again" }).click();
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await context.close();
  }
  console.log(
    "Client account entry: 1440/390px, signup/login popup, keyboard, retained manual connection, isolated account mode and callback recovery passed.",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
