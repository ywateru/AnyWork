import { test, expect, type Page } from "@playwright/test";
import type { AgentEvent } from "../web/src/types";

async function fixture(page: Page, older = false) {
  const sessions = ["history-a", "history-b"].map((id) => ({
    id,
    title: id === "history-a" ? "带定位栏的长对话" : "另一条会话",
    cwd: "/fixture",
    agent: "fixture",
    policy: "manual",
    status: "idle",
    archived: false,
    created_at: 1,
    updated_at: 1,
  }));
  let reads = 0;
  const events = (id: string, start: number, end: number): AgentEvent[] =>
    Array.from({ length: end - start }, (_, offset) => {
      const n = start + offset,
        turn = `turn-${n}`;
      return [
        {
          session_id: id,
          seq: n * 2 + 1,
          method: "user/message",
          created_at: 1,
          params: {
            history_turn_id: turn,
            history_turn_status: "completed",
            text: `${id === "history-b" ? "另一会话" : "问题"} ${n + 1}：检查项目的第 ${n + 1} 部分`,
            attachments: n === 0 ? ["fixture-image.png"] : [],
          },
        },
        {
          session_id: id,
          seq: n * 2 + 2,
          method: "item/completed",
          created_at: 1,
          params: {
            history_turn_id: turn,
            history_turn_status: "completed",
            item: {
              id: `answer-${n}`,
              type: "agentMessage",
              phase: "final_answer",
              text: `回答 ${n + 1}：已完成对应部分的检查。\n\n${"这是用于验证滚动定位的对话正文，包含详细的检查说明和处理结果。".repeat(8)}`,
            },
          },
        },
      ] as AgentEvent[];
    }).flat();
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.slice(4),
      id = path.split("/")[2];
    let data: unknown = {};
    if (path === "/info")
      data = { workspace: "/fixture", hostname: "history-fixture" };
    else if (path === "/plugins")
      data = {
        plugins: [{ id: "fixture", name: "Fixture", capabilities: [] }],
      };
    else if (path === "/sessions") data = { sessions };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path.endsWith("/history")) {
      reads++;
      const isOlder = url.searchParams.has("cursor");
      data = {
        events: events(
          id,
          older && !isOlder ? 4 : 0,
          isOlder ? 4 : id === "history-b" ? 2 : 36,
        ),
        next_cursor: older && !isOlder ? "older" : null,
        latest_seq: 72,
      };
    } else if (path.endsWith("/events/poll") || path === "/events/poll")
      data = { events: [], cursor: 0 };
    else if (path.endsWith("/events"))
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": fixture\n\n",
      });
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (path.endsWith("/edit")) data = { operation: null };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (/^\/sessions\/[^/]+$/.test(path))
      data = { session: sessions.find((session) => session.id === id) };
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({
        url: location.origin,
        token: "history-fixture-key-00000",
      }),
    );
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  await page.goto("/#history-a");
  const nav = page.getByRole("navigation", { name: "对话记录定位" });
  await expect(nav).toBeVisible();
  await expect(nav.locator(".history-tick")).toHaveCount(older ? 32 : 36);
  return { nav, reads: () => reads };
}

test("history ticks preview user and assistant text, jump immediately and follow manual scrolling", async ({
  page,
}, info) => {
  const { nav, reads } = await fixture(page);
  const first = nav.getByRole("button", { name: /^第 1 条对话/ });
  if (info.project.name === "desktop") await first.hover();
  else await first.tap();
  const preview = page.locator(".history-preview");
  await expect(preview).toContainText("问题 1：");
  await expect(preview).toContainText("回答 1：");
  if (info.project.name === "desktop") {
    await preview.getByRole("button", { name: "跳转到此处" }).hover();
    await expect(preview).toBeVisible();
  }
  const before = reads();
  await first.click();
  const scroll = page.locator(".chat-scroll");
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop))
    .toBeLessThan(100);
  await expect(first).toHaveAttribute("aria-current", "location");
  expect(reads()).toBe(before);
  await page.screenshot({
    path: `artifacts/anywork-conversation-history-${info.project.name}.png`,
  });
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(nav.locator('[aria-current="location"]')).toHaveAttribute(
    "aria-label",
    /^第 36 条对话/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("history preview closes outside and on session change; keyboard navigation remains usable", async ({
  page,
}) => {
  const { nav } = await fixture(page);
  const last = nav.locator(".history-tick").last();
  await last.focus();
  await expect(page.locator(".history-preview")).toBeVisible();
  await page.getByLabel("消息", { exact: true }).click();
  await expect(page.locator(".history-preview")).toHaveCount(0);
  await last.focus();
  await last.press("Home");
  const first = nav.locator(".history-tick").first();
  await expect(first).toBeFocused();
  await first.press("Enter");
  await expect(first).toHaveAttribute("aria-current", "location");
  await first.press("ArrowDown");
  await expect(nav.locator(".history-tick").nth(1)).toBeFocused();
  await page.evaluate(() => {
    location.hash = "history-b";
  });
  await expect(nav.locator(".history-tick")).toHaveCount(2);
  await expect(page.locator(".history-preview")).toHaveCount(0);
  await page.evaluate(() => {
    location.hash = "history-a";
  });
  await expect(nav.locator(".history-tick")).toHaveCount(36);
  await expect(nav.locator('[aria-current="location"]')).toHaveCount(1);
});

test("loading older records preserves the reading anchor and adds landmarks without duplicates", async ({
  page,
}) => {
  const { nav } = await fixture(page, true);
  const scroll = page.locator(".chat-scroll");
  const anchor = page.locator('[data-message-id="user-21"]');
  await anchor.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const before = (await anchor.boundingBox())!.y;
  await nav.getByRole("button", { name: "加载更早的对话记录" }).click();
  await expect(nav.locator(".history-tick")).toHaveCount(36);
  await expect(
    nav.getByRole("button", { name: "加载更早的对话记录" }),
  ).toHaveCount(0);
  await expect
    .poll(async () => Math.abs((await anchor.boundingBox())!.y - before))
    .toBeLessThan(3);
  expect(await scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});
