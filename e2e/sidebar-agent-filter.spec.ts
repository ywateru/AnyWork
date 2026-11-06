import { expect, test, type Page } from "@playwright/test";
import { fillPromptText } from "./prompt-editor-helpers";

async function fixture(
  page: Page,
  options: {
    saved?: string;
    delay?: boolean;
    delayPlugins?: boolean;
    empty?: boolean;
    workbuddy?: boolean;
    workbuddyOnly?: boolean;
    readOnly?: boolean;
  } = {},
) {
  const now = Date.now();
  const session = (
    id: string,
    agent: string,
    cwd: string,
    age: number,
    status = "idle",
    archived = false,
  ) => ({
    id: id.toLowerCase().replaceAll(" ", "-"),
    title: id,
    thread_id: id.toLowerCase().replaceAll(" ", "-"),
    agent,
    cwd,
    created_at: now - age,
    updated_at: now - age,
    status,
    archived,
    model: null,
    policy: "manual",
  });
  const sessions = options.empty
    ? []
    : [
        session("Codex newest", "codex", "/work/alpha", 1000, "running"),
        session(
          "Harness irrelevant",
          "deepseek-harness",
          "/work/alpha",
          2000,
          "waiting",
        ),
        session("Find Harness beta", "deepseek-harness", "/work/beta", 10000),
        session("Find Harness alpha", "deepseek-harness", "/work/alpha", 20000),
        session(
          "Harness archived",
          "deepseek-harness",
          "/work/beta",
          500,
          "idle",
          true,
        ),
        session("Other history", "unknown-agent", "/work/gamma", 30000),
      ];
  if (options.workbuddy)
    sessions.push({
      ...session("WorkBuddy original", "workbuddy", "/work/buddy", 3000),
      auxiliary: !!options.readOnly,
    });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let releasePlugins!: () => void;
  const pluginsPending = new Promise<void>((resolve) => {
    releasePlugins = resolve;
  });
  let firstLoad = true;
  let streamRelease!: () => void;
  const streamPending = new Promise<void>((resolve) => {
    streamRelease = resolve;
  });
  let streamed = false;
  const writes: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/api")[1];
    const id = decodeURIComponent(path.split("/")[2] || "");
    if (route.request().method() !== "GET") writes.push(path);
    let data: unknown = {};
    if (path === "/sessions") {
      if (firstLoad && options.delay) await pending;
      firstLoad = false;
      data = { sessions };
    } else if (path === "/plugins") {
      if (options.delayPlugins) await pluginsPending;
      data = {
        plugins: [
          ...(options.workbuddy
            ? [
                {
                  id: "workbuddy",
                  name: "WorkBuddy",
                  protocol_version: 1,
                  capabilities: ["chat", "models"],
                },
              ]
            : []),
          {
            id: "codex",
            name: "Codex",
            protocol_version: 1,
            capabilities: ["chat"],
          },
          {
            id: "deepseek-harness",
            name: "DeepSeek Harness",
            protocol_version: 1,
            capabilities: ["chat"],
          },
          {
            id: "configured-plugin",
            name: "Configured Agent",
            protocol_version: 1,
            capabilities: ["chat"],
          },
        ].filter(
          (plugin) => !options.workbuddyOnly || plugin.id === "workbuddy",
        ),
      };
    } else if (path === "/info")
      data = {
        hostname: "Sidebar fixture",
        workspace: "/work",
        client_presence: false,
      };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path === "/events/poll") data = { events: [], cursor: 0 };
    else if (path === "/events") {
      if (!streamed) {
        streamed = true;
        await streamPending;
        await route.fulfill({
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify({ seq: 3, session_id: "codex-newest", method: "item/completed", params: { turnId: "t", item: { id: "new-response", type: "agentMessage", text: "流式更新仍然到达", phase: "commentary" } }, created_at: now })}\n\n`,
        });
      } else
        await route.fulfill({
          contentType: "text/event-stream",
          body: ": heartbeat\n\n",
        });
      return;
    } else if (path.endsWith("/history"))
      data = {
        events: [
          {
            seq: 1,
            session_id: id,
            method: "user/message",
            params: { text: "保留当前会话" },
            created_at: now - 10000,
          },
          {
            seq: 2,
            session_id: id,
            method: "turn/started",
            params: { turn: { id: "t" } },
            created_at: now - 9000,
          },
        ],
        latest_seq: 2,
        next_cursor: null,
      };
    else if (path.endsWith("/events/poll")) data = { events: [] };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/composer"))
      data = {
        settings_available: false,
        models: [],
        goal: null,
        ...(options.readOnly && id === "workbuddy-original"
          ? {
              read_only: true,
              read_only_reason: "WorkBuddy 子 Agent 仅支持查看",
            }
          : {}),
      };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (/^\/sessions\/[^/]+$/.test(path))
      data = { session: sessions.find((s) => s.id === id) };
    await route.fulfill({ json: data });
  });
  await page.addInitScript(({ saved }) => {
    if (!localStorage.getItem("ra.connection"))
      localStorage.setItem(
        "ra.connection",
        JSON.stringify({ url: location.origin, token: "sidebar-fixture" }),
      );
    if (saved && !localStorage.getItem("sidebar-fixture-initialized"))
      localStorage.setItem(
        `anywork.sidebar-agent.${JSON.stringify(location.origin)}`,
        saved,
      );
    localStorage.setItem("sidebar-fixture-initialized", "true");
  }, options);
  await page.goto("/#codex-newest");
  return { release, releasePlugins, streamRelease, writes, sessions };
}
async function openSidebar(page: Page, mobile: boolean) {
  if (!mobile) return;
  const sidebar = page.locator("aside.sidebar");
  await expect(sidebar).toBeAttached();
  // After reload, loading a chat replaces the visible overview trigger with the
  // chat toolbar trigger. Retry that real transition, never a hidden old button;
  // an already open drawer is the desired result and must not be toggled closed.
  await expect(async () => {
    if (
      !(await sidebar.evaluate((element) => element.classList.contains("open")))
    )
      await page
        .getByRole("button", { name: "会话列表", exact: true })
        .filter({ visible: true })
        .click({ timeout: 1000 });
    await expect(sidebar).toHaveClass(/\bopen\b/, { timeout: 1000 });
  }).toPass({ timeout: 10000 });
}
async function choose(page: Page, name: string) {
  const menu = page.locator(".sidebar-agent-filter");
  await menu.locator("summary").click();
  await menu.getByRole("button", { name, exact: true }).click();
  await expect(menu).not.toHaveAttribute("open");
}

test("Agent filtering composes with search, directory order and archive while retaining live chat and draft", async ({
  page,
}, info) => {
  const { streamRelease, writes } = await fixture(page);
  const prompt = page.locator('[contenteditable="true"]').first();
  await expect(prompt).toBeVisible();
  await fillPromptText(prompt, "草稿必须保留");
  await openSidebar(page, info.project.name === "android-web");
  const nav = page.getByRole("navigation", { name: "工作目录与会话" });
  await expect(
    nav.getByRole("button", { name: "Codex newest", exact: true }),
  ).toBeVisible();
  await expect(nav.locator('[data-agent-icon="codex"]')).toHaveCount(1);
  await expect(nav.getByRole("img", { name: "正在执行" })).toBeVisible();
  await expect(nav.getByRole("img", { name: "等待回应" })).toBeVisible();
  await choose(page, "DeepSeek Harness");
  await expect(
    nav.getByRole("button", { name: "Codex newest", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("textbox", { name: "搜索会话" }).fill("Find");
  await expect(nav.locator(".workspace-group").first()).toHaveAttribute(
    "data-workspace",
    "/work/beta",
  );
  await expect(nav.locator(".workspace-group").last()).toHaveAttribute(
    "data-workspace",
    "/work/alpha",
  );
  await page.getByRole("button", { name: "清除搜索" }).click();
  await page.getByLabel("会话显示选项", { exact: true }).click();
  await page
    .getByLabel("筛选工作目录", { exact: true })
    .selectOption("/work/beta");
  await expect(nav.locator(".workspace-group")).toHaveCount(1);
  await page.getByLabel("会话显示选项", { exact: true }).click();
  await page.getByRole("button", { name: "查看已归档", exact: true }).click();
  await expect(
    nav.getByRole("button", { name: "Harness archived", exact: true }),
  ).toBeVisible();
  streamRelease();
  if (info.project.name === "android-web")
    await page.getByRole("button", { name: "关闭会话列表" }).click();
  await expect(
    page.getByText("流式更新仍然到达", { exact: true }),
  ).toBeVisible();
  await expect(prompt).toContainText("草稿必须保留");
  expect(decodeURIComponent(new URL(page.url()).hash)).toBe("#codex-newest");
  expect(writes).toEqual([]);
});

test("Agent menu dismisses by selection, outside and Escape, supports keyboard and both theme assets", async ({
  page,
}, info) => {
  await fixture(page);
  if (info.project.name === "android-web")
    await page.setViewportSize({ width: 320, height: 768 });
  await openSidebar(page, info.project.name === "android-web");
  await openSidebar(page, info.project.name === "android-web");
  const menu = page.locator(".sidebar-agent-filter");
  const trigger = menu.locator("summary");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.getByRole("button", { name: "所有 Agent", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("Codex");
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("textbox", { name: "搜索会话" }).click();
  await expect(menu).not.toHaveAttribute("open");
  await choose(page, "所有 Agent");
  const nav = page.getByRole("navigation", { name: "工作目录与会话" });
  await expect(
    nav
      .getByRole("button", { name: "Other history", exact: true })
      .locator("img"),
  ).toHaveCount(0);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    for (const name of ["codex", "deepseek-harness"]) {
      const mark = nav.locator(`[data-agent-icon="${name}"]`).first();
      const image = mark.locator(`.agent-mark-${theme}`);
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate(
            (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const rect = await mark.boundingBox();
      expect(rect?.width).toBe(18);
      expect(rect?.height).toBe(18);
    }
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.screenshot({
    path: info.outputPath(`sidebar-agent-filter-${info.project.name}.png`),
  });
});

test("saved unavailable Agent respects loading, explicit empty states, grouping and per-server preferences", async ({
  page,
}, info) => {
  const { release } = await fixture(page, {
    saved: "unavailable-agent",
    delay: true,
  });
  await openSidebar(page, info.project.name === "android-web");
  const nav = page.getByRole("navigation", { name: "工作目录与会话" });
  await expect(nav.getByRole("status")).toHaveText("正在加载会话…");
  await expect(nav.getByText(/没有符合/)).toHaveCount(0);
  release();
  await expect(nav).toContainText("没有符合当前筛选的 unavailable-agent 会话");
  await page.locator(".sidebar-agent-filter summary").click();
  await expect(page.locator(".sidebar-agent-menu")).toContainText("暂不可用");
  await page.keyboard.press("Escape");
  await page.getByLabel("会话显示选项", { exact: true }).click();
  await page.getByRole("button", { name: "按状态", exact: false }).click();
  await expect(nav).toContainText("没有符合当前筛选的 unavailable-agent 会话");
  await nav.getByRole("button", { name: "查看所有 Agent" }).click();
  await expect(
    nav.getByRole("button", { name: "Other history", exact: true }),
  ).toBeVisible();
  await choose(page, "DeepSeek Harness");
  await page.reload();
  await openSidebar(page, info.project.name === "android-web");
  await expect(page.locator(".sidebar-agent-filter summary")).toContainText(
    "DeepSeek Harness",
  );
  async function connect(suffix: string) {
    await page.evaluate(
      (suffix) =>
        localStorage.setItem(
          "ra.connection",
          JSON.stringify({
            url: location.origin + suffix,
            token: "sidebar-fixture",
          }),
        ),
      suffix,
    );
    await page.reload();
    await openSidebar(page, info.project.name === "android-web");
  }
  await connect("/alternate-server");
  await expect(page.locator(".sidebar-agent-filter summary")).toContainText(
    "所有 Agent",
  );
  await choose(page, "Codex");
  await connect("");
  await expect(page.locator(".sidebar-agent-filter summary")).toContainText(
    "DeepSeek Harness",
  );
  await choose(page, "Configured Agent");
  await expect(nav).toContainText("没有符合当前筛选的 Configured Agent 会话");
});

test("All Agents shows explicit empty states in directory and status views and unconfigured brands remain selectable", async ({
  page,
}, info) => {
  await fixture(page, { empty: true });
  await page.route("**/api/plugins", (route) =>
    route.fulfill({
      json: {
        plugins: [
          {
            id: "codex",
            name: "Codex",
            protocol_version: 1,
            capabilities: ["chat"],
          },
        ],
      },
    }),
  );
  await page.reload();
  await openSidebar(page, info.project.name === "android-web");
  const nav = page.getByRole("navigation", { name: "工作目录与会话" });
  await expect(nav).toContainText("还没有会话，点击 + 开始");
  await page.locator(".sidebar-agent-filter summary").click();
  await page
    .locator(".sidebar-agent-menu")
    .getByRole("button", { name: /DeepSeek Harness/ })
    .click();
  await expect(nav).toContainText("没有符合当前筛选的 DeepSeek Harness 会话");
  await nav.getByRole("button", { name: "查看所有 Agent" }).click();
  await page.getByLabel("会话显示选项", { exact: true }).click();
  await page.getByRole("button", { name: "按状态", exact: false }).click();
  await expect(nav).toContainText("还没有会话，点击 + 开始");
  await choose(page, "Codex");
  await expect(nav).toContainText("没有符合当前筛选的 Codex 会话");
});

test("WorkBuddy filter remains available when disconnected, without becoming a new-chat backend", async ({
  page,
}, info) => {
  const { writes } = await fixture(page);
  await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
  await openSidebar(page, info.project.name === "android-web");
  const filter = page.locator(".sidebar-agent-filter");
  await filter.locator("summary").click();
  await expect(
    filter.getByRole("button", { name: "WorkBuddy 暂不可用" }),
  ).toBeVisible();
  await filter.getByRole("button", { name: "WorkBuddy 暂不可用" }).click();
  const nav = page.getByRole("navigation", { name: "工作目录与会话" });
  await expect(nav).toContainText("没有符合当前筛选的 WorkBuddy 会话");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建会话" });
  await expect(
    dialog
      .getByLabel("Agent", { exact: true })
      .locator('option[value="workbuddy"]'),
  ).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("connected WorkBuddy keeps its original teal icon in both themes and submits the native Agent id", async ({
  page,
}, info) => {
  const { sessions } = await fixture(page, {
    workbuddy: true,
    workbuddyOnly: true,
  });
  const prompt = page.locator('[contenteditable="true"]').first();
  await expect(prompt).toBeVisible();
  await fillPromptText(prompt, "WorkBuddy 筛选保留草稿");
  await openSidebar(page, info.project.name === "android-web");
  await choose(page, "WorkBuddy");
  const nav = page.getByRole("navigation", { name: "工作目录与会话" });
  const row = nav.getByRole("button", {
    name: "WorkBuddy original",
    exact: true,
  });
  await expect(row).toBeVisible();
  await expect(
    nav.getByRole("button", { name: "Codex newest", exact: true }),
  ).toHaveCount(0);
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") {
      if (info.project.name === "android-web")
        await page
          .getByRole("button", { name: "关闭会话列表", exact: true })
          .click();
      await page.getByLabel("会话操作", { exact: true }).click();
      await page.getByTitle("切换主题", { exact: true }).click();
      await openSidebar(page, info.project.name === "android-web");
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const image = row.locator('[data-agent-icon="workbuddy"] img');
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", "/agents/workbuddy.svg");
    await expect
      .poll(() =>
        image.evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
      )
      .toBe(true);
    expect(await image.evaluate((node) => getComputedStyle(node).filter)).toBe(
      "none",
    );
    await expect
      .poll(() =>
        page
          .locator("aside.sidebar")
          .evaluate((node) => Math.round(node.getBoundingClientRect().x)),
      )
      .toBe(0);
    await page.screenshot({
      path: info.outputPath(`workbuddy-${theme}.png`),
      animations: "disabled",
    });
  }
  if (info.project.name === "android-web")
    await page
      .getByRole("button", { name: "关闭会话列表", exact: true })
      .click();
  await expect(prompt).toHaveText("WorkBuddy 筛选保留草稿");
  await openSidebar(page, info.project.name === "android-web");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建会话" });
  await expect(dialog.getByLabel("Agent", { exact: true })).toHaveValue(
    "workbuddy",
  );
  await expect(
    dialog.locator('[data-agent-icon="workbuddy"] img'),
  ).toBeVisible();
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const created = {
      ...sessions[0],
      id: "workbuddy-new",
      thread_id: "native-new",
      agent: "workbuddy",
      title: "Native new",
      cwd: "/work/alpha",
      status: "idle",
    };
    sessions.push(created);
    await route.fulfill({ json: { session: created } });
  });
  const sent = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/sessions" &&
      request.method() === "POST",
  );
  await dialog.getByRole("button", { name: "创建会话", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    agent: "workbuddy",
    cwd: "/work/alpha",
  });
  await expect(
    page.locator(
      '[contenteditable="true"] [data-placeholder="使用 WorkBuddy"]',
    ),
  ).toBeVisible();
});

test("full WorkBuddy child conversation exposes native read-only reason without composer mutations", async ({
  page,
}, info) => {
  const { writes } = await fixture(page, { workbuddy: true, readOnly: true });
  await openSidebar(page, info.project.name === "android-web");
  await choose(page, "WorkBuddy");
  await page.getByRole("button", { name: /辅助会话/ }).click();
  await page
    .getByRole("button", { name: "WorkBuddy original", exact: true })
    .click();
  await expect(
    page.getByText("WorkBuddy 子 Agent 仅支持查看", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator(".composer")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByTitle("中断", { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
  // Native child capabilities must not leak into another Agent's input.
  await openSidebar(page, info.project.name === "android-web");
  await choose(page, "Codex");
  await page.getByRole("button", { name: "Codex newest", exact: true }).click();
  await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
});

for (const workbuddyOnly of [true, false]) {
  test(`late Agent catalog initializes only the empty new-chat choice (${workbuddyOnly ? "WorkBuddy only" : "Codex preferred"})`, async ({
    page,
  }, info) => {
    const { releasePlugins, writes } = await fixture(page, {
      delayPlugins: true,
      workbuddy: true,
      workbuddyOnly,
    });
    await openSidebar(page, info.project.name === "android-web");
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新建会话" });
    const chooser = dialog.getByLabel("Agent", { exact: true });
    const create = dialog.getByRole("button", {
      name: "创建会话",
      exact: true,
    });
    await expect(chooser).toBeDisabled();
    await expect(chooser).toHaveAttribute("aria-busy", "true");
    await expect(chooser.locator("option:checked")).toHaveText(
      "正在加载 Agent…",
    );
    await expect(create).toBeDisabled();
    releasePlugins();
    await expect(chooser).toBeEnabled();
    await expect(chooser).toHaveValue(workbuddyOnly ? "workbuddy" : "codex");
    await expect(create).toBeEnabled();
    await expect(
      chooser.locator("option").filter({ hasText: "正在加载 Agent…" }),
    ).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}
