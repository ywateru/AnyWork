import { expect, test, type Page } from "@playwright/test";
import { expectPromptText, fillPromptText } from "./prompt-editor-helpers";

async function fixture(page: Page) {
  const now = Date.now(),
    parentId = "subagent-parent",
    childId = "subagent-child";
  const session = (
    id: string,
    thread: string,
    title: string,
    status = "idle",
  ) => ({
    id,
    thread_id: thread,
    title,
    cwd: "/work/project",
    agent: "fixture",
    model: "fixture-model",
    policy: "manual",
    status,
    archived: false,
    created_at: now - 60000,
    updated_at: now,
    external: false,
  });
  const parent = session(parentId, "parent-thread", "参考会话"),
    child = session(childId, "agent-active-0", "Develop app", "running");
  const event = (id: string, seq: number, item: object) => ({
    session_id: id,
    seq,
    method: "item/completed",
    params: { turnId: id + "-turn", item },
    created_at: now - 60000 + seq * 100,
  });
  const agents = Array.from({ length: 16 }, (_, i) => ({
    id: `spawn-${i}`,
    type: "collabAgentToolCall",
    tool: "spawnAgent",
    status: "completed",
    model: "fixture-model",
    prompt: i < 5 ? "继续核对子 Agent 界面" : "检查已完成",
    receiverThreadIds: [i < 5 ? `agent-active-${i}` : `agent-done-${i}`],
    receiverThreads: [
      {
        threadId: i < 5 ? `agent-active-${i}` : `agent-done-${i}`,
        thread: {
          title:
            i === 0 ? "Develop app" : i < 5 ? `Active ${i}` : `Done ${i - 5}`,
          reasoningEffort: "high",
        },
      },
    ],
    agentsStates: {
      [i < 5 ? `agent-active-${i}` : `agent-done-${i}`]: {
        status: i === 1 ? "pendingInit" : i < 5 ? "running" : "completed",
        message: i < 5 ? "continuing current probe" : "完成",
      },
    },
  }));
  const parentEvents = [
    ...agents.map((a, i) => event(parentId, i + 1, a)),
    event(parentId, 17, {
      id: "readonly",
      type: "subAgentActivity",
      agentThreadId: "unknown-agent",
      agentPath: "/root/Read only member",
      kind: "completed",
      status: "completed",
    }),
    event(parentId, 18, {
      id: "done-row",
      type: "subAgentActivity",
      agentThreadId: "agent-active-0",
      agentPath: "/root/Develop app",
      kind: "completed",
    }),
    event(parentId, 19, {
      id: "parent-answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "父会话回答保留在这里。",
    }),
  ];
  const childEvents = [
    {
      session_id: childId,
      seq: 1,
      method: "user/message",
      params: { text: "检查工具输出与图片" },
      created_at: now - 50000,
    },
    event(childId, 2, {
      id: "child-answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "子会话内容：这是同面板中的真实历史。\n\n[子 Agent 文档](README.md)",
    }),
    event(childId, 3, {
      id: "child-image",
      type: "imageView",
      path: "/work/project/probe.png",
    }),
  ];
  const state = {
    writes: [] as { path: string; body: any }[],
    historyReads: [] as string[],
    fileReads: [] as string[],
    childEvents,
    lateReads: 0,
    pushLive: (_event: ReturnType<typeof event>) => {},
  };
  const nextLive = new Promise<ReturnType<typeof event>>((resolve) => {
    state.pushLive = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.slice(4);
    let data: any = {};
    if (req.method() !== "GET") {
      state.writes.push({ path, body: req.postDataJSON() });
      if (path === `/sessions/${childId}/messages`) {
        state.childEvents.push(
          event(childId, 4, {
            id: "child-reply",
            type: "agentMessage",
            phase: "final_answer",
            text: "子 Agent 已收到这条引导。",
          }),
        );
        data = { items: [], paused: false };
      } else throw new Error("Unexpected write: " + path);
    } else if (path === "/info")
      data = { workspace: "/work/project", hostname: "subagents-fixture" };
    else if (path === "/plugins")
      data = {
        plugins: [{ id: "fixture", name: "Fixture", capabilities: [] }],
      };
    else if (path === "/sessions") data = { sessions: [parent, child] };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path.endsWith("/history")) {
      state.historyReads.push(path);
      const events = path.includes(childId) ? state.childEvents : parentEvents;
      data = { events, next_cursor: null, latest_seq: events.at(-1)!.seq };
    } else if (path.endsWith("/files")) {
      state.fileReads.push(path);
      data = url.searchParams.get("path")
        ? { content: "# Child scoped document\n\nRead from the child session." }
        : { entries: [] };
    } else if (path.endsWith("/image"))
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    else if (path === "/events") {
      const update = await nextLive;
      return route.fulfill({
        contentType: "text/event-stream",
        body: `id: ${update.seq}\ndata: ${JSON.stringify(update)}\n\n`,
      });
    } else if (path === "/events/poll") data = { events: [], cursor: 100 };
    else if (path.endsWith("/events"))
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    else if (path.endsWith("/events/poll")) data = { events: [] };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (/^\/sessions\/[^/]+$/.test(path))
      data = { session: path.endsWith(childId) ? child : parent };
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({
        url: location.origin,
        token: "isolated-subagents-fixture",
      }),
    );
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  await page.goto("/#" + parentId);
  await expect(
    page.getByText("父会话回答保留在这里。", { exact: true }),
  ).toBeVisible();
  return { state, parentId, childId };
}
async function openPanel(page: Page) {
  await page.locator(".turn-disclosure").click();
  await page.locator('[data-message-id="done-row"]').click();
  await page
    .getByRole("button", { name: "返回子 Agent 列表", exact: true })
    .click();
}

