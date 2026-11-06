import { expect, test, type Page } from "@playwright/test";
import type { AgentEvent } from "../web/src/types";
import {
  expectPromptText,
  fillPromptText,
  pastePromptText,
} from "./prompt-editor-helpers";

type EditPost = {
  session: string;
  body: {
    message_id: string;
    text: string;
    expected_fingerprint: string;
    operation_id: string;
    retry?: boolean;
  };
};
type Operation = EditPost["body"] & {
  id: string;
  phase: string;
  error?: string;
  retryable?: boolean;
};

function history(
  session: string,
  latest = "最新问题",
  attachments: string[] = [],
) {
  const event = (
    seq: number,
    turn: string,
    method: string,
    params: Record<string, unknown>,
  ): AgentEvent => ({
    session_id: session,
    seq,
    method,
    created_at: 1,
    params: {
      history_turn_id: turn,
      history_turn_status: "completed",
      ...params,
    },
  });
  return [
    event(1, `${session}-old`, "user/message", { text: "更早的问题" }),
    event(2, `${session}-old`, "item/completed", {
      item: {
        id: `${session}-answer-old`,
        type: "agentMessage",
        phase: "final_answer",
        text: "更早的回答",
      },
    }),
    event(11, `${session}-latest`, "user/message", {
      text: latest,
      attachments,
    }),
    event(12, `${session}-latest`, "item/completed", {
      item: {
        id: `${session}-answer-latest`,
        type: "agentMessage",
        phase: "final_answer",
        text: "最新回答",
      },
    }),
  ];
}

