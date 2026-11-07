import { test, expect } from "@playwright/test";
for (const agent of ["deepseek-harness", "workbuddy"]) {
  test(`${agent} persisted body remains visible when host connection and SSE are unavailable`, async ({
    page,
  }) => {
    const session = {
      id: `${agent}-native`,
      thread_id: "native",
      title: `${agent} 历史`,
      cwd: "/removed-project",
      agent,
      policy: "manual",
      status: "external",
      external: true,
      archived: false,
      created_at: 1,
      updated_at: 2,
    };
    let messages = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname.slice(4);
      if (path.endsWith("/messages")) messages++;
      let data: unknown = {};
      if (path === "/info")
        data = { workspace: "/fixture", hostname: "offline-history" };
      else if (path === "/sessions") data = { sessions: [session] };
      else if (path === "/plugins")
        data = { plugins: [{ id: agent, name: agent, capabilities: [] }] };
      else if (path === "/workspaces") data = { workspaces: [] };
      else if (path.endsWith("/connect"))
        data = {
          connected: false,
          mode: "history",
          session,
          reason: "原生桌面未连接",
        };
      else if (path.endsWith("/history"))
        data = {
          events: [
            {
              session_id: session.id,
              seq: 1,
              method: "user/message",
              created_at: 1,
              params: { text: `${agent} 保存的问题` },
            },
            {
              session_id: session.id,
              seq: 2,
              method: "item/completed",
              created_at: 2,
              params: {
                item: {
                  id: "answer",
                  type: "agentMessage",
                  text: `${agent} 保存的回复`,
                  status: "completed",
                },
              },
            },
          ],
          latest_seq: 2,
          next_cursor: null,
        };
      else if (path.endsWith("/events"))
        return route.fulfill({
          status: 503,
          json: { message: "native host offline" },
        });
      else if (path.endsWith("/events/poll")) data = { events: [], cursor: 2 };
      else if (path.endsWith("/composer"))
        data = {
          settings_available: false,
          models: [],
          goal: null,
          reason: "原生桌面未连接",
        };
      else if (path.endsWith("/models"))
        data = { data: [], settings_available: false };
      else if (path.endsWith("/feedback")) data = { feedback: [] };
      else if (path.endsWith("/edit")) data = { operation: null };
      else if (path.endsWith("/queue")) data = { items: [], paused: false };
      else if (/^\/sessions\/[^/]+$/.test(path)) data = { session };
      await route.fulfill({ json: data });
    });
    await page.addInitScript(() =>
      localStorage.setItem(
        "ra.connection",
        JSON.stringify({
          url: location.origin,
          token: "isolated-history-fixture-key",
        }),
      ),
    );
    await page.goto(`/#${session.id}`);
    await expect(page.locator(".chat-scroll")).toContainText(
      `${agent} 保存的问题`,
    );
    await expect(page.locator(".chat-scroll")).toContainText(
      `${agent} 保存的回复`,
    );
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("保留离线草稿");
    const rejectedConnection = page.waitForResponse(
      (response) =>
        response.url().endsWith("/connect") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await rejectedConnection;
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toContainText("保留离线草稿");
    expect(messages).toBe(0);
    await expect(
      page.getByRole("combobox", { name: "审批模式" }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "重试连接" })).toBeVisible();
    await expect(page.locator(".chat-scroll")).toContainText(
      `${agent} 保存的回复`,
    );
  });
}
