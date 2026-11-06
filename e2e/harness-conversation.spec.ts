import { expect, test, type Page } from "@playwright/test";
import { fillPromptText } from "./prompt-editor-helpers";

async function fixture(page: Page, status = "running") {
  const now = Date.now();
  const sessions = ["deepseek-harness", "codex"].map((agent) => ({
    id: agent,
    thread_id: agent,
    title: `${agent} shared chat`,
    cwd: "/work/project",
    agent,
    policy: "manual",
    status,
    archived: false,
    created_at: now - 200000,
    updated_at: now,
  }));
  const writes: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    if (
      route.request().method() === "POST" &&
      !path.endsWith("/clients/heartbeat")
    )
      writes.push(path);
    const id = path.split("/")[2];
    const session = sessions.find((s) => s.id === id) ?? sessions[0];
    const event = (
      seq: number,
      method: string,
      params: unknown,
      time = now - 190000,
    ) => ({
      seq,
      session_id: session.id,
      method,
      params,
      created_at: time,
    });
    const item = (
      seq: number,
      value: Record<string, unknown>,
      method = "item/completed",
    ) => event(seq, method, { turnId: "t", item: value });
    let data: unknown = {};
    if (path === "/info")
      data = { hostname: "Harness UI fixture", workspace: "/work/project" };
    else if (path === "/plugins")
      data = {
        plugins: [
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
            capabilities: ["chat", "interrupt"],
          },
        ],
      };
    else if (path === "/sessions") data = { sessions };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path.endsWith("/history")) {
      const events = [
        event(1, "user/message", { text: "检查项目并保留现有输入框" }),
        event(2, "turn/started", {
          turn: { id: "t", startedAt: (now - 191000) / 1000 },
        }),
        item(3, {
          id: "reasoning",
          type: "reasoning",
          summary: [
            {
              type: "summary_text",
              text: "检查本地状态\n\n无需触碰实际客户端。",
            },
          ],
          status: "completed",
        }),
        item(4, {
          id: "commentary",
          type: "agentMessage",
          phase: "commentary",
          text: "先查看本地状态，再核对输出。",
        }),
        item(5, {
          id: "read",
          type: "dynamicToolCall",
          tool: "read",
          title: "read",
          arguments: { path: "/tmp/report.txt" },
          status: "completed",
          result: {
            content: [{ type: "text", text: "fixture report\n".repeat(60) }],
          },
        }),
        item(6, {
          id: "failed",
          type: "dynamicToolCall",
          tool: "bash",
          title: "运行命令",
          description: "检查失败状态",
          status: "failed",
          error: { message: "fixture failure" },
        }),
        item(7, {
          id: "interrupted",
          type: "dynamicToolCall",
          tool: "bash",
          title: "运行命令",
          description: "停止的任务",
          status: "interrupted",
        }),
        item(
          8,
          {
            id: "live",
            type: "dynamicToolCall",
            tool: "job_output",
            title: "job_output",
            arguments: { job_id: "bash-42 · 检查数据卷容量与本地快照" },
            status: "running",
          },
          "item/started",
        ),
      ];
      if (status !== "running") {
        events.push(
          item(9, {
            id: "answer",
            type: "agentMessage",
            phase: "final_answer",
            text: "检查完成。\n\n[打开文档](./README.md)\n\n```ts\nconst result = 42;\n```",
          }),
        );
        events.push(
          event(
            10,
            "turn/completed",
            {
              turn: {
                id: "t",
                status: status === "failed" ? "failed" : "completed",
              },
            },
            now,
          ),
        );
      }
      data = { events, latest_seq: events.at(-1)!.seq, next_cursor: null };
    } else if (path.endsWith("/events/poll")) data = { events: [] };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (/^\/sessions\/[^/]+$/.test(path)) data = { session };
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({ url: location.origin, token: "harness-ui-fixture" }),
    );
    localStorage.setItem("ra.sidebar-pinned", "false");
    localStorage.setItem("ra.theme", "light");
  });
  await page.goto("/#deepseek-harness");
  return writes;
}

test("extracted Harness tools and live clock remain compact, keyboard operable and preserve the composer", async ({
  page,
}, info) => {
  const writes = await fixture(page);
  await expect(page.locator('[data-message-id="live"]')).toContainText(
    "读取任务输出",
  );
  await expect(page.locator('[data-message-id="live"]')).toContainText(
    "运行中",
  );
  await expect(page.locator("[data-chat-running]")).toContainText(
    /深度求索中，用时 3 分/,
  );
  await expect(page.locator('[data-message-id="failed"]')).toHaveAttribute(
    "data-state",
    "error",
  );
  await expect(page.locator('[data-message-id="interrupted"]')).toContainText(
    "已中断",
  );
  const read = page.locator('[data-message-id="read"]');
  await read.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(read).toHaveAttribute("open", "");
  await expect(read.locator(".tool-text-output")).toContainText(
    "fixture report",
  );
  await page.keyboard.press("Enter");
  await expect(read).not.toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: /^思考/ })).toBeVisible();
  await fillPromptText(
    page.getByRole("textbox", { name: "消息", exact: true }),
    "保留我的输入草稿",
  );
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toContainText("保留我的输入草稿");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const row = await read.locator("summary").boundingBox();
  const nextRow = await page
    .locator('[data-message-id="failed"] > summary')
    .boundingBox();
  expect(nextRow!.y - row!.y).toBeLessThanOrEqual(36);
  expect(row!.height).toBeGreaterThanOrEqual(24);
  expect(row!.height).toBeLessThanOrEqual(32);
  await page.screenshot({
    path: info.outputPath(`harness-running-${info.project.name}.png`),
    fullPage: true,
  });
  expect(writes).toEqual([]);
});

test("agent switch isolates public Harness reasoning and completed content retains tool details", async ({
  page,
}) => {
  await fixture(page, "idle");
  await expect(page.getByText("检查完成。", { exact: true })).toBeVisible();
  await page.locator(".turn-disclosure").click();
  const reasoning = page.getByRole("button", { name: /^思考/ });
  await reasoning.click();
  await expect(
    page.getByText("无需触碰实际客户端。", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    location.hash = "codex";
  });
  await expect(page.getByText("检查完成。", { exact: true })).toBeVisible();
  await page.locator(".turn-disclosure").click();
  await expect(page.getByRole("button", { name: /^思考/ })).toHaveCount(0);
  await expect(
    page.getByText("无需触碰实际客户端。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("[data-chat-running]")).toHaveCount(0);
  await page.evaluate(() => {
    location.hash = "deepseek-harness";
  });
  await expect(page.getByRole("button", { name: /^思考/ })).toBeVisible();
  await expect(
    page.getByText("无需触碰实际客户端。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".markdown pre")).toContainText(
    "const result = 42",
  );
});
