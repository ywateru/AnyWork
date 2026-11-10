import { expect, test, type Page, type Request } from "./local-fixture";
import { expectPromptText, fillPromptText } from "./prompt-editor-helpers";

const headers = { Authorization: "Bearer browser-integration-test-token" };
async function setup(page: Page, suffix: string) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const sessions: { id: string; title: string }[] = [];
  for (const title of [`子窗口甲 ${suffix}`, `子窗口乙 ${suffix}`]) {
    const result = await page.request.post("/api/sessions", {
      headers,
      data: { cwd: workspace, agent: "fixture", title },
    });
    sessions.push((await result.json()).session);
  }
  await page.goto(`/#${sessions[0].id}`);
  await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
  return sessions;
}
async function sidebar(page: Page) {
  if (
    page.viewportSize()!.width <= 720 &&
    !(await page.locator(".sidebar.open").count())
  )
    await page.getByRole("button", { name: "会话列表", exact: true }).click();
}
async function switchTo(page: Page, session: { id: string; title: string }) {
  await sidebar(page);
  await page.getByLabel("搜索会话", { exact: true }).fill(session.title);
  await page.getByRole("button", { name: session.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#${session.id}$`));
}
async function tool(page: Page, name: string) {
  await page.getByLabel("打开子窗口", { exact: true }).click();
  await page
    .locator(".panel-launcher-menu")
    .getByRole("button", { name, exact: true })
    .click();
}

test("one plus launcher stays at the right and only offers document and workspace panels", async ({
  page,
}, info) => {
  await setup(page, `launcher ${info.project.name} ${Date.now()}`);
  const plus = page.getByLabel("打开子窗口", { exact: true });
  await expect(plus).toHaveCount(1);
  await expect(page.getByLabel("工作区工具", { exact: true })).toHaveCount(0);
  await plus.click();
  const menu = page.locator(".panel-launcher-menu");
  await expect(menu.getByRole("button")).toHaveText([
    "文件",
    "变更",
    "目标",
    "终端",
  ]);
  await expect(menu.getByRole("button", { name: /Subagents/ })).toHaveCount(0);
  await menu.getByRole("button", { name: "文件", exact: true }).click();
  await expect(plus).toHaveCount(1);
  await expect(
    page.getByRole("tab", { name: "文件", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator(".panel-tabs")
      .evaluate((el) =>
        el.lastElementChild?.classList.contains("panel-launcher"),
      ),
  ).toBe(true);
  await plus.click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".panel-launcher")).not.toHaveAttribute("open", "");
});

test("floating navigation menus close on selection, outside touch, Escape, focus exit and conversation change", async ({
  page,
}, info) => {
  const sessions = await setup(page, `${info.project.name} ${Date.now()}`);
  await sidebar(page);
  const trigger = page.getByLabel("会话显示选项", { exact: true });
  const menu = page.locator(".navigation-options");
  await trigger.click();
  await expect(menu).toHaveAttribute("open", "");
  // Selecting the already active group must still dismiss the popup.
  await page.getByRole("button", { name: "按目录", exact: true }).click();
  await expect(menu).not.toHaveAttribute("open", "");
  await trigger.click();
  await page.getByRole("button", { name: "按状态", exact: true }).click();
  await expect(menu).not.toHaveAttribute("open", "");
  await trigger.click();
  await page.getByLabel("筛选工作目录", { exact: true }).selectOption("");
  await expect(menu).not.toHaveAttribute("open", "");
  await trigger.click();
  const search = page.getByLabel("搜索会话", { exact: true });
  if (info.project.name === "android-web") await search.tap();
  else await search.click();
  await expect(menu).not.toHaveAttribute("open", "");
  await trigger.click();
  await trigger.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: "按目录", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open", "");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await search.focus();
  await expect(menu).not.toHaveAttribute("open", "");
  await trigger.click();
  await page.goto(`/#${sessions[1].id}`);
  await expect(menu).not.toHaveAttribute("open", "");
  await sidebar(page);
  await trigger.click();
  await page.getByRole("button", { name: "查看已归档", exact: true }).click();
  await expect(menu).not.toHaveAttribute("open", "");
});

test("each conversation restores its own document and tool tabs without execution side effects", async ({
  page,
}, info) => {
  const sessions = await setup(page, `${info.project.name} ${Date.now()}`);
  const input = page.getByLabel("消息", { exact: true });
  const tabs = page.getByRole("tablist", {
    name: "当前会话的子窗口",
    exact: true,
  });
  await fillPromptText(input, "甲会话草稿\n保留换行");
  await expect(tabs.getByRole("tab")).toHaveCount(1);
  await tool(page, "文件");
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await page.getByRole("treeitem", { name: "docs", exact: true }).click();
  await page.getByRole("treeitem", { name: "guide.md", exact: true }).click();
  await expect(
    tabs.getByRole("tab", { name: "README.md", exact: true }),
  ).toHaveCount(1);
  await expect(
    tabs.getByRole("tab", { name: "guide.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("treeitem", { name: "guide.md", exact: true }).click();
  await expect(
    tabs.getByRole("tab", { name: "guide.md", exact: true }),
  ).toHaveCount(1);
  await tool(page, "变更");
  await tool(page, "终端");
  await expect(page.locator(".terminal-status")).toHaveText("已连接");
  await tabs.getByRole("tab", { name: "guide.md", exact: true }).click();
  await switchTo(page, sessions[1]);
  await expect(tabs.getByRole("tab")).toHaveCount(1);
  await expect(input).toBeVisible();
  await expectPromptText(input, "");
  await fillPromptText(input, "乙会话独立草稿");
  await tool(page, "变更");
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await page.reload();
  await expect(
    tabs.getByRole("tab", { name: "变更", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await switchTo(page, sessions[0]);
  const documentTab = tabs.getByRole("tab", { name: "guide.md", exact: true });
  await expect(documentTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "文档侧栏预览", exact: true }),
  ).toBeVisible();
  if (info.project.name === "android-web")
    await expect
      .poll(async () => {
        const rect = (await page.locator(".sidebar").boundingBox())!;
        return rect.x + rect.width;
      })
      .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/anywork-child-windows-${info.project.name}.png`,
    fullPage: true,
  });
  await documentTab.press("End");
  await expect(
    tabs.getByRole("tab", { name: "终端", exact: true }),
  ).toBeFocused();
  await tabs.getByRole("tab", { name: "对话", exact: true }).click();
  await expectPromptText(input, "甲会话草稿\n保留换行");
  const commands: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(messages|interrupt|resume|connect)$/.test(
        new URL(request.url()).pathname,
      )
    )
      commands.push(request.url());
  });
  await documentTab.click();
  await page
    .getByRole("button", { name: "关闭标签：README.md", exact: true })
    .click();
  await expect(documentTab).toHaveAttribute("aria-selected", "true");
  await documentTab.press("Delete");
  await expect(documentTab).toHaveCount(0);
  await expect(
    tabs.getByRole("tab", { name: "文件", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "文档侧栏预览", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(documentTab).toHaveCount(0);
  await expect(
    tabs.getByRole("tab", { name: "README.md", exact: true }),
  ).toHaveCount(0);
  await tabs.getByRole("tab", { name: "对话", exact: true }).click();
  await expectPromptText(input, "甲会话草稿\n保留换行");
  await switchTo(page, sessions[1]);
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await tabs.getByRole("tab", { name: "对话", exact: true }).click();
  await expectPromptText(input, "乙会话独立草稿");
  expect(commands).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/anywork-conversation-panels-${info.project.name}.png`,
    fullPage: true,
  });
});

test("document and child-window menus dismiss after actions and when another menu opens", async ({
  page,
}, info) => {
  await setup(page, `${info.project.name} ${Date.now()}`);
  await tool(page, "文件");
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  const trigger = page.getByLabel("文件选项", { exact: true });
  const menu = page.locator(".document-options");
  await trigger.click();
  await page.getByRole("button", { name: "刷新文件", exact: true }).click();
  await expect(menu).not.toHaveAttribute("open", "");
  await trigger.click();
  await page.getByLabel("打开子窗口", { exact: true }).click();
  await expect(menu).not.toHaveAttribute("open", "");
  const launcher = page.locator(".panel-launcher");
  await expect(launcher).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(launcher).not.toHaveAttribute("open", "");
  await expect(page.getByLabel("打开子窗口", { exact: true })).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open", "");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("button", { name: "隐藏文件树", exact: true }).click();
  await expect(menu).not.toHaveAttribute("open", "");
  await trigger.click();
  await page.getByRole("button", { name: "显示文件树", exact: true }).click();
  await trigger.click();
  await page.getByLabel("当前子窗口", { exact: true }).click();
  await expect(menu).not.toHaveAttribute("open", "");
});

test("closing a review child tab clears its route and remains closed after reload", async ({
  page,
}, info) => {
  const [session] = await setup(page, `${info.project.name} ${Date.now()}`);
  await page.goto(`/#${session.id}?view=review`);
  const tabs = page.getByRole("tablist", {
    name: "当前会话的子窗口",
    exact: true,
  });
  await expect(
    tabs.getByRole("tab", { name: "变更", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "关闭标签：变更", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`#${session.id}$`));
  await expect(
    tabs.getByRole("tab", { name: "对话", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(
    tabs.getByRole("tab", { name: "变更", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
});

test("directory groups follow their newest visible chat and reorder after activity rather than alphabetically", async ({
  page,
}, info) => {
  const [created] = await setup(page, `目录排序 ${info.project.name}`);
  const original = (
    await (
      await page.request.get(`/api/sessions/${created.id}`, { headers })
    ).json()
  ).session;
  let alphaTime = 20;
  const sessions = () => [
    {
      ...original,
      id: "z-old",
      title: "Z 旧会话",
      cwd: "/work/zeta",
      updated_at: 1,
    },
    {
      ...original,
      id: "alpha",
      title: "A 会话",
      cwd: "/work/alpha",
      updated_at: alphaTime,
    },
    {
      ...original,
      id: "archived",
      title: "归档会话",
      cwd: "/work/middle",
      updated_at: 1000,
      archived: true,
    },
    {
      ...original,
      id: original.id,
      title: "Z 最新会话",
      cwd: "/work/zeta",
      updated_at: 30,
    },
    {
      ...original,
      id: "middle",
      title: "M 会话",
      cwd: "/work/middle",
      updated_at: 10,
    },
  ];
  await page.route("**/api/sessions", (route) =>
    route.fulfill({ json: { sessions: sessions() } }),
  );
  await page.route(`**/api/sessions/${original.id}`, (route) =>
    route.fulfill({
      json: { session: sessions().find((s) => s.id === original.id) },
    }),
  );
  await page.reload();
  await sidebar(page);
  const groups = page.locator(".workspace-group");
  await expect(groups.locator(".workspace-name")).toHaveText([
    "zeta",
    "alpha",
    "middle",
  ]);
  await expect(groups.first().locator(".session-row strong")).toHaveText([
    "Z 最新会话",
    "Z 旧会话",
  ]);
  alphaTime = 80;
  await page.reload();
  await sidebar(page);
  await expect(groups.locator(".workspace-name")).toHaveText([
    "alpha",
    "zeta",
    "middle",
  ]);
});

test("running chats share one global polling channel, update offscreen and switch from cache without repeated history loads", async ({
  page,
}, info) => {
  const chats = await setup(page, `cache ${info.project.name} ${Date.now()}`);
  for (const chat of chats) {
    const response = await page.request.post(
      `/api/sessions/${chat.id}/messages`,
      { headers, data: { text: `slow ${chat.title}` } },
    );
    expect(response.ok()).toBe(true);
  }
  const historyRequests: string[] = [],
    streamRequests: string[] = [];
  const activePolls = new Set<Request>();
  let maxParallelPolls = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/history")) historyRequests.push(url.pathname);
    if (url.pathname.endsWith("/events/poll")) {
      streamRequests.push(url.pathname);
      activePolls.add(request);
      maxParallelPolls = Math.max(maxParallelPolls, activePolls.size);
    }
  });
  page.on("requestfinished", (request) => activePolls.delete(request));
  page.on("requestfailed", (request) => activePolls.delete(request));
  await page.reload();
  await expect(
    page.getByText(`slow ${chats[0].title}`, { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      historyRequests.includes(`/api/sessions/${chats[1].id}/history`),
    )
    .toBe(true);
  await expect.poll(() => streamRequests.length).toBeGreaterThan(0);
  expect([...new Set(streamRequests)]).toEqual(["/api/events/poll"]);
  const update = `后台更新 ${Date.now()}`;
  expect(
    (
      await page.request.post(`/api/sessions/${chats[1].id}/messages`, {
        headers,
        data: { text: update, mode: "steer" },
      })
    ).ok(),
  ).toBe(true);
  await switchTo(page, chats[1]);
  await expect(page.getByText(update, { exact: true })).toBeVisible();
  const before = historyRequests.length;
  await page.route("**/api/sessions/*/history*", (route) => route.abort());
  await switchTo(page, chats[0]);
  await expect(
    page.getByText(`slow ${chats[0].title}`, { exact: true }),
  ).toBeVisible();
  await switchTo(page, chats[1]);
  await expect(page.getByText(update, { exact: true })).toBeVisible();
  expect(historyRequests).toHaveLength(before);
  expect([...new Set(streamRequests)]).toEqual(["/api/events/poll"]);
  expect(maxParallelPolls).toBe(1);
  await expect(page.locator(".history-loading")).toHaveCount(0);
});
