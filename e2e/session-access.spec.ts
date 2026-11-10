import { expect, test, type Page } from "./local-fixture";
import { fillPromptText, expectPromptText } from "./prompt-editor-helpers";

async function fixture(page: Page, desktopHistory = false) {
  await page.clock.install();
  const state = {
    history: 0,
    connects: 0,
    connectedSessions: [] as string[],
    models: 0,
    images: 0,
    version: 0,
    ready: false,
    controlled: false,
    status: "external",
    composerWrites: 0,
    settingsEvents: [] as { seq: number; effort: string }[],
    controlPolls: [] as number[],
    sidebarSessions: [] as { id: string; title: string; status: string }[],
    effort: "high",
    messages: 0,
    source: "catalog" as "catalog" | "desktop",
    historyRequests: [] as { source: string; cursor: string | null }[],
    historyNotice:
      "桌面尚未加载完整历史，当前内容包含已保存历史和桌面已加载的回合。",
  };
  const session = {
    id: "codex-independent",
    thread_id: "independent",
    title: "独立进程历史",
    cwd: "/work/project",
    agent: "codex",
    model: "original-model",
    policy: "manual",
    status: "external",
    archived: false,
    external: true,
    created_at: 1,
    updated_at: 2,
  };
  const historyTurn = (
    turnId: string,
    identity: string,
    prompt: string,
    answer: string,
  ) => [
    {
      seq: 1,
      session_id: session.id,
      method: "user/message",
      params: {
        history_id: `${turnId}:${identity}-user`,
        history_turn_id: turnId,
        history_turn_status: "completed",
        text: prompt,
        attachments: [],
      },
      created_at: 2,
    },
    {
      seq: 2,
      session_id: session.id,
      method: "item/completed",
      params: {
        history_id: `${turnId}:${identity}-answer`,
        history_turn_id: turnId,
        history_turn_status: "completed",
        item: {
          id: `${turnId}-${identity}-answer`,
          type: "agentMessage",
          phase: "final_answer",
          text: answer,
        },
      },
      created_at: 2,
    },
  ];
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/local/session")
      return route.fallback();
    const url = new URL(route.request().url()),
      path = url.pathname.slice(4);
    let data: unknown;
    if (path === "/info")
      data = { workspace: "/work/project", hostname: "history-fixture" };
    else if (path === "/plugins") data = { plugins: [] };
    else if (path === "/sessions")
      data = {
        sessions: [
          { ...session, status: state.status },
          ...state.sidebarSessions.map((item) => ({ ...session, ...item })),
        ],
      };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path.endsWith("/history")) {
      state.history++;
      const cursor = url.searchParams.get("cursor");
      state.historyRequests.push({ source: state.source, cursor });
      if (desktopHistory) {
        const earlier = historyTurn(
            "earlier",
            "stable",
            "已经加载的较早提问",
            "已加载较早页的回答",
          ),
          oldest = historyTurn(
            "oldest",
            "stable",
            "最早一页的提问",
            "桌面游标取得的更早回答",
          );
        if (cursor) {
          if (state.source === "catalog") {
            expect(cursor).toBe("catalog-before:turn");
            data = {
              events: earlier,
              next_cursor: "catalog-before:earlier",
              source: "catalog",
            };
          } else {
            // A catalog cursor is invalid once the poll switches to desktop.
            expect(cursor).toBe("desktop-before:turn");
            data = {
              events: [...oldest, ...earlier],
              next_cursor: null,
              source: "desktop",
              replace_turn_ids: ["oldest", "earlier"],
              history_notice: state.historyNotice,
            };
          }
        } else {
          data = {
            // The native desktop identity differs from the saved catalog echo.
            // Only explicit replacement of this turn can remove both old rows.
            events: historyTurn(
              "turn",
              state.source,
              "同一个回合的唯一用户提问",
              state.source === "desktop"
                ? `桌面实时回答 ${state.version}`
                : "已保存的回答 0",
            ),
            next_cursor:
              state.source === "desktop"
                ? "desktop-before:turn"
                : "catalog-before:turn",
            source: state.source,
            ...(state.source === "desktop"
              ? {
                  replace_turn_ids: ["turn"],
                  history_notice: state.historyNotice,
                }
              : {}),
          };
        }
      } else
        data = {
          events: [
            {
              seq: 1,
              session_id: session.id,
              method: "item/completed",
              params: {
                history_id: "turn:answer",
                history_turn_id: "turn",
                history_turn_status: "completed",
                item: {
                  id: "answer",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: `![预览图](/work/project/preview.png)\n\n已保存的回答 ${state.version}`,
                },
              },
              created_at: 2,
            },
          ],
          next_cursor: null,
        };
    } else if (path.endsWith("/connect")) {
      state.connects++;
      state.connectedSessions.push(path.split("/")[2]);
      state.controlled = state.ready;
      data = {
        connected: state.controlled,
        mode: state.controlled ? "control" : "history",
        reason: "已加载会话历史。独立进程暂不可控制。",
      };
    } else if (path.endsWith("/composer")) {
      if (route.request().method() === "POST") {
        state.composerWrites++;
        state.effort = route.request().postDataJSON().effort;
      }
      data = {
        model: session.model,
        effort: state.controlled ? state.effort : null,
        settings_available: state.controlled,
        models: [
          {
            model: session.model,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium" },
              { reasoningEffort: "high" },
            ],
          },
        ],
        goal: null,
      };
    } else if (path.endsWith("/models")) {
      state.models++;
      data = { data: [] };
    } else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (path.endsWith("/messages")) {
      state.messages++;
      data = {};
    } else if (path.endsWith("/events/poll")) {
      const after = Number(url.searchParams.get("after") || 0);
      state.controlPolls.push(after);
      data = {
        events: state.settingsEvents
          .filter((event) => event.seq > after)
          .map((event) => ({
            seq: event.seq,
            session_id: session.id,
            method: "thread/settings/updated",
            params: {
              threadId: session.thread_id,
              threadSettings: {
                model: session.model,
                reasoningEffort: event.effort,
              },
            },
            created_at: 2,
          })),
      };
    } else if (path.endsWith("/image")) {
      state.images++;
      expect(route.request().headers().authorization).toBe(
        "Bearer isolated-history-token",
      );
      await route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7l8AAAAASUVORK5CYII=",
          "base64",
        ),
      });
      return;
    } else if (path === `/sessions/${session.id}`)
      data = { session: { ...session, status: state.status } };
    else throw new Error(`Unexpected isolated session request: ${path}`);
    await route.fulfill({ json: data });
  });
  await page.goto(`/#${session.id}`);
  await expect(page.locator(".message.assistant .markdown")).toContainText(
    "已保存的回答 0",
  );
  await expect(
    page.getByText("已加载会话历史。独立进程暂不可控制。", { exact: true }),
  ).toBeVisible();
  return state;
}

