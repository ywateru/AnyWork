import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const now = Date.now();
  const session = {
    id: "tools-fixture",
    thread_id: "tools-fixture",
    title: "Tool activity reference",
    agent: "fixture",
    cwd: "/work/project",
    policy: "manual",
    status: "idle",
    archived: false,
    created_at: now,
    updated_at: now,
  };
  const item = (
    id: string,
    type: string,
    extra: Record<string, unknown> = {},
  ) => ({ id, type, status: "completed", ...extra });
  const items = [
    item("notes", "mcpToolCall", {
      server: "Notes",
      tool: "read_page",
      toolDisplay: { invoked: "已读取笔记" },
      history_detail: { turn_id: "t", item_id: "notes" },
    }),
    item("read", "commandExecution", {
      command: "cat README.md",
      aggregatedOutput: "# Project",
      commandActions: [{ type: "read", name: "README.md" }],
    }),
    item("command", "commandExecution", {
      command: "cargo test",
      aggregatedOutput: "3 tests passed",
    }),
    item("interlude", "agentMessage", {
      phase: "commentary",
      text: "继续检查子 Agent 的结果。",
    }),
    item("finished", "subAgentActivity", {
      agentThreadId: "child",
      agentPath: "/root/native_ui_research",
      kind: "completed",
    }),
    item("sent", "subAgentActivity", {
      agentThreadId: "child",
      agentPath: "/root/develop_app",
      kind: "interacted",
    }),
    item("spawn", "collabAgentToolCall", {
      tool: "spawnAgent",
      receiverThreadIds: ["child"],
      receiverThreads: [
        {
          threadId: "child",
          thread: { title: "Develop app", agentRole: "worker" },
        },
      ],
      prompt: "核对工具行与截图的布局。\n保留图片预览。",
      model: "fixture-model",
      agentsStates: { child: { status: "completed", message: "布局检查完成" } },
    }),
    item("failed", "mcpToolCall", {
      server: "Notes",
      tool: "edit_page",
      error: { message: "Access denied by fixture" },
    }),
    item("answer", "agentMessage", {
      phase: "final_answer",
      text: "检查完成。",
    }),
  ];
  const events = [
    {
      seq: 1,
      session_id: session.id,
      method: "user/message",
      params: { text: "核对工作过程" },
      created_at: now - 10000,
    },
    {
      seq: 2,
      session_id: session.id,
      method: "turn/started",
      params: { turn: { id: "t", startedAt: (now - 10000) / 1000 } },
      created_at: now - 10000,
    },
    ...items.map((value, i) => ({
      seq: i + 3,
      session_id: session.id,
      method: "item/completed",
      params: { turnId: "t", item: value },
      created_at: now - 9000 + i * 100,
    })),
    {
      seq: items.length + 3,
      session_id: session.id,
      method: "turn/completed",
      params: { turn: { id: "t", status: "completed" } },
      created_at: now,
    },
  ];
  const requests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    if (
      route.request().method() === "POST" &&
      !path.endsWith("/clients/heartbeat")
    )
      throw new Error(`Unexpected write ${path}`);
    let data: unknown = {};
    if (path === "/info")
      data = { workspace: "/work/project", hostname: "tools-fixture" };
    else if (path === "/plugins")
      data = {
        plugins: [{ id: "fixture", name: "Fixture", capabilities: [] }],
      };
    else if (path === "/sessions") data = { sessions: [session] };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path.endsWith("/history/item")) {
      requests.push(path);
      data = {
        item: item("notes", "mcpToolCall", {
          server: "Notes",
          tool: "read_page",
          result: {
            type: "success",
            content: [
              {
                type: "text",
                text: '{"title":"Fixture notes","verified":true}',
              },
            ],
            structuredContent: { title: "Fixture notes", verified: true },
          },
        }),
      };
    } else if (path.endsWith("/history"))
      data = { events, next_cursor: null, latest_seq: events.at(-1)!.seq };
    else if (path.endsWith("/events/poll")) data = { events: [] };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (/^\/sessions\/[^/]+$/.test(path)) data = { session };
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({ url: location.origin, token: "tool-activity-fixture" }),
    );
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  await page.goto(`/#${session.id}`);
  await expect(page.getByText("检查完成。", { exact: true })).toBeVisible();
  return requests;
}

test("native activity groups, lazy MCP output and subagent events remain flat and readable", async ({
  page,
}, info) => {
  const requests = await fixture(page);
  await page.locator(".turn-disclosure").click();
  const group = page
    .locator(".activity-group")
    .filter({ hasText: "使用了 Notes 集成，读取了文件，运行了命令" });
  await expect(group).toHaveCount(1);
  await group.locator(":scope > summary").click();
  expect(requests).toHaveLength(0);
  const notes = page.locator('[data-message-id="notes"]');
  await notes.locator(":scope > summary").click();
  await expect(notes.locator(".tool-structured-output")).toContainText(
    '"title": "Fixture notes"',
  );
  expect(requests).toHaveLength(1);
  await expect(notes.locator(".tool-text-output")).toHaveCount(0);
  await expect(
    notes.getByText("查看原始工具输出 · Notes.read_page", { exact: true }),
  ).toBeVisible();
  const event = page.locator('[data-message-id="finished"]');
  await expect(event).toContainText("Native ui research 已完成");
  await expect(page.locator('[data-message-id="sent"]')).toContainText(
    "已发送消息给 Develop app",
  );
  const action = page.locator('[data-message-id="spawn"]');
  await action.locator(":scope > summary").click();
  await expect(action).toContainText("核对工具行与截图的布局。");
  await expect(action.locator('[title="使用 fixture-model"]')).toHaveText(
    "Develop app",
  );
  const failed = page.locator('[data-message-id="failed"]');
  await failed.locator(":scope > summary").click();
  await expect(failed.getByRole("alert")).toHaveText(
    "Access denied by fixture",
  );
  const style = await event.evaluate((node) => ({
    background: getComputedStyle(node).backgroundColor,
    border: getComputedStyle(node).borderTopWidth,
    size: getComputedStyle(node).fontSize,
  }));
  expect(style.background).toBe("rgba(0, 0, 0, 0)");
  expect(style.border).toBe("0px");
  expect(parseFloat(style.size)).toBeGreaterThanOrEqual(13);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath(`tool-activity-${info.project.name}.png`),
    fullPage: true,
  });
});