test("Subagents has native Active/Done groups, 4/10 limits, waiting and stable themed avatars", async ({
  page,
}, info) => {
  const { state } = await fixture(page);
  await openPanel(page);
  const panel = page.getByRole("complementary", {
    name: "Subagents 面板",
    exact: true,
  });
  await expect(
    panel.getByRole("heading", { name: /Active · 5/ }),
  ).toBeVisible();
  await expect(panel.getByRole("heading", { name: /Done · 12/ })).toBeVisible();
  await expect(
    panel.locator(".subagents-section").first().locator(".subagent-row"),
  ).toHaveCount(4);
  await expect(
    panel.locator(".subagents-section").last().locator(".subagent-row"),
  ).toHaveCount(10);
  await expect(panel.getByText("1 等待中", { exact: true })).toBeVisible();
  await panel
    .getByRole("button", { name: "显示其余 1 个", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "显示其余 2 个", exact: true })
    .click();
  await expect(panel.locator(".subagent-row")).toHaveCount(17);
  const avatar = panel.locator(".subagent-avatar-light").first();
  await expect(avatar).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await panel.locator(".subagents-panel").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: `artifacts/anywork-subagents-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(state.writes).toEqual([]);
});

test("lifecycle navigation opens the child in the same pane, sends only to that child and preserves the parent draft", async ({
  page,
}, info) => {
  const { state, parentId, childId } = await fixture(page);
  const parentInput = page.getByRole("textbox", { name: "消息", exact: true });
  await fillPromptText(parentInput, "父会话草稿保持不变");
  await page.locator(".turn-disclosure").click();
  await page.locator('[data-message-id="done-row"]').click();
  const detail = page.getByRole("region", {
    name: "子 Agent 会话：Develop app",
    exact: true,
  });
  await expect(
    detail.getByText("子会话内容：这是同面板中的真实历史。", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp("#" + parentId + "$"));
  expect(state.writes).toEqual([]);
  const input = detail.getByRole("textbox", {
    name: "给 Develop app 发送消息",
    exact: true,
  });
  await fillPromptText(input, "继续核对布局");
  await detail.getByRole("button", { name: "发送", exact: true }).click();
  await expect
    .poll(() => state.writes.filter((r) => r.path.endsWith("/messages")).length)
    .toBe(1);
  expect(state.writes[0].path).toBe(`/sessions/${childId}/messages`);
  expect(state.writes[0].body.mode).toBe("steer");
  await expect(
    detail.getByText("子 Agent 已收到这条引导。", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/anywork-subagent-detail-${info.project.name}.png`,
    fullPage: true,
  });
  await detail
    .getByRole("button", { name: "返回子 Agent 列表", exact: true })
    .click();
  await expect(page.locator(".subagents-panel")).toBeVisible();
  await page.getByRole("button", { name: "关闭预览面板", exact: true }).click();
  await expectPromptText(parentInput, "父会话草稿保持不变");
  expect(state.writes.map((r) => r.path)).toEqual([
    `/sessions/${childId}/messages`,
  ]);
});

test("unknown child history stays read only and opening it never starts an execution", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await openPanel(page);
  const panel = page.getByRole("complementary", {
    name: "Subagents 面板",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "显示其余 2 个", exact: true })
    .click();
  await panel
    .getByRole("button", {
      name: "查看子 Agent：Read only member",
      exact: true,
    })
    .click();
  await expect(
    panel.getByText("这个子 Agent 的历史尚未出现在当前服务器的会话目录中。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  expect(state.writes).toEqual([]);
  await page
    .getByRole("button", { name: "关闭标签：Subagents", exact: true })
    .click();
  await expect(page.locator("#conversation-panel")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Subagents", exact: true }),
  ).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test("child image stays open through history refresh and child document tabs keep the parent selected", async ({
  page,
}) => {
  const { state, parentId, childId } = await fixture(page);
  await openPanel(page);
  await page
    .getByRole("button", { name: "查看子 Agent：Develop app", exact: true })
    .click();
  const detail = page.getByRole("region", {
    name: "子 Agent 会话：Develop app",
    exact: true,
  });
  await detail
    .getByRole("button", { name: "已查看 1 张图像", exact: true })
    .click();
  await detail.getByLabel("查看图片", { exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "图片查看器", exact: true });
  await expect(viewer).toBeVisible();
  const reads = state.historyReads.filter((p) => p.includes(childId)).length;
  state.pushLive({
    session_id: childId,
    seq: 101,
    method: "item/completed",
    params: {
      turnId: childId + "-turn",
      item: {
        id: "live-child",
        type: "agentMessage",
        phase: "commentary",
        text: "后台同步的新进度",
      },
    },
    created_at: Date.now(),
  });
  await expect(
    detail.getByText("后台同步的新进度", { exact: true }),
  ).toBeAttached();
  expect(state.historyReads.filter((p) => p.includes(childId))).toHaveLength(
    reads,
  );
  await expect(viewer).toBeVisible();
  await page
    .getByRole("button", { name: "关闭图片查看器", exact: true })
    .click();
  await detail
    .getByRole("link", { name: "子 Agent 文档", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Child scoped document", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp("#" + parentId + "$"));
  expect(state.fileReads.length).toBeGreaterThan(0);
  expect(state.fileReads.every((p) => p === `/sessions/${childId}/files`)).toBe(
    true,
  );
  await page.getByRole("tab", { name: "Subagents", exact: true }).click();
  await expect(detail).toBeVisible();
  expect(state.writes).toEqual([]);
});