test("unavailable owner keeps the draft and retries connection without posting an undeliverable message", async ({
  page,
}) => {
  const state = await fixture(page);
  const editor = page.getByLabel("消息", { exact: true });
  await fillPromptText(editor, "等待原入口连接的草稿");
  await page.getByTitle("发送", { exact: true }).click();
  await expect.poll(() => state.connects).toBeGreaterThan(1);
  await expectPromptText(editor, "等待原入口连接的草稿");
  expect(state.messages).toBe(0);
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重试连接", exact: true }),
  ).toBeVisible();
});

test("reasoning controls refresh after an owner becomes available without reloading the page", async ({
  page,
}) => {
  const state = await fixture(page);
  const picker = page.getByRole("button", {
    name: "模型与思考强度",
    exact: true,
  });
  await expect(picker.locator(".model-picker-effort")).toHaveText("中");
  await picker.click();
  await expect(
    page.getByRole("slider", { name: "选择推理强度" }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  state.ready = true;
  await page.getByRole("button", { name: "重试连接", exact: true }).click();
  await expect(picker.locator(".model-picker-effort")).toHaveText("高");
  await expect(
    page.getByRole("button", { name: "重试连接", exact: true }),
  ).toHaveCount(0);
  await picker.click();
  const slider = page.getByRole("slider", { name: "选择推理强度" });
  await expect(slider).toHaveAttribute("aria-disabled", "false");
  await slider.focus();
  await page.keyboard.press("Home");
  await expect.poll(() => state.effort).toBe("medium");
});

test("independent session history loads without model attach errors or repeated connection attempts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await fixture(page);
  await fillPromptText(page.getByLabel("消息", { exact: true }), "保留草稿");
  state.version = 1;
  await page.clock.fastForward(6000);
  await expect(page.locator(".message.assistant .markdown")).toContainText(
    "已保存的回答 1",
  );
  await expectPromptText(page.getByLabel("消息", { exact: true }), "保留草稿");
  expect(state.models).toBe(0);
  expect(state.connects).toBe(1);
  expect(errors).toEqual([]);
});

test("Markdown image viewer survives draft input, polling and changed saved message content", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "查看图片", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "图片查看器", exact: true });
  await expect(viewer.locator("img")).toBeVisible();
  const source = await viewer.locator("img").getAttribute("src");
  await viewer.getByRole("button", { name: "放大图片", exact: true }).click();
  state.version = 1;
  await page.clock.fastForward(6000);
  await expect(page.locator(".message.assistant .markdown")).toContainText(
    "已保存的回答 1",
  );
  await expect(viewer).toBeVisible();
  await expect(viewer.getByLabel("图片缩放比例")).toHaveText("125%");
  await expect(viewer.locator("img")).toHaveAttribute("src", source!);
  expect(state.images).toBe(1);
  await viewer
    .getByRole("button", { name: "关闭图片查看器", exact: true })
    .click();
  await expect(viewer).toHaveCount(0);
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "继续编辑草稿",
  );
  await page.getByRole("button", { name: "查看图片", exact: true }).click();
  await expect(viewer.locator("img")).toHaveAttribute("src", source!);
  expect(state.images).toBe(1);
});

