/** API presentation fixtures only: all create/patch requests are intercepted,
 * never launches an agent or sends native work.
 * Run after npm run build: PLAYWRIGHT_CHANNEL=chrome node web/scripts/claude-agents.check.mjs */
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("web/dist");
const server = createServer(async (req, res) => {
  try {
    let file = path.resolve(
      root,
      "." + new URL(req.url, "http://localhost").pathname,
    );
    if (file !== root && !file.startsWith(root + path.sep))
      throw new Error("Invalid path");
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    const types = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {},
);
await mkdir("artifacts", { recursive: true });
try {
  for (const width of [1440, 390])
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors = [],
        writes = [];
      let ready = false;
      page.on("pageerror", (error) => errors.push(error.message));
      const ids = ["claude-code", "claude-desktop", "future-agent"];
      const sessions = ids.map((agent, index) => ({
        id: agent,
        thread_id: agent,
        title: `${agent} history`,
        agent,
        cwd: "/work",
        model: null,
        policy: agent === "claude-code" ? "auto" : "manual",
        status: "idle",
        archived: false,
        created_at: 1,
        updated_at: index + 1,
      }));
      await page.route("**/api/**", async (route) => {
        const request = route.request(),
          url = new URL(request.url()),
          pathname = url.pathname.slice(4);
        if (request.method() !== "GET") {
          const body = request.postDataJSON();
          writes.push({ path: pathname, body });
          if (
            request.method() === "PATCH" &&
            pathname === "/sessions/claude-code" &&
            body.policy === "manual"
          ) {
            sessions.find((session) => session.id === "claude-code").policy =
              "manual";
            return route.fulfill({ json: { ok: true } });
          }
          return route.fulfill({
            status: 400,
            json: { error: "presentation fixture: no execution" },
          });
        }
        let data = {};
        if (pathname === "/local/session") data = { remoteEnabled: false };
        else if (pathname === "/info")
          data = {
            workspace: "/work",
            hostname: "Claude fixture",
            client_presence: false,
          };
        else if (pathname === "/plugins")
          data = {
            plugins: ids.map((id) => ({
              id,
              name:
                id === "future-agent"
                  ? "Future Agent"
                  : "untrusted alternative name",
              protocol_version: 1,
              capabilities: [
                "chat",
                "models",
                ...(id === "future-agent" ? [] : ["manual-approvals-only"]),
              ],
              available: id !== "claude-desktop" || ready,
              setup_hint:
                id === "claude-desktop" && !ready
                  ? "需组织政策允许的有效原生入口／本地桥接"
                  : null,
            })),
          };
        else if (pathname === "/sessions") data = { sessions };
        else if (pathname === "/workspaces") data = { workspaces: [] };
        else if (pathname.endsWith("/history"))
          data = { events: [], latest_seq: 0, next_cursor: null };
        else if (pathname.endsWith("/queue"))
          data = { items: [], paused: false };
        else if (pathname.endsWith("/models")) data = { data: [] };
        else if (pathname.endsWith("/feedback")) data = { feedback: [] };
        else if (pathname.endsWith("/composer"))
          data = {
            settings_available: false,
            models: [],
            goal: null,
            goal_capabilities: {
              create: false,
              edit: false,
              resume: false,
              clear: false,
              pause: false,
            },
            plan: false,
            plan_available: false,
            service_tier_available: false,
          };
        else if (pathname.endsWith("/events/poll"))
          data = { events: [], cursor: 0 };
        else if (pathname.endsWith("/events"))
          return route.fulfill({
            contentType: "text/event-stream",
            body: ": heartbeat\n\n",
          });
        else if (/^\/sessions\/[^/]+$/.test(pathname))
          data = {
            session: sessions.find((s) => s.id === pathname.split("/")[2]),
          };
        return route.fulfill({ json: data });
      });
      await page.addInitScript(
        (theme) => localStorage.setItem("ra.theme", theme),
        theme,
      );
      await page.goto(base + "/");
      await expect(page.locator(".sidebar-agent-filter")).toBeAttached();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      if (width < 720)
        await page
          .getByRole("button", { name: "会话列表", exact: true })
          .filter({ visible: true })
          .click();
      const menu = page.locator(".sidebar-agent-filter");
      await menu.locator("summary").click();
      await expect(
        menu.getByRole("button", { name: "Claude Code", exact: true }),
      ).toBeVisible();
      await expect(
        menu.getByRole("button", { name: "Claude Desktop Code", exact: true }),
      ).toBeVisible();
      await expect(
        menu.getByRole("button", { name: "Future Agent", exact: true }),
      ).toBeVisible();
      await menu
        .getByRole("button", { name: "Future Agent", exact: true })
        .click();
      await expect(page.locator(".session-row")).toHaveCount(1);
      await expect(page.locator(".session-row")).toHaveAttribute(
        "title",
        /Future Agent/,
      );
      await menu.locator("summary").click();
      await menu
        .getByRole("button", { name: "Claude Desktop Code", exact: true })
        .click();
      await expect(page.locator(".session-row")).toHaveCount(1);
      await expect(page.locator(".session-row")).toContainText(
        "claude-desktop history",
      );
      await expect(
        page.locator('.session-row [data-agent-icon="claude-desktop"] img'),
      ).toBeVisible();
      await page.screenshot({
        path: `artifacts/claude-sidebar-${width}-${theme}.png`,
      });
      await page.getByRole("button", { name: "新建会话", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "新建会话" });
      const select = dialog.getByLabel("Agent", { exact: true });
      await expect(select.locator("option")).toHaveCount(3);
      await select.selectOption("claude-desktop");
      await expect(dialog.getByRole("status")).toContainText("本地桥接");
      await expect(
        dialog.getByRole("button", { name: "创建会话" }),
      ).toBeDisabled();
      await dialog.getByLabel("工作目录", { exact: true }).press("Enter");
      expect(writes).toEqual([]);
      ready = true;
      await dialog.getByRole("button", { name: "重新检查连接" }).click();
      await expect(select).toHaveValue("claude-desktop");
      await expect(
        dialog.getByRole("button", { name: "创建会话" }),
      ).toBeEnabled();
      for (const [id, badge] of [
        ["claude-code", ".lucide-terminal"],
        ["claude-desktop", ".lucide-monitor"],
        ["future-agent", ".lucide-bot"],
      ]) {
        await select.selectOption(id);
        await expect(
          dialog.locator(`[data-agent-icon="${id}"] ${badge}`),
        ).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: "创建会话" }),
        ).toBeEnabled();
      }
      await page.screenshot({
        path: `artifacts/claude-chooser-${width}-${theme}.png`,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(writes).toEqual([]);
      for (const id of ["claude-code", "claude-desktop"]) {
        await select.selectOption("future-agent");
        await dialog
          .getByLabel("审批模式", { exact: true })
          .selectOption("auto");
        await select.selectOption(id);
        const policy = dialog.getByLabel("审批模式", { exact: true });
        await expect(policy).toHaveValue("manual");
        await expect(policy).toBeDisabled();
        await expect(policy.locator("option")).toHaveCount(1);
        await expect(policy).toContainText("沿用原生权限");
        const pending = page.waitForRequest(
          (request) =>
            request.method() === "POST" &&
            new URL(request.url()).pathname === "/api/sessions",
        );
        await dialog
          .getByRole("button", { name: "创建会话", exact: true })
          .click();
        const request = await pending;
        expect(request.postDataJSON()).toEqual({
          cwd: "/work",
          agent: id,
          model: null,
          policy: "manual",
        });
        await expect(
          dialog.getByRole("button", { name: "创建会话", exact: true }),
        ).toBeEnabled();
      }
      await page.screenshot({
        path: `artifacts/claude-manual-create-${width}-${theme}.png`,
      });
      await dialog.getByTitle("关闭", { exact: true }).click();
      if (
        width < 720 &&
        !(await page
          .locator("aside.sidebar")
          .evaluate((node) => node.classList.contains("open")))
      )
        await page
          .getByRole("button", { name: "会话列表", exact: true })
          .filter({ visible: true })
          .click();
      await menu.locator("summary").click();
      await menu
        .getByRole("button", { name: "Claude Code", exact: true })
        .click();
      await page.locator(".session-row").click();
      const policy = page.getByLabel("审批模式", { exact: true });
      await expect(policy).toHaveValue("auto");
      await expect(
        page
          .locator(".composer-left small")
          .getByText("沿用原生权限", { exact: true }),
      ).toBeVisible();
      await expect(policy.locator('option[value="auto"]')).toBeDisabled();
      await expect(
        page.getByRole("status").filter({ hasText: "请先将审批模式切回" }),
      ).toBeVisible();
      const editor = page.getByRole("textbox", { name: "消息", exact: true });
      await editor.fill("保留权限恢复草稿");
      await expect(page.getByTitle("发送", { exact: true })).toBeDisabled();
      await editor.press("Enter");
      expect(writes).toHaveLength(2);
      await page.screenshot({
        path: `artifacts/claude-legacy-policy-${width}-${theme}.png`,
      });
      await policy.selectOption("manual");
      await expect(policy).toHaveValue("manual");
      await expect(policy).toBeDisabled();
      await expect(policy.locator('option[value="auto"]')).toHaveCount(0);
      await expect(editor).toHaveText("保留权限恢复草稿");
      await expect(page.getByTitle("发送", { exact: true })).toBeEnabled();
      expect(writes.map((write) => write.path)).toEqual([
        "/sessions",
        "/sessions",
        "/sessions/claude-code",
      ]);
      expect(writes[2].body).toEqual({ policy: "manual" });
      expect(errors).toEqual([]);
      await context.close();
      console.log(
        `Passed Claude catalog / manual create payloads / legacy policy recovery / future Agent: ${width}px ${theme}`,
      );
    }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
