import { expectPromptText, fillPromptText } from "./prompt-editor-helpers";
import { expect, test, type Page } from "./local-fixture";
import type { AgentEvent } from "../web/src/types";

test.use({ timezoneId: "Asia/Shanghai" });
const now = new Date("2026-11-04T16:00:00+08:00").getTime();
async function fixture(page: Page, history = false, displayText?: string) {
  await page.clock.install({ time: new Date(now) });
  const state = {
    detailRequests: [] as string[],
  };
  const text =
    "**确认修改**\n\n![截图](docs/screenshot.png) 与 ![外部](https://example.com/example.png)\n\n[文档](docs/guide.md)";
  const events: AgentEvent[] = [
    {
      seq: 1,
      session_id: "user-a",
      method: "user/message",
      params: {
        text,
        ...(displayText === undefined ? {} : { display_text: displayText }),
        attachments: ["/work/project/guide.md"],
        ...(history ? { history_turn_id: "turn-a" } : {}),
      },
      created_at: now - 2 * 36e5,
    },
    {
      seq: 2,
      session_id: "user-a",
      method: "turn/started",
      params: { turn: { id: "turn-a", startedAt: (now - 2 * 36e5) / 1000 } },
      created_at: now - 2 * 36e5,
    },
    {
      seq: 3,
      session_id: "user-a",
      method: "item/completed",
      params: {
        item: {
          id: "answer",
          type: "agentMessage",
          phase: "final_answer",
          text: "已完成。",
        },
      },
      created_at: now - 2 * 36e5 + 1000,
    },
    {
      seq: 4,
      session_id: "user-a",
      method: "turn/completed",
      params: { turn: { id: "turn-a", status: "completed" } },
      created_at: now - 2 * 36e5 + 2000,
    },
    {
      seq: 1,
      session_id: "user-b",
      method: "user/message",
      params: { text: "另一会话的消息" },
      created_at: now,
    },
  ];
  const sessions = ["user-a", "user-b"].map((id) => ({
    id,
    title: id === "user-a" ? "用户消息" : "另一会话",
    thread_id: id,
    agent: "fixture",
    cwd: "/work/project",
    model: null,
    policy: "manual",
    status: "idle",
    archived: false,
    created_at: now,
    updated_at: now,
  }));
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/local/session")
      return route.fallback();
    const url = new URL(route.request().url()),
      path = url.pathname.slice(4),
      id = path.split("/")[2];
    let data: unknown;
    if (path === "/info")
      data = { workspace: "/work/project", hostname: "user-fixture" };
    else if (path === "/plugins")
      data = {
        plugins: [{ id: "fixture", name: "Fixture", capabilities: [] }],
      };
    else if (path === "/sessions") data = { sessions };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path.endsWith("/history"))
      data = {
        events: events.filter((event) => event.session_id === id),
        next_cursor: null,
        latest_seq: 4,
      };
    else if (path.endsWith("/events/poll")) data = { events: [] };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (
      path.endsWith("/image") ||
      path.endsWith("/document") ||
      path.endsWith("/files")
    ) {
      state.detailRequests.push(path);
      data = { error: "test fixture does not load content" };
      await route.fulfill({ status: 404, json: data });
      return;
    } else if (/^\/sessions\/[^/]+$/.test(path))
      data = { session: sessions.find((session) => session.id === id) };
    else throw new Error(`Unexpected user-message request: ${path}`);
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    localStorage.setItem("ra.sidebar-pinned", "false");
    (window as any).userCopy = {
      fail: false,
      hold: false,
      calls: 0,
      text: "",
      html: "",
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          const state = (window as any).userCopy;
          state.calls++;
          if (state.hold)
            await new Promise<void>((resolve, reject) => {
              state.resolve = resolve;
              state.reject = reject;
            });
          if (state.fail) throw new Error("clipboard denied");
          state.text = await (await items[0].getType("text/plain")).text();
          state.html = await (await items[0].getType("text/html")).text();
        },
      },
    });
  });
  await page.goto(`${process.env.USER_MESSAGE_TEST_URL || ""}/#user-a`);
  await expect(page.locator(".message.user")).toBeVisible();
  return { state, text };
}