test("catalog polling switches to desktop snapshots without duplicate users and retains loaded earlier pages", async ({
  page,
}) => {
  const state = await fixture(page, true),
    older = page.getByRole("button", { name: "加载更早消息", exact: true }),
    uniqueUser = page
      .locator(".message.user")
      .filter({ hasText: "同一个回合的唯一用户提问" }),
    earlierUser = page
      .locator(".message.user")
      .filter({ hasText: "已经加载的较早提问" });
  await older.click();
  await expect(earlierUser).toHaveCount(1);
  await expect(
    page
      .locator(".message.assistant .markdown")
      .filter({ hasText: "已加载较早页的回答" }),
  ).toHaveCount(1);
  expect(state.historyRequests.filter((request) => request.cursor)).toEqual([
    { source: "catalog", cursor: "catalog-before:turn" },
  ]);
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "快照更新时保留草稿",
  );
  state.source = "desktop";
  state.version = 1;
  await page.clock.fastForward(6000);
  await expect(
    page
      .locator(".message.assistant .markdown")
      .filter({ hasText: "桌面实时回答 1" }),
  ).toHaveCount(1);
  await expect(uniqueUser).toHaveCount(1);
  await expect(earlierUser).toHaveCount(1);
  await expect(
    page
      .locator(".message.assistant .markdown")
      .filter({ hasText: "已保存的回答 0" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: state.historyNotice }),
  ).toBeVisible();
  await expectPromptText(
    page.getByLabel("消息", { exact: true }),
    "快照更新时保留草稿",
  );
  state.version = 2;
  await page.clock.fastForward(6000);
  await expect(
    page
      .locator(".message.assistant .markdown")
      .filter({ hasText: "桌面实时回答 2" }),
  ).toHaveCount(1);
  await expect(
    page
      .locator(".message.assistant .markdown")
      .filter({ hasText: "桌面实时回答 1" }),
  ).toHaveCount(0);
  await expect(uniqueUser).toHaveCount(1);
  await expect(earlierUser).toHaveCount(1);
  await older.click();
  await expect(
    page.getByText("桌面游标取得的更早回答", { exact: true }),
  ).toBeVisible();
  expect(state.historyRequests.filter((request) => request.cursor)).toEqual([
    { source: "catalog", cursor: "catalog-before:turn" },
    { source: "desktop", cursor: "desktop-before:turn" },
  ]);
  await expect(earlierUser).toHaveCount(1);
  await expect(older).toHaveCount(0);
  state.version = 3;
  await page.clock.fastForward(6000);
  await expect(
    page
      .locator(".message.assistant .markdown")
      .filter({ hasText: "桌面实时回答 3" }),
  ).toHaveCount(1);
  await expect(
    page.getByText("桌面游标取得的更早回答", { exact: true }),
  ).toBeAttached();
  await expect(earlierUser).toHaveCount(1);
  await expect(uniqueUser).toHaveCount(1);
  await expect(older).toHaveCount(0);
});

