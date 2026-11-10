import { expect, test, type Page } from "./local-fixture";

async function fixture(page: Page, longOutput = false) {
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
    if (new URL(route.request().url()).pathname === "/api/local/session")
      return route.fallback();
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
          callId: "provider-call-notes",
          server: "Notes",
          tool: "read_page",
          durationMs: 125,
          invocation: {
            server: "Notes",
            tool: "read_page",
            arguments: { page: "fixture" },
          },
          result: {
            type: "success",
            content: [
              {
                type: "text",
                text: '{"title":"Fixture notes","verified":true}',
              },
            ],
            structuredContent: {
              title: "Fixture notes",
              verified: true,
              ...(longOutput
                ? {
                    lines: Array.from(
                      { length: 400 },
                      (_, i) => `line-${i}: ${"output ".repeat(60)}`,
                    ),
                  }
                : {}),
            },
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
    localStorage.setItem("ra.sidebar-pinned", "false");
    localStorage.setItem("ra.theme", "system");
  });
  await page.goto(`/#${session.id}`);
  await expect(page.getByText("检查完成。", { exact: true })).toBeVisible();
  return requests;
}

test("Harness activity rows, lazy MCP output and subagent events remain flat and readable", async ({
  page,
}, info) => {
  const requests = await fixture(page);
  await page.locator(".turn-disclosure").click();
  await expect(
    page.locator(".activity-group").filter({ hasText: "使用了 Notes 集成" }),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-message-id="read"] > summary'),
  ).toContainText("读取");
  await expect(
    page.locator('[data-message-id="command"] > summary'),
  ).toContainText("cargo test");
  expect(requests).toHaveLength(0);
  const notes = page.locator('[data-message-id="notes"]');
  await notes.locator(":scope > summary").click();
  await expect(notes.locator(".tool-structured-output")).toContainText(
    '"title": "Fixture notes"',
  );
  expect(requests).toHaveLength(1);
  await expect(notes.locator(".tool-text-output")).toHaveCount(0);
  await expect(
    notes.getByRole("button", { name: "查看原始工具输出", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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

async function openRawOutput(page: Page, longOutput = false) {
  await fixture(page, longOutput);
  await page.locator(".turn-disclosure").click();
  const notes = page.locator('[data-message-id="notes"]');
  await notes.locator(":scope > summary").click();
  const trigger = notes.getByRole("button", {
    name: "查看原始工具输出",
    exact: true,
  });
  await trigger.hover();
  await trigger.click();
  return { trigger, dialog: page.getByRole("dialog") };
}

test("raw output modal preserves payload, traps focus, copies and closes without changing the chat", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          if ((window as any).rejectFixtureCopy)
            throw new Error("fixture clipboard denied");
          (window as any).copiedFixtureOutput = value;
        },
      },
    });
  });
  const { trigger, dialog } = await openRawOutput(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading")).toHaveText(
    "原始 Notes.read_page 工具输出",
  );
  const payload = dialog.getByLabel("原始工具调用 JSON");
  const raw = await payload.textContent();
  expect(JSON.parse(raw!)).toMatchObject({
    callId: "provider-call-notes",
    invocation: {
      server: "Notes",
      tool: "read_page",
      arguments: { page: "fixture" },
    },
    durationMs: 125,
    result: { structuredContent: { title: "Fixture notes", verified: true } },
  });
  const close = dialog.getByRole("button", { name: "关闭原始工具输出" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(payload).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await dialog
    .getByRole("button", { name: "复制原始输出", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "已复制原始输出" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).copiedFixtureOutput)).toBe(
    raw,
  );
  await page.screenshot({
    path: info.outputPath(`raw-output-${info.project.name}.png`),
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );

  await trigger.click();
  await expect(
    dialog.getByRole("button", { name: "复制原始输出", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).rejectFixtureCopy = true;
  });
  await dialog
    .getByRole("button", { name: "复制原始输出", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "无法访问剪贴板，请选择下方内容复制。",
  );
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  const bounds = (await payload.boundingBox())!;
  await page.mouse.move(bounds.x + 20, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(4, 4);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("raw output stays scrollable within a small viewport and follows the dark theme", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const { dialog } = await openRawOutput(page, true);
  const geometry = await dialog.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const pre = node.querySelector("pre")!;
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      outputHeight: pre.clientHeight,
      contentHeight: pre.scrollHeight,
      outputWidth: pre.clientWidth,
      contentWidth: pre.scrollWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(16);
  expect(geometry.right).toBeLessThanOrEqual(304);
  expect(geometry.top).toBeGreaterThanOrEqual(16);
  expect(geometry.bottom).toBeLessThanOrEqual(624);
  expect(geometry.outputHeight).toBeLessThanOrEqual(512);
  expect(geometry.contentHeight).toBeGreaterThan(geometry.outputHeight);
  expect(geometry.contentWidth).toBeGreaterThan(geometry.outputWidth);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const colors = await dialog.evaluate((node) => ({
    background: getComputedStyle(node).backgroundColor,
    expected: getComputedStyle(document.documentElement)
      .getPropertyValue("--app-dialog-bg")
      .trim(),
  }));
  expect(colors.expected).toBe("#212121");
  expect(colors.background).toBe("rgb(33, 33, 33)");
  await dialog.getByRole("button", { name: "关闭原始工具输出" }).click();
  await expect(dialog).toHaveCount(0);
});