test("user images stay links, attachments appear once, and copying preserves formatted content and the draft", async ({
  page,
}, info) => {
  const { state } = await fixture(page);
  const message = page.locator(".message.user");
  await expect(message.locator(".markdown strong")).toHaveText("确认修改");
  const paragraphGaps = await message
    .locator(".md-paragraph")
    .evaluateAll((nodes) =>
      nodes
        .slice(1)
        .map(
          (node, index) =>
            node.getBoundingClientRect().top -
            nodes[index].getBoundingClientRect().bottom,
        ),
    );
  for (const gap of paragraphGaps) expect(gap).toBeCloseTo(20, 0);
  await expect(
    message.locator(
      ".markdown .image-load-trigger, .markdown img, .remote-image-placeholder",
    ),
  ).toHaveCount(0);
  await expect(
    message.getByRole("link", { name: "截图", exact: true }),
  ).toHaveAttribute("href", "docs/screenshot.png");
  await expect(
    message.getByRole("link", { name: "外部", exact: true }),
  ).toHaveAttribute("href", "https://example.com/example.png");
  expect(state.detailRequests).toEqual([]);
  await expect(message.locator(".message-file-attachment")).toHaveCount(1);
  await expect(message.locator(".markdown")).not.toContainText("📎");
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "复制时保留输入草稿",
  );
  await message.getByRole("button", { name: "复制消息", exact: true }).focus();
  await expect(message.locator(".user-message-time")).toHaveText("14:00");
  await message.getByRole("button", { name: "复制消息", exact: true }).click();
  const copied = message.getByRole("button", { name: "已复制", exact: true });
  await expect(copied).toBeFocused();
  const copy = await page.evaluate(() => (window as any).userCopy);
  expect(copy.text).toContain("确认修改");
  expect(copy.text).toContain("!截图");
  expect(copy.text).not.toContain("**");
  expect(copy.html).toContain("<strong>确认修改</strong>");
  expect(copy.html).not.toContain("<svg");
  expect(copy.html).not.toContain("<button");
  await copied.click();
  expect(await page.evaluate(() => (window as any).userCopy.calls)).toBe(1);
  await expectPromptText(
    page.getByLabel("消息", { exact: true }),
    "复制时保留输入草稿",
  );
  await expect(page.locator(".conversation-timestamp time")).toHaveAttribute(
    "datetime",
    new Date(now - 2 * 36e5).toISOString(),
  );
  await expect(page.locator(".conversation-timestamp")).toContainText(
    "今天 14:00",
  );
  await page.screenshot({
    path: `artifacts/anywork-user-message-${info.project.name}.png`,
  });
  await expect(
    message.getByRole("button", { name: "复制消息", exact: true }),
  ).toBeVisible();
});

test("unknown imported message time stays absent and copy failure can retry without leaking into another session", async ({
  page,
}) => {
  await fixture(page, true);
  const message = page.locator(".message.user");
  await expect(message.locator(".user-message-time")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).userCopy.fail = true;
  });
  const copy = message.getByRole("button", { name: "复制消息", exact: true });
  await copy.focus();
  await copy.click();
  await expect(message.getByRole("alert")).toContainText("复制失败");
  await expect(
    message.getByRole("button", { name: "已复制", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).userCopy.fail = false;
  });
  await copy.click();
  await expect(
    message.getByRole("button", { name: "已复制", exact: true }),
  ).toBeVisible();
  await expect(message.getByRole("alert")).toHaveCount(0);
  await page.clock.runFor(1501);
  await page.evaluate(() => {
    (window as any).userCopy.hold = true;
  });
  await copy.click();
  await page.evaluate(() => {
    location.hash = "user-b";
  });
  await expect(message).toContainText("另一会话的消息");
  await page.evaluate(() => {
    (window as any).userCopy.reject(new Error("old clipboard operation"));
  });
  await expect(message.getByRole("alert")).toHaveCount(0);
  await expect(
    message.getByRole("button", { name: "复制消息", exact: true }),
  ).toBeVisible();
});

test("native display text is not extracted a second time and full copying uses the displayed body", async ({
  page,
}) => {
  const display = "正文 ## My request: 这段不能再次提取";
  await fixture(page, false, display);
  const message = page.locator(".message.user");
  await expect(message.locator(".markdown")).toHaveText(display);
  await expect(message.locator(".markdown strong")).toHaveCount(0);
  await message.getByRole("button", { name: "复制消息", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).userCopy.text))
    .toBe(display);
  expect(
    await page.evaluate(() => (window as any).userCopy.html),
  ).not.toContain("确认修改");
});