test("desktop history notices refresh and clear independently of the unavailable-control notice", async ({
  page,
}) => {
  const state = await fixture(page, true),
    ownerNotice = page.getByText("已加载会话历史。独立进程暂不可控制。", {
      exact: true,
    });
  state.source = "desktop";
  await page.clock.fastForward(6000);
  await expect(
    page.getByRole("status").filter({ hasText: state.historyNotice }),
  ).toBeVisible();
  await expect(ownerNotice).toBeVisible();
  const firstNotice = state.historyNotice;
  state.historyNotice =
    "当前显示桌面已加载的会话内容，较早历史暂时无法读取：隔离测试读取失败";
  await page.clock.fastForward(6000);
  await expect(page.getByText(firstNotice, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: state.historyNotice }),
  ).toBeVisible();
  const retryNotice = state.historyNotice;
  state.historyNotice = "";
  await page.clock.fastForward(6000);
  await expect(page.getByText(retryNotice, { exact: true })).toHaveCount(0);
  await expect(ownerNotice).toBeVisible();
  await expect(
    page
      .locator(".message.user")
      .filter({ hasText: "同一个回合的唯一用户提问" }),
  ).toHaveCount(1);
  expect(state.messages).toBe(0);
  expect(state.models).toBe(0);
  expect(state.connects).toBe(1);
});

test("desktop settings notifications update the open reasoning menu while the turn stays busy", async ({
  page,
}) => {
  const state = await fixture(page);
  state.ready = true;
  state.status = "running";
  await page.getByRole("button", { name: "重试连接", exact: true }).click();
  await expect(page.getByTitle("中断", { exact: true })).toBeVisible();
  const picker = page.getByRole("button", {
      name: "模型与思考强度",
      exact: true,
    }),
    menu = page.getByRole("menu", { name: "模型与思考强度", exact: true });
  await expect(picker.locator(".model-picker-effort")).toHaveText("高");
  await picker.click();
  const slider = menu.getByRole("slider", {
    name: "选择推理强度",
    exact: true,
  });
  await expect(slider).toHaveAttribute("aria-valuetext", "高");
  await expect(slider).toHaveAttribute("aria-disabled", "false");
  await expect(menu).toContainText("当前任务完成后可更改模型。");
  await expect(menu).toHaveAttribute("aria-busy", "false");
  const pollsBefore = state.controlPolls.length;
  // Keep the same running turn and open menu. Only the native event revision
  // should refresh ModelPicker; no busy transition or menu reopening occurs.
  state.effort = "medium";
  state.settingsEvents.push({ seq: 1, effort: "medium" });
  await page.clock.fastForward(6000);
  await expect
    .poll(() => state.controlPolls.length)
    .toBeGreaterThan(pollsBefore);
  await expect(menu).toBeVisible();
  await expect(slider).toHaveAttribute("aria-valuetext", "中");
  await expect(picker.locator(".model-picker-effort")).toHaveText("中");
  await expect(slider).toHaveAttribute("aria-disabled", "false");
  await expect(page.getByTitle("中断", { exact: true })).toBeVisible();
  expect(state.status).toBe("running");
  expect(state.composerWrites).toBe(0);
  expect(state.messages).toBe(0);
  expect(state.connects).toBe(2);
});