async function fixture(
  page: Page,
  options: {
    enabled?: boolean;
    editable?: boolean;
    attachments?: string[];
  } = {},
) {
  const state = {
    enabled: options.enabled !== false,
    editable: options.editable !== false,
    posts: [] as EditPost[],
    cancellations: [] as { session: string; operationId: string }[],
    queries: [] as { session: string; messageId: string | null }[],
    histories: {
      "edit-a": history("edit-a", "最新问题", options.attachments),
      "edit-b": history("edit-b", "另一会话的问题"),
    } as Record<string, AgentEvent[]>,
    operations: {} as Record<string, Operation | null>,
    pollEvents: [] as AgentEvent[],
    historyReads: {} as Record<string, number>,
    failAfterRevert: false,
    responseText: undefined as string | undefined,
    hold: false,
    release: undefined as (() => void) | undefined,
  };
  const sessions = ["edit-a", "edit-b"].map((id) => ({
    id,
    title: id === "edit-a" ? "编辑会话" : "另一会话",
    thread_id: id,
    cwd: "/work/project",
    agent: "fixture",
    model: null,
    policy: "manual",
    status: "idle",
    archived: false,
    created_at: 1,
    updated_at: 1,
  }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.slice(4),
      id = path.split("/")[2];
    let data: unknown = {};
    if (path === "/info")
      data = { workspace: "/work/project", hostname: "edit-fixture" };
    else if (path === "/plugins")
      data = {
        plugins: [
          {
            id: "fixture",
            name: "Fixture",
            capabilities: state.enabled ? ["message-edit"] : [],
          },
        ],
      };
    else if (path === "/sessions") data = { sessions };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (
      /\/edit\/[^/]+$/u.test(path) &&
      route.request().method() === "DELETE"
    ) {
      state.cancellations.push({
        session: id,
        operationId: path.split("/").at(-1)!,
      });
      state.operations[id] = null;
      data = { ok: true };
    } else if (path.endsWith("/edit")) {
      if (route.request().method() === "GET") {
        const messageId = url.searchParams.get("message_id");
        state.queries.push({ session: id, messageId });
        if (messageId === null)
          data = { operation: state.operations[id] || null };
        else {
          const source = state.histories[id].find(
            (event) =>
              event.method === "user/message" &&
              `user-${event.seq}` === messageId,
          );
          data = {
            editable: state.editable && messageId === "user-11" && !!source,
            message_id: messageId,
            turn_id: `${id}-latest`,
            user_item_id: `${id}-user-item`,
            text: source?.params.text || "",
            input_types: state.histories[id].some(
              (event) => event.params.attachments?.length,
            )
              ? ["text", "image"]
              : ["text"],
            fingerprint: `fingerprint-${id}`,
            limitations: [],
          };
        }
      } else {
        const body = route.request().postDataJSON() as EditPost["body"];
        state.posts.push({ session: id, body });
        if (state.hold)
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
        const failed = state.failAfterRevert && !body.retry;
        const operation: Operation = {
          ...body,
          text: state.responseText ?? body.text,
          id: body.operation_id,
          phase: failed ? "failed" : "completed",
          ...(failed
            ? { error: "回退已完成，重新发送失败，请重试。", retryable: true }
            : {}),
        };
        state.operations[id] = operation;
        const previous = state.histories[id].filter((event) => event.seq < 11);
        state.histories[id] = failed
          ? previous
          : [
              ...previous,
              {
                session_id: id,
                seq: 201,
                method: "user/message",
                params: {
                  text: operation.text,
                  history_turn_id: `${id}-replacement`,
                  history_turn_status: "completed",
                },
                created_at: 2,
              },
            ];
        state.pollEvents.push({
          session_id: id,
          seq: state.pollEvents.length + 1001,
          method: "history/reset",
          params: {},
          created_at: 2,
        });
        data = {
          operation,
          history_changed: true,
          ...(failed ? {} : { turn_id: `${id}-replacement` }),
        };
      }
    } else if (path.endsWith("/history")) {
      state.historyReads[id] = (state.historyReads[id] || 0) + 1;
      data = {
        events: state.histories[id],
        next_cursor: null,
        latest_seq: Math.max(
          0,
          ...state.histories[id].map((event) => event.seq),
          ...state.pollEvents
            .filter((event) => event.session_id === id)
            .map((event) => event.seq),
        ),
      };
    } else if (path.endsWith("/events/poll"))
      data = {
        events: state.pollEvents.filter(
          (event) =>
            event.session_id === id &&
            event.seq > Number(url.searchParams.get("after") || 0),
        ),
      };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (
      path.endsWith("/image") ||
      path.endsWith("/files") ||
      path.endsWith("/document")
    ) {
      await route.fulfill({
        status: 404,
        json: { error: "附件预览不加载远程内容" },
      });
      return;
    } else if (/^\/sessions\/[^/]+$/u.test(path))
      data = { session: sessions.find((session) => session.id === id) };
    else
      throw new Error(
        `Unmocked edit fixture request: ${route.request().method()} ${path}`,
      );
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({
        url: "https://user-edit-fixture.trycloudflare.com",
        token: "user-edit-fixture",
      }),
    );
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  await page.goto(`${process.env.USER_MESSAGE_TEST_URL || ""}/#edit-a`);
  await expect(
    page.locator('.message.user[data-message-id="user-11"]'),
  ).toBeVisible();
  return state;
}

const latest = (page: Page) =>
  page.locator('.message.user[data-message-id="user-11"]');
const editor = (page: Page) => page.locator(".user-message-editor");
const editInput = (page: Page) =>
  editor(page).getByRole("textbox", { name: "编辑消息", exact: true });

test("editing is offered only for the latest actual editable target and requires the plugin capability", async ({
  page,
}) => {
  const state = await fixture(page);
  await expect(
    latest(page).getByRole("button", { name: "编辑消息", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('.message.user[data-message-id="user-1"]')
      .getByRole("button", { name: "编辑消息", exact: true }),
  ).toHaveCount(0);
  expect(state.queries.filter((query) => query.messageId !== null)).toEqual([
    { session: "edit-a", messageId: "user-11" },
  ]);
  state.enabled = false;
  await page.reload();
  await expect(latest(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "编辑消息", exact: true }),
  ).toHaveCount(0);
  state.enabled = true;
  state.editable = false;
  await page.reload();
  await expect.poll(() => state.queries.length).toBeGreaterThan(2);
  await expect(
    page.getByRole("button", { name: "编辑消息", exact: true }),
  ).toHaveCount(0);
  expect(state.posts).toEqual([]);
});

test("cancel and guarded Escape preserve the main composer draft and do not submit an edit", async ({
  page,
}, info) => {
  const state = await fixture(page);
  const composer = page.getByLabel("消息", { exact: true });
  await fillPromptText(composer, "主输入框草稿\n保留到编辑结束");
  const pencil = latest(page).getByRole("button", {
    name: "编辑消息",
    exact: true,
  });
  await pencil.click();
  await expect(editInput(page)).toBeFocused();
  await expectPromptText(editInput(page), "最新问题");
  await expect(latest(page).locator(".user-message-footer")).toHaveCount(0);
  await fillPromptText(editInput(page), "尚未发送的编辑草稿");
  await page.screenshot({
    path: `artifacts/anywork-message-editor-${info.project.name}.png`,
  });
  await editInput(page).evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
  });
  await expect(editor(page)).toBeVisible();
  await editInput(page).evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor(page)).toBeVisible();
  await page.waitForTimeout(120);
  await editInput(page).press("Shift+Escape");
  await expect(editor(page)).toBeVisible();
  await editInput(page).press("Escape");
  await expect(editor(page)).toHaveCount(0);
  await expect(pencil).toBeFocused();
  await pencil.click();
  await expectPromptText(editInput(page), "最新问题");
  await editor(page).getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expectPromptText(composer, "主输入框草稿\n保留到编辑结束");
  expect(state.posts).toEqual([]);
});

