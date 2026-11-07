import { expect, test, type Page } from "@playwright/test";

async function sidebarFixture(page: Page, mobile: boolean, empty = false) {
  const now = Date.now();
  const sessions = Array.from({ length: empty ? 0 : 80 }, (_, index) => ({
    id: `scroll-chat-${index}`,
    title: `滚动会话 ${String(index).padStart(2, "0")}`,
    thread_id: `scroll-chat-${index}`,
    agent: "codex",
    cwd: `/work/project-${String(index).padStart(2, "0")}`,
    created_at: now - index * 1000,
    updated_at: now - index * 1000,
    status: "idle",
    archived: false,
    model: null,
    policy: "manual",
  }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/api")[1];
    let data: unknown = {};
    if (path === "/sessions") data = { sessions };
    else if (path === "/plugins")
      data = {
        plugins: [
          {
            id: "codex",
            name: "Codex",
            protocol_version: 1,
            capabilities: ["chat"],
          },
        ],
      };
    else if (path === "/info")
      data = {
        hostname: "Scroll fixture",
        workspace: "/work",
        client_presence: false,
      };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path === "/events/poll") data = { events: [], cursor: 0 };
    else if (path.endsWith("/events")) {
      await route.fulfill({
        contentType: "text/event-stream",
        body: ": heartbeat\n\n",
      });
      return;
    } else if (path.endsWith("/history"))
      data = { events: [], latest_seq: 0, next_cursor: null };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (/^\/sessions\/[^/]+$/.test(path)) data = { session: sessions[0] };
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({ url: location.origin, token: "scroll-fixture" }),
    );
    localStorage.setItem("ra.group-mode-v2", "directory");
  });
  await page.goto(empty ? "/" : "/#scroll-chat-0");
  const sidebar = page.locator("aside.sidebar");
  if (empty)
    await expect(sidebar.getByText("还没有会话，点击 + 开始")).toBeAttached();
  else
    await expect(
      sidebar.getByRole("button", { name: "滚动会话 79", exact: true }),
    ).toBeAttached();
  if (mobile) {
    await page
      .getByRole("button", { name: "会话列表", exact: true })
      .filter({ visible: true })
      .click();
    await expect(sidebar).toHaveClass(/\bopen\b/);
    await expect.poll(async () => (await sidebar.boundingBox())?.x).toBe(0);
  }
  return sidebar;
}

async function viewportState(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };
    return {
      scrollY: window.scrollY,
      documentHeight: document.documentElement.scrollHeight,
      height: window.innerHeight,
      shell: box(".codex-shell"),
      heading: box(".navigation-heading"),
      footer: box(".sidebar-bottom"),
      list: box(".session-list"),
    };
  });
}

for (const short of [false, true]) {
  test(`sidebar contains boundary gestures${short ? " in a short window" : ""}`, async ({
    page,
    context,
  }, info) => {
    const mobile = info.project.name === "android-web";
    if (short)
      await page.setViewportSize({ width: mobile ? 390 : 960, height: 480 });
    const sidebar = await sidebarFixture(page, mobile);
    const list = sidebar.getByRole("navigation", { name: "工作目录与会话" });
    const before = await viewportState(page);
    expect(before.documentHeight).toBe(before.height);
    expect(before.scrollY).toBe(0);
    const bounds = (await list.boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    const cdp = mobile ? await context.newCDPSession(page) : null;
    const gesture = async (direction: "down" | "up") => {
      if (cdp)
        await cdp.send("Input.synthesizeScrollGesture", {
          x,
          y,
          yDistance: direction === "down" ? -10000 : 10000,
          speed: 30000,
          gestureSourceType: "touch",
        });
      else {
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, direction === "down" ? 10000 : -10000);
      }
    };
    await gesture("down");
    await expect
      .poll(() =>
        list.evaluate((el) =>
          Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
        ),
      )
      .toBeLessThanOrEqual(1);
    await expect(
      sidebar.getByRole("button", { name: "滚动会话 79", exact: true }),
    ).toBeInViewport();
    for (let index = 0; index < 3; index++) await gesture("down");
    expect(await viewportState(page)).toEqual(before);
    await page.screenshot({ path: info.outputPath("sidebar-bottom.png") });

    // Native elastic overscroll is not rendered in headless Chrome; the boundary
    // must also explicitly reject chaining and viewport bounce on real devices.
    expect(
      await list.evaluate((el) => getComputedStyle(el).overscrollBehaviorY),
    ).toMatch(/^(contain|none)$/);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).overscrollBehaviorY,
      ),
    ).toBe("none");

    await gesture("up");
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
    for (let index = 0; index < 3; index++) await gesture("up");
    expect(await viewportState(page)).toEqual(before);
    expect(before.documentHeight).toBe(before.height);
    expect(before.shell).toEqual({ top: 0, bottom: before.height });
    expect(before.footer.bottom).toBeLessThanOrEqual(before.height);
    expect(before.list.bottom).toBeLessThanOrEqual(before.footer.top);
    expect(before.list.top).toBeGreaterThanOrEqual(before.heading.bottom);

    // Containment must retain the anchored menus and fixed controls.
    const filter = sidebar.locator(".sidebar-agent-filter");
    await filter.locator("summary").click();
    await filter.getByRole("button", { name: "Codex", exact: true }).click();
    await expect(filter).not.toHaveAttribute("open");
    await sidebar.getByLabel("会话显示选项").click();
    const viewMenu = sidebar.locator(".navigation-options-menu");
    await expect(
      viewMenu.getByRole("button", { name: "按状态" }),
    ).toBeInViewport({ ratio: 1 });
    await viewMenu.getByRole("button", { name: "按状态" }).click();
    await expect(sidebar.locator(".navigation-options")).not.toHaveAttribute(
      "open",
    );
    await expect(
      sidebar.getByRole("button", { name: "设置与插件" }),
    ).toBeInViewport();
    await page.screenshot({ path: info.outputPath("bounded-sidebar.png") });
    await cdp?.detach();
  });
}

test("empty sidebar keeps controls and menus reachable in a short window", async ({
  page,
  context,
}, info) => {
  const mobile = info.project.name === "android-web";
  await page.setViewportSize({ width: mobile ? 390 : 960, height: 480 });
  const sidebar = await sidebarFixture(page, mobile, true);
  const list = sidebar.getByRole("navigation", { name: "工作目录与会话" });
  const before = await viewportState(page);
  const bounds = (await list.boundingBox())!;
  if (mobile) {
    const cdp = await context.newCDPSession(page);
    for (const distance of [-600, 600])
      await cdp.send("Input.synthesizeScrollGesture", {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
        yDistance: distance,
        speed: 3000,
        gestureSourceType: "touch",
      });
    await cdp.detach();
  } else {
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.wheel(0, 10000);
    await page.mouse.wheel(0, -10000);
  }
  expect(await viewportState(page)).toEqual(before);
  expect(before.documentHeight).toBe(before.height);
  expect(before.footer.bottom).toBeLessThanOrEqual(before.height);
  await sidebar.getByLabel("筛选 Agent：所有 Agent").click();
  await expect(
    sidebar
      .locator(".sidebar-agent-menu")
      .getByRole("button", { name: /WorkBuddy/ }),
  ).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await sidebar.getByLabel("会话显示选项").click();
  await expect(
    sidebar
      .locator(".navigation-options-menu")
      .getByRole("button", { name: "查看已归档" }),
  ).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await sidebar.getByRole("button", { name: "设置与插件" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