test("sidebar execution rings follow confirmed running and starting states and stop for waiting or unknown sessions", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  state.sidebarSessions = [
    { id: "sidebar-running", title: "执行中的会话", status: "running" },
    { id: "sidebar-starting", title: "正在启动的会话", status: "starting" },
    { id: "sidebar-waiting", title: "等待审批的会话", status: "waiting" },
    { id: "sidebar-idle", title: "空闲会话", status: "idle" },
    { id: "sidebar-external", title: "状态未知的会话", status: "external" },
  ];
  await page.clock.fastForward(3000);
  if (testInfo.project.name === "android-web")
    await page.getByRole("button", { name: "会话列表", exact: true }).click();
  const navigation = page.getByRole("navigation", {
    name: "工作目录与会话",
    exact: true,
  });
  const expand = navigation.getByRole("button", { name: /^展开显示/ });
  await expect(expand).toBeVisible();
  await expand.click();
  const row = (title: string) =>
      navigation.getByRole("button", { name: title, exact: true }),
    running = row("执行中的会话"),
    starting = row("正在启动的会话"),
    waiting = row("等待审批的会话");
  await expect(
    running.getByRole("img", { name: "正在执行", exact: true }),
  ).toBeVisible();
  await expect(
    starting.getByRole("img", { name: "正在启动", exact: true }),
  ).toBeVisible();
  await expect(
    waiting.getByRole("img", { name: "等待回应", exact: true }),
  ).toBeVisible();
  await expect(waiting).toContainText("回应");
  await expect(navigation.locator(".session-execution-indicator")).toHaveCount(
    2,
  );
  for (const title of [
    "等待审批的会话",
    "空闲会话",
    "状态未知的会话",
    "独立进程历史",
  ])
    await expect(
      row(title).locator(".session-execution-indicator"),
    ).toHaveCount(0);
  const animation = await running
    .locator(".session-execution-indicator")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        name: style.animationName,
        iterations: style.animationIterationCount,
        width: Number.parseFloat(style.width),
      };
    });
  expect(animation).toEqual({
    name: "session-execution-rotate",
    iterations: "infinite",
    width: 12,
  });
  await expect(running.locator("time")).toHaveCount(0);
  await expect(row("空闲会话").locator("time")).toBeVisible();
  await page.screenshot({
    path: `artifacts/anywork-sidebar-execution-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel("会话显示选项", { exact: true }).click();
  await page.getByRole("button", { name: "按状态", exact: true }).click();
  const executingGroup = navigation.locator('[data-group="running"]');
  await expect(executingGroup.locator(".status-group-heading b")).toHaveText(
    "2",
  );
  await expect(
    navigation.locator('[data-group="waiting"] .status-group-heading b'),
  ).toHaveText("1");
  await expect(
    navigation.locator('[data-group="recent"] .status-group-heading b'),
  ).toHaveText("1");
  await expect(
    navigation.locator('[data-group="unknown"] .status-group-heading b'),
  ).toHaveText("2");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    running.getByRole("img", { name: "正在执行", exact: true }),
  ).toBeVisible();
  expect(
    await running
      .locator(".session-execution-indicator")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  state.sidebarSessions[0].status = "idle";
  state.sidebarSessions[1].status = "waiting";
  await page.clock.fastForward(3000);
  await expect(navigation.locator(".session-execution-indicator")).toHaveCount(
    0,
  );
  await expect(executingGroup).toHaveCount(0);
  await expect(
    navigation.locator('[data-group="waiting"] .status-group-heading b'),
  ).toHaveText("2");
  await expect(
    navigation.locator('[data-group="recent"] .status-group-heading b'),
  ).toHaveText("2");
  await expect(
    starting.getByRole("img", { name: "等待回应", exact: true }),
  ).toBeVisible();
  // An unopened external conversation can become active on the desktop.
  // Sidebar polling updates the ring without selecting the chat; active chats
  // now also join the persistent background connection cache.
  state.sidebarSessions[4].status = "running";
  await page.clock.fastForward(3000);
  await expect(
    row("状态未知的会话").getByRole("img", { name: "正在执行", exact: true }),
  ).toBeVisible();
  await expect(executingGroup.locator(".status-group-heading b")).toHaveText(
    "1",
  );
  expect(state.messages).toBe(0);
  expect(state.connectedSessions.sort()).toEqual(
    [
      "codex-independent",
      "sidebar-running",
      "sidebar-starting",
      "sidebar-waiting",
      "sidebar-external",
    ].sort(),
  );
});
