import { expect, test } from "@playwright/test";

// Reproduce the real compact-history/SSE ordering from release CI without racing
// a fast local process or sending a prompt to an existing engine.
test("compacted completed history and delayed live replay retain one canonical answer", async ({
  page,
}) => {
  const now = Date.now();
  const session = {
    id: "replay",
    thread_id: "thread",
    title: "Replay fixture",
    cwd: "/work",
    agent: "codex",
    model: null,
    policy: "manual",
    status: "idle",
    archived: false,
    created_at: now,
    updated_at: now,
  };
  const event = (seq: number, method: string, params: unknown) => ({
    seq,
    method,
    params,
    session_id: session.id,
    created_at: now,
  });
  const text = "文档已准备好：[设计说明](/work/docs/guide.md)。";
  const started = event(11, "turn/started", { turn: { id: "turn" } });
  const completed = event(15, "item/completed", {
    turnId: "turn",
    item: { id: "answer", type: "agentMessage", text },
  });
  const done = event(16, "turn/completed", {
    turn: { id: "turn", status: "completed" },
  });
  const snapshot = [
    event(9, "user/message", { text: "document-preview" }),
    started,
    completed,
    done,
  ];
  let release!: () => void;
  const delayedStream = new Promise<void>((resolve) => {
    release = resolve;
  });
  let delivered = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    let data: unknown = {};
    if (path === "/info")
      data = {
        hostname: "Replay fixture",
        workspace: "/work",
        client_presence: false,
      };
    else if (path === "/sessions") data = { sessions: [session] };
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
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path === "/events/poll") data = { events: [], cursor: 10 };
    else if (path === "/events") {
      if (delivered) {
        await route.fulfill({
          contentType: "text/event-stream",
          body: ": heartbeat\n\n",
        });
        return;
      }
      delivered = true;
      await delayedStream;
      const replay = [
        started,
        event(12, "item/started", {
          turnId: "turn",
          item: { id: "answer", type: "agentMessage", text: "" },
        }),
        event(13, "item/agentMessage/delta", {
          turnId: "turn",
          itemId: "answer",
          delta: text,
        }),
        completed,
        done,
        event(17, "item/completed", {
          turnId: "turn",
          item: {
            id: "replay-marker",
            type: "commandExecution",
            command: "replay checkpoint",
            status: "completed",
            aggregatedOutput: "Replay received",
          },
        }),
      ];
      await route.fulfill({
        contentType: "text/event-stream",
        body: replay
          .map((value) => `data: ${JSON.stringify(value)}\n\n`)
          .join(""),
      });
      return;
    } else if (path.endsWith("/history"))
      data = { events: snapshot, latest_seq: 16, next_cursor: null };
    else if (path.endsWith("/events/poll")) data = { events: [] };
    else if (path.endsWith("/connect")) data = { connected: true };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (path === "/sessions/replay") data = { session };
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({ url: location.origin, token: "replay-fixture" }),
    ),
  );
  await page.goto("/#replay");
  const answer = page.getByRole("link", { name: "设计说明", exact: true });
  await expect(answer).toHaveCount(1);
  await expect(answer).toBeVisible();
  release();
  await expect(
    page.locator('[data-message-id="replay-marker"]'),
  ).toBeAttached();
  await expect(answer).toHaveCount(1);
  await expect(answer).toBeVisible();
  await expect(page.locator('[data-message-id="answer"]')).toHaveCount(1);
});
