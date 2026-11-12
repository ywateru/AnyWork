import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
// Render-only local fixtures. Real cookie/PTY integration is account-unified.spec.ts.
const output = "artifacts/ui-v2-web";
await mkdir(output, { recursive: true });
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
    res.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(await readFile(file));
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
    let local = false,
      expired = false;
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin)
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<h1>Isolated account destination</h1>",
        });
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (url.pathname === "/api/local/session")
        return route.fulfill({
          status: local ? 200 : 401,
          json: local
            ? { accountLabel: "Fixture", remoteEnabled: false }
            : { error: "LOCAL_SESSION_REQUIRED" },
        });
      if (expired)
        return route.fulfill({
          status: 401,
          json: { error: "LOCAL_SESSION_REQUIRED" },
        });
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
                : { events: [], cursor: 0 };
      return route.fulfill({ json: data });
    });
    await context.addInitScript(() => {
      localStorage.setItem(
        "ra.connection",
        JSON.stringify({ url: "https://retired.invalid", token: "obsolete" }),
      );
      window.RemoteAgentAndroid = {
        getConnection() {
          throw new Error("retired bridge called");
        },
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await expect(
      page.getByRole("heading", { name: "这台电脑的工作区" }),
    ).toBeVisible();
    await expect(page.locator("input")).toHaveCount(0);
    const signup = page.getByRole("link", {
      name: "注册账号（在新标签页打开）",
      exact: true,
    });
    await expect(signup).toHaveAttribute(
      "href",
      "https://anywork.aixgg.com/app/?signup=1",
    );
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      signup.click(),
    ]);
    await expect(popup).toHaveURL("https://anywork.aixgg.com/app/?signup=1");
    await popup.close();
    local = true;
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "从哪里开始？" }),
    ).toBeVisible();
    if (width < 720)
      await page.getByRole("button", { name: "会话列表", exact: true }).click();
    await page.locator(".workspace-account-menu > summary").click();
    await expect(page.locator(".workspace-context")).toContainText(
      "由 Fixture 在本机打开",
    );
    await expect(
      page
        .locator(".workspace-account-menu")
        .getByRole("link", { name: "账号与设备（在新标签页打开）" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${output}/anywork-unified-workspace-${width}.png`,
      fullPage: true,
    });
    expired = true;
    await expect(
      page.getByRole("heading", { name: "这台电脑的工作区" }),
    ).toBeVisible({ timeout: 5000 });
    await page.goto(origin + "/app/");
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("高级连接", { exact: true })).toHaveCount(0);
    await expect(page.locator("input")).toHaveCount(0);
    await page.screenshot({
      path: `${output}/anywork-unified-account-${width}.png`,
      fullPage: true,
    });
    await page.goto(origin + "/app/callback");
    await expect(page.getByText(/登录未完成/)).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
    console.log(
      `Passed ${width}px: unified entry, ignored old connection/bridge, local context, 401 teardown, mobile layout, callback recovery (render fixtures only)`,
    );
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