test("the edit request trims outer whitespace and disables blank submission and duplicate requests", async ({
  page,
}) => {
  const state = await fixture(page);
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "不受编辑影响的主草稿",
  );
  await latest(page)
    .getByRole("button", { name: "编辑消息", exact: true })
    .click();
  await fillPromptText(editInput(page), " \n\t ");
  await expect(
    editor(page).getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  const raw = "  const value = 1;\n\n尾部也保留  \n";
  await fillPromptText(editInput(page), raw);
  state.hold = true;
  await editor(page).getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  await expect(editInput(page)).not.toBeEditable();
  await expect(editInput(page)).toHaveAttribute("aria-disabled", "true");
  await expect(
    editor(page).getByRole("button", { name: "取消", exact: true }),
  ).toBeDisabled();
  await expect(
    editor(page).getByRole("button", { name: "核对发送结果", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toMatchObject({
    session: "edit-a",
    body: {
      message_id: "user-11",
      text: raw.trim(),
      expected_fingerprint: "fingerprint-edit-a",
      retry: false,
    },
  });
  expect(state.posts[0].body.operation_id).toBeTruthy();
  state.release!();
  await expect(editor(page)).toHaveCount(0);
  await expect(
    page.locator('.message.user[data-message-id="user-201"]'),
  ).toContainText("const value = 1;");
  await expectPromptText(
    page.getByLabel("消息", { exact: true }),
    "不受编辑影响的主草稿",
  );
});

test("a revert followed by start failure retains the detached draft and retries the same operation", async ({
  page,
}) => {
  const state = await fixture(page);
  state.failAfterRevert = true;
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "主草稿跨回退保留",
  );
  await latest(page)
    .getByRole("button", { name: "编辑消息", exact: true })
    .click();
  const draft = "  回退后继续编辑的草稿\n";
  await fillPromptText(editInput(page), draft);
  await editor(page).getByRole("button", { name: "发送", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toContainText("无法编辑消息");
  await expect(editor(page).getByRole("alert")).toContainText("回退已完成");
  await expect.poll(() => state.historyReads["edit-a"]).toBeGreaterThan(1);
  expect(state.histories["edit-a"].some((event) => event.seq === 11)).toBe(
    false,
  );
  await expectPromptText(editInput(page), draft.trim());
  await expect(editInput(page)).toBeEnabled();
  const first = state.posts[0];
  await fillPromptText(editInput(page), draft + "补充重试内容");
  await editor(page).getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => state.posts.length).toBe(2);
  expect(state.posts[1]).toMatchObject({
    session: "edit-a",
    body: {
      message_id: first.body.message_id,
      operation_id: first.body.operation_id,
      expected_fingerprint: first.body.expected_fingerprint,
      retry: true,
      text: (draft + "补充重试内容").trim(),
    },
  });
  await expect(editor(page)).toHaveCount(0);
  await expect(
    page.locator('.message.user[data-message-id="user-201"]'),
  ).toContainText("补充重试内容");
  await expectPromptText(
    page.getByLabel("消息", { exact: true }),
    "主草稿跨回退保留",
  );
});

test("a delayed failure from another session cannot close or overwrite the current editor", async ({
  page,
}) => {
  const state = await fixture(page);
  state.hold = true;
  state.failAfterRevert = true;
  await latest(page)
    .getByRole("button", { name: "编辑消息", exact: true })
    .click();
  await fillPromptText(editInput(page), "A会话提交中的草稿");
  await editor(page).getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  await page.evaluate(() => {
    location.hash = "edit-b";
  });
  await expect(latest(page)).toContainText("另一会话的问题");
  await latest(page)
    .getByRole("button", { name: "编辑消息", exact: true })
    .click();
  await fillPromptText(editInput(page), "B会话尚未发送的草稿");
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith("/edit-a/edit") &&
      response.request().method() === "POST",
  );
  state.release!();
  await response;
  await expectPromptText(editInput(page), "B会话尚未发送的草稿");
  await expect(editInput(page)).toBeEnabled();
  await expect(editor(page).getByRole("alert")).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
});

test("read-only original attachments are retained and allow an empty text edit", async ({
  page,
}) => {
  const state = await fixture(page, {
    attachments: ["/work/project/original.md", "/work/project/original.png"],
  });
  await latest(page)
    .getByRole("button", { name: "编辑消息", exact: true })
    .click();
  await expect(
    editor(page).getByLabel("原有附件", { exact: true }),
  ).toContainText("原有附件将保留");
  await expect(editor(page).locator(".user-message-editor-file")).toHaveText(
    "original.md",
  );
  await expect(editor(page).locator('input[type="file"]')).toHaveCount(0);
  await fillPromptText(editInput(page), "");
  await expect(
    editor(page).getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled();
  await editor(page).getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0].body.text).toBe("");
  expect(state.posts[0].body).not.toHaveProperty("attachments");
});

test("native thread reversion refreshes the actual displayed history", async ({
  page,
}) => {
  const state = await fixture(page);
  await expect(
    latest(page).getByRole("button", { name: "编辑消息", exact: true }),
  ).toBeVisible();
  const reads = state.historyReads["edit-a"];
  state.histories["edit-a"] = state.histories["edit-a"].filter(
    (event) => event.seq < 11,
  );
  state.pollEvents.push({
    session_id: "edit-a",
    seq: 1001,
    method: "thread/reverted",
    params: { threadId: "edit-a" },
    created_at: 2,
  });
  await expect.poll(() => state.historyReads["edit-a"]).toBeGreaterThan(reads);
  await expect(latest(page)).toHaveCount(0);
  await expect(
    page.locator('.message.user[data-message-id="user-1"]'),
  ).toContainText("更早的问题");
  expect(state.posts).toEqual([]);
});

test("a saved failed operation restores its draft after reload and cancellation clears that operation", async ({
  page,
}) => {
  const state = await fixture(page);
  state.failAfterRevert = true;
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "跨刷新保留主草稿",
  );
  await latest(page)
    .getByRole("button", { name: "编辑消息", exact: true })
    .click();
  const draft = "已回退但未重新发送的编辑内容";
  await fillPromptText(editInput(page), draft);
  await editor(page).getByRole("button", { name: "发送", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toContainText("回退已完成");
  await expect.poll(() => state.historyReads["edit-a"]).toBeGreaterThan(1);
  const operationId = state.posts[0].body.operation_id;
  await page.reload();
  await expectPromptText(editInput(page), draft);
  await expect(editor(page).getByRole("alert")).toContainText("回退已完成");
  await expectPromptText(
    page.getByLabel("消息", { exact: true }),
    "跨刷新保留主草稿",
  );
  await editor(page).getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(state.cancellations).toEqual([{ session: "edit-a", operationId }]);
  expect(state.operations["edit-a"]).toBeNull();
  expect(state.posts).toHaveLength(1);
});

for (const phase of ["uncertain", "starting", "reverting"]) {
  test(`a restored ${phase} operation keeps its original text read-only and checks the same operation`, async ({
    page,
  }) => {
    const state = await fixture(page);
    const draft = "  需要核对发送结果的原稿\n";
    const operationId = `saved-${phase}-operation`;
    state.operations["edit-a"] = {
      id: operationId,
      operation_id: operationId,
      phase,
      message_id: "user-11",
      text: draft,
      expected_fingerprint: "saved-fingerprint",
      error: "发送结果尚未确认，请核对。",
      retryable: true,
    };
    await fillPromptText(
      page.getByLabel("消息", { exact: true }),
      "核对期间保留主草稿",
    );
    await page.reload();
    await expectPromptText(editInput(page), draft);
    await expect(editInput(page)).not.toBeEditable();
    await expect(editInput(page)).toBeEnabled();
    await expect(
      editor(page).getByRole("button", { name: "取消", exact: true }),
    ).toBeEnabled();
    const check = editor(page).getByRole("button", {
      name: "核对发送结果",
      exact: true,
    });
    await expect(check).toBeEnabled();
    await editInput(page).press("End");
    await editInput(page).pressSequentially("cannot replace pending text");
    await pastePromptText(editInput(page), "cannot paste over pending text");
    await expectPromptText(editInput(page), draft);
    await check.click();
    await expect.poll(() => state.posts.length).toBe(1);
    expect(state.posts[0]).toEqual({
      session: "edit-a",
      body: {
        message_id: "user-11",
        text: draft,
        expected_fingerprint: "saved-fingerprint",
        operation_id: operationId,
        retry: true,
      },
    });
    await expect(editor(page)).toHaveCount(0);
    await expect(
      page.locator('.message.user[data-message-id="user-201"]'),
    ).toContainText("需要核对发送结果的原稿");
    await expectPromptText(
      page.getByLabel("消息", { exact: true }),
      "核对期间保留主草稿",
    );
  });
}

test("a completed response with different saved text preserves the submitted draft and explains the mismatch", async ({
  page,
}) => {
  const state = await fixture(page);
  state.responseText = "服务器先前保存的内容";
  await latest(page)
    .getByRole("button", { name: "编辑消息", exact: true })
    .click();
  const draft = "  不能被旧结果清除的新稿\n";
  await fillPromptText(editInput(page), draft);
  await editor(page).getByRole("button", { name: "发送", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toContainText("已保留草稿");
  await expectPromptText(editInput(page), draft.trim());
  await expect(editInput(page)).toBeEditable();
  await expect(
    page.locator('.message.user[data-message-id="user-201"]'),
  ).toContainText("服务器先前保存的内容");
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0].body.text).toBe(draft.trim());
});
