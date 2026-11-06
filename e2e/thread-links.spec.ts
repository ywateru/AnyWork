import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { Session } from "../web/src/types";
import {
  expectPromptText,
  fillPromptText,
  pastePromptText,
} from "./prompt-editor-helpers";

const sourceId = "source-session";
const targetId = "target-session";
const threadId = "019b1234-1234-7123-8123-123456789abc";
const href = `codex://threads/${threadId}?hostId=local`;
const atom = (url = href) =>
  `<span rich-link-display-text="目标会话" rich-link-href="${url}" rich-link-source-app-id="">目标会话</span>`;

async function fixture(
  context: BrowserContext,
  page: Page,
  initial = sourceId,
  messages = { user: "原来的历史消息", assistant: "历史回答" },
) {
  const make = (id: string, thread: string, title: string): Session => ({
    id,
    thread_id: thread,
    title,
    cwd: "/workspace",
    agent: "codex",
    model: null,
    policy: "manual",
    status: "idle",
    archived: false,
    created_at: 1,
    updated_at: 1,
  });
  const source = make(
    sourceId,
    "019b1234-1234-7123-8123-123456789aaa",
    "原会话",
  );
  const target = make(targetId, threadId, "目标会话");
  const state = {
    listed: [source, target],
    posts: [] as string[],
    listRequests: 0,
    hold: null as Promise<void> | null,
  };
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.slice(4);
    if (route.request().method() !== "GET") state.posts.push(path);
    let data: unknown = {};
    if (path === "/info")
      data = { workspace: source.cwd, hostname: "thread-link-fixture" };
    else if (path === "/plugins")
      data = {
        plugins: [
          { id: "codex", name: "Codex", capabilities: ["message-edit"] },
        ],
      };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path === "/sessions") {
      state.listRequests++;
      if (state.hold) await state.hold;
      data = { sessions: state.listed };
    } else if (path.endsWith("/history"))
      data = {
        events: path.includes(sourceId)
          ? [
              {
                session_id: sourceId,
                seq: 1,
                method: "user/message",
                created_at: 1,
                params: {
                  text: messages.user,
                  history_turn_id: "turn",
                  history_turn_status: "completed",
                },
              },
              {
                session_id: sourceId,
                seq: 2,
                method: "item/completed",
                created_at: 1,
                params: {
                  history_turn_id: "turn",
                  history_turn_status: "completed",
                  item: {
                    id: "answer",
                    type: "agentMessage",
                    phase: "final_answer",
                    text: messages.assistant,
                  },
                },
              },
            ]
          : [],
        next_cursor: null,
        latest_seq: 2,
      };
    else if (path.endsWith("/events/poll")) data = { events: [] };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/review"))
      data = {
        type: "success",
        source: url.searchParams.get("source"),
        diff: "",
        root: "/workspace",
        branches: [],
      };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (path.endsWith("/edit"))
      data = url.searchParams.has("message_id")
        ? {
            editable: true,
            message_id: "user-1",
            turn_id: "turn",
            user_item_id: "user-item",
            text: "原来的历史消息",
            input_types: ["text"],
            fingerprint: "fingerprint",
            limitations: [],
          }
        : { operation: null };
    else if (path === `/sessions/${sourceId}`) data = { session: source };
    else if (path === `/sessions/${targetId}`) data = { session: target };
    else throw new Error(`Unexpected thread-link request: ${path}`);
    await route.fulfill({ json: data });
  });
  await context.addInitScript(() => {
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({
        url: "https://thread-link-fixture.trycloudflare.com",
        token: "fixture-only",
      }),
    );
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  await page.goto(`/#${initial}`);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(input).toBeEditable();
  return { state, input, source, target };
}

async function insertLink(input: ReturnType<Page["getByRole"]>, url = href) {
  await input.focus();
  await pastePromptText(
    input,
    "before 目标会话 after",
    `<p>before ${atom(url)} after</p>`,
  );
  return input.locator("[rich-link-href]");
}

test("a native rich conversation link opens the exact local chat and preserves the original draft", async ({
  context,
  page,
}) => {
  const { input, state } = await fixture(context, page);
  const link = await insertLink(input);
  await expect(link).toHaveAttribute("role", "link");
  await expect(link).not.toHaveAttribute("aria-haspopup");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
  await expect(page.getByRole("dialog", { name: "链接选项" })).toHaveCount(0);
  await fillPromptText(input, "目标会话自己的草稿");
  await page.evaluate((id) => {
    location.hash = id;
  }, sourceId);
  await expectPromptText(input, "before 目标会话 after");
  await expect(input.locator("[rich-link-href]")).toHaveAttribute(
    "rich-link-href",
    href,
  );
  expect(state.posts).toEqual([]);
});

test("focused rich references navigate with Enter and Space without submitting", async ({
  context,
  page,
}) => {
  const { input, state } = await fixture(context, page);
  await insertLink(input);
  for (const key of ["Enter", "Space"]) {
    const link = input.locator("[rich-link-href]");
    await link.focus();
    await link.press(key);
    await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
    await page.evaluate((id) => {
      location.hash = id;
    }, sourceId);
    await expect(link).toBeVisible();
  }
  expect(state.posts).toEqual([]);
});

test("ordinary marked conversation URLs retain the edit popover instead of navigating", async ({
  context,
  page,
}) => {
  const { input, state } = await fixture(context, page);
  await input.focus();
  await pastePromptText(
    input,
    "普通文字",
    `<p><a href="${href}">普通文字</a></p>`,
  );
  const link = input.locator("[text-link-href]");
  await link.click();
  await expect(page.getByRole("dialog", { name: "链接选项" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#${sourceId}$`));
  await expect(
    page.getByRole("button", { name: "打开链接", exact: true }),
  ).toHaveCount(0);
  expect(state.posts).toEqual([]);
});

test("another device never resolves to a local conversation with the same id", async ({
  context,
  page,
}) => {
  const { input, state } = await fixture(context, page);
  const link = await insertLink(
    input,
    href.replace("hostId=local", "hostId=other-host"),
  );
  await link.click();
  await expect(
    page.getByText("此会话链接属于其他设备，请连接对应设备后打开。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#${sourceId}$`));
  await expectPromptText(input, "before 目标会话 after");
  expect(state.posts).toEqual([]);
});

test("missing and ambiguous references retain the draft without creating or sending anything", async ({
  context,
  page,
}) => {
  const { input, state, source, target } = await fixture(context, page);
  const unknown = href.replace(
    threadId,
    "019b1234-1234-7123-8123-123456789bbb",
  );
  await (await insertLink(input, unknown)).click();
  await expect(
    page.getByText("当前服务器的工作区内未找到此会话，原草稿已保留。", {
      exact: true,
    }),
  ).toBeVisible();
  state.listed = [source, target, { ...target, id: "duplicate" }];
  // Refresh the list without changing the source draft.
  await page.reload();
  await expect(input).toBeEditable();
  await fillPromptText(input, "");
  await (await insertLink(input)).click();
  await expect(
    page.getByText("当前服务器中有多个对应会话，无法确定要打开哪一个。", {
      exact: true,
    }),
  ).toBeVisible();
  await expectPromptText(input, "before 目标会话 after");
  await expect(page).toHaveURL(new RegExp(`#${sourceId}$`));
  expect(state.posts).toEqual([]);
});

test("a delayed index refresh resolves a newly discovered chat", async ({
  context,
  page,
}) => {
  const { input, state, source, target } = await fixture(context, page);
  state.listed = [source];
  await page.reload();
  await expect(input).toBeEditable();
  const link = await insertLink(input);
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = state.listRequests;
  await link.click();
  await expect.poll(() => state.listRequests).toBeGreaterThan(before);
  state.listed = [source, target];
  release();
  state.hold = null;
  await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
  expect(state.posts).toEqual([]);
});

test("changing the selected chat cancels an unresolved link without a late navigation", async ({
  context,
  page,
}) => {
  const { input, state } = await fixture(context, page);
  const unknown = href.replace(
    threadId,
    "019b1234-1234-7123-8123-123456789bbb",
  );
  const link = await insertLink(input, unknown);
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = state.listRequests;
  await link.click();
  await expect.poll(() => state.listRequests).toBeGreaterThan(before);
  await page.evaluate((id) => {
    location.hash = id;
  }, targetId);
  await expect(input).toBeEditable();
  await fillPromptText(input, "新的目标草稿");
  release();
  state.hold = null;
  await expectPromptText(input, "新的目标草稿");
  await expect(
    page.getByText("当前服务器的工作区内未找到此会话，原草稿已保留。", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
  expect(state.posts).toEqual([]);
});

for (const gesture of ["middle", "modifier"] as const)
  test(`${gesture} click opens an authenticated Web tab and leaves the original draft selected`, async ({
    context,
    page,
  }) => {
    const { input, state } = await fixture(context, page);
    const link = await insertLink(input);
    if (gesture === "middle") {
      for (const type of ["mousedown", "mouseup"]) {
        const prevented = await link.evaluate((element, eventType) => {
          const event = new MouseEvent(eventType, {
            button: 1,
            bubbles: true,
            cancelable: true,
          });
          element.dispatchEvent(event);
          return event.defaultPrevented;
        }, type);
        expect(prevented).toBe(true);
      }
    }
    const popup = page.waitForEvent("popup");
    await link.click(
      gesture === "middle"
        ? { button: "middle" }
        : { modifiers: ["ControlOrMeta"] },
    );
    const other = await popup;
    await expect(other).toHaveURL(new RegExp(`#${targetId}$`));
    await expect(
      other.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeEditable();
    expect(other.url()).not.toContain("token");
    await expect(page).toHaveURL(new RegExp(`#${sourceId}$`));
    await expectPromptText(input, "before 目标会话 after");
    expect(state.posts).toEqual([]);
    await other.close();
  });

test("resolving a Web conversation route replaces its history entry so Back returns to the original chat", async ({
  context,
  page,
}) => {
  const { input, state } = await fixture(context, page);
  await fillPromptText(input, "返回时保留的草稿");
  const before = await page.evaluate(() => history.length);
  await page.evaluate((id) => {
    location.hash = `codex-thread/${id}`;
  }, threadId);
  await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
  expect(await page.evaluate(() => history.length)).toBe(before + 1);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#${sourceId}$`));
  await expectPromptText(input, "返回时保留的草稿");
  expect(state.posts).toEqual([]);
});

test("a later foreign-device activation cancels the earlier unresolved navigation", async ({
  context,
  page,
}) => {
  const { input, state } = await fixture(context, page);
  const unknown = href.replace(
    threadId,
    "019b1234-1234-7123-8123-123456789bbb",
  );
  const link = await insertLink(input, unknown);
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = state.listRequests;
  await link.click();
  await expect.poll(() => state.listRequests).toBeGreaterThan(before);
  await fillPromptText(input, "");
  await (
    await insertLink(
      input,
      href.replace("hostId=local", "hostId=another-device"),
    )
  ).click();
  release();
  state.hold = null;
  await expect(
    page.getByText("此会话链接属于其他设备，请连接对应设备后打开。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("当前服务器的工作区内未找到此会话，原草稿已保留。", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#${sourceId}$`));
  await expectPromptText(input, "before 目标会话 after");
  expect(state.posts).toEqual([]);
});

test("a direct Web conversation route resolves the native id", async ({
  context,
  page,
}) => {
  const { input, state } = await fixture(
    context,
    page,
    `codex-thread/${threadId}`,
  );
  await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
  await expect(input).toBeEditable();
  expect(state.posts).toEqual([]);
});

test("a rich reference inside historical editing uses the same navigation and retains the main draft", async ({
  context,
  page,
}) => {
  const { input, state } = await fixture(context, page);
  await fillPromptText(input, "主输入框草稿");
  await page.getByRole("button", { name: "编辑消息", exact: true }).click();
  const editor = page
    .getByRole("form", { name: "编辑消息", exact: true })
    .getByRole("textbox", { name: "编辑消息", exact: true });
  await expect(editor).toBeEditable();
  await fillPromptText(editor, "");
  await (await insertLink(editor)).click();
  await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
  await page.evaluate((id) => {
    location.hash = id;
  }, sourceId);
  await expectPromptText(input, "主输入框草稿");
  expect(state.posts).toEqual([]);
});

for (const author of ["user", "assistant"] as const)
  test(`${author} body conversation links navigate with click and Enter while retaining the draft`, async ({
    context,
    page,
  }) => {
    const text = `[**目标会话**](${href} "原来的标题")`;
    const { input, state } = await fixture(context, page, sourceId, {
      user: text,
      assistant: text,
    });
    await fillPromptText(input, "正文跳转前的草稿");
    for (const gesture of ["click", "Enter"]) {
      const link = page
        .locator(`.message.${author}`)
        .getByRole("link", { name: "目标会话", exact: true });
      await expect(link).toHaveAttribute("href", href);
      await expect(link).toHaveAttribute("title", "原来的标题");
      await expect(link.locator("strong")).toHaveText("目标会话");
      if (gesture === "click") await link.click();
      else {
        await link.focus();
        await link.press("Enter");
      }
      await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`#${sourceId}$`));
      await expectPromptText(input, "正文跳转前的草稿");
    }
    expect(state.posts).toEqual([]);
  });

for (const gesture of ["middle", "modifier", "shift"] as const)
  test(`body ${gesture} click opens a Web tab without navigating the original conversation`, async ({
    context,
    page,
  }) => {
    const text = `[目标会话](${href})`;
    const { input, state } = await fixture(context, page, sourceId, {
      user: text,
      assistant: text,
    });
    await fillPromptText(input, "新标签前的草稿");
    const popup = page.waitForEvent("popup");
    await page
      .locator(".message.assistant")
      .getByRole("link", { name: "目标会话" })
      .click(
        gesture === "middle"
          ? { button: "middle" }
          : { modifiers: [gesture === "shift" ? "Shift" : "ControlOrMeta"] },
      );
    const other = await popup;
    await expect(other).toHaveURL(new RegExp(`#${targetId}$`));
    await expect(
      other.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeEditable();
    expect(other.url()).not.toContain("token");
    await expect(page).toHaveURL(new RegExp(`#${sourceId}$`));
    await expectPromptText(input, "新标签前的草稿");
    expect(state.posts).toEqual([]);
    await other.close();
  });

test("generic body URI syntax works while user codex-text wrapping remains user-only", async ({
  context,
  page,
}) => {
  const generic = `codex://threads///${threadId}//?extra=ignored#fragment`;
  const text = `[普通](${generic}) [包装](codex-text-link://${href})`;
  const { input, state } = await fixture(context, page, sourceId, {
    user: text,
    assistant: text,
  });
  await fillPromptText(input, "保留");
  const user = page.locator(".message.user");
  await expect(
    user.getByRole("link", { name: "包装", exact: true }),
  ).toHaveAttribute("href", href);
  await expect(
    page
      .locator(".message.assistant")
      .getByRole("link", { name: "包装", exact: true }),
  ).toHaveCount(0);
  await user.getByRole("link", { name: "普通", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
  await page.goBack();
  await expectPromptText(input, "保留");
  await user.getByRole("link", { name: "包装", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
  expect(state.posts).toEqual([]);
});

test("review body links open the target split view while foreign-host links preserve the draft", async ({
  context,
  page,
}) => {
  const review = `codex://threads/${threadId}?view=review&diffFilter=last-turn&path=src%2Ffile.ts`;
  const foreign = href.replace("hostId=local", "hostId=other");
  const text = `[审阅](${review}) [其他设备](${foreign})`;
  const { input, state } = await fixture(context, page, sourceId, {
    user: text,
    assistant: text,
  });
  await fillPromptText(input, "不能丢失的草稿");
  await page
    .locator(".message.assistant")
    .getByRole("link", { name: "审阅", exact: true })
    .click();
  await expect(page.locator(".review-panel")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "差异来源", exact: true }),
  ).toHaveText("最后一轮");
  await expect(page).toHaveURL(new RegExp(`#${targetId}\\?view=review`));
  await page.goBack();
  await expect(page.locator(".review-panel")).toHaveCount(0);
  const reads = state.listRequests;
  await page
    .locator(".message.user")
    .getByRole("link", { name: "其他设备", exact: true })
    .click();
  await expect(
    page.getByText("此会话链接属于其他设备，请连接对应设备后打开。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#${sourceId}$`));
  await expectPromptText(input, "不能丢失的草稿");
  expect(state.listRequests).toBe(reads);
  expect(state.posts).toEqual([]);
});

test("unsafe protocols and malformed Codex addresses never become navigable body links", async ({
  context,
  page,
}) => {
  const text = `[脚本](javascript:alert%281%29) [数据](data:text/html,hello) [坏会话](codex://threads/no-uuid) [子路径](${href.replace("?hostId=local", "/extra")})`;
  const { state } = await fixture(context, page, sourceId, {
    user: text,
    assistant: text,
  });
  for (const author of ["user", "assistant"]) {
    const body = page.locator(`.message.${author}`);
    await expect(body.getByRole("link")).toHaveCount(0);
    await expect(body).toContainText("坏会话");
  }
  expect(state.posts).toEqual([]);
});

test("body copy retains the authored Codex URI without replacing it by the Web route", async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          (window as any).threadCopy = {
            text: await (await items[0].getType("text/plain")).text(),
            html: await (await items[0].getType("text/html")).text(),
          };
        },
      },
    });
  });
  const text = `[目标会话](${href})`;
  const { state } = await fixture(context, page, sourceId, {
    user: text,
    assistant: "回答",
  });
  await page.getByRole("button", { name: "复制消息", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).threadCopy?.text))
    .toContain("目标会话");
  const copied = await page.evaluate(() => (window as any).threadCopy);
  expect(copied.text).toContain("目标会话");
  expect(copied.html).toContain(href.replaceAll("&", "&amp;"));
  expect(copied.html).not.toContain("codex-thread/");
  expect(state.posts).toEqual([]);
});

test("a conversation link below the collapsed user message becomes interactive only after expansion", async ({
  context,
  page,
}) => {
  const text =
    Array.from({ length: 30 }, (_, i) => `第${i + 1}段独立正文。`).join(
      "\n\n",
    ) + `\n\n[目标会话](${href})`;
  const { input, state } = await fixture(context, page, sourceId, {
    user: text,
    assistant: "回答",
  });
  const body = page.locator(".message.user");
  const link = body.locator(`a[href="${href}"]`);
  await expect(link).toHaveAttribute("inert", "");
  await expect(
    body.getByRole("link", { name: "目标会话", exact: true }),
  ).toHaveCount(0);
  await fillPromptText(input, "长消息跳转前的草稿");
  await body.getByRole("button", { name: "显示更多", exact: true }).click();
  await expect(link).not.toHaveAttribute("inert");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
  await page.goBack();
  await expectPromptText(input, "长消息跳转前的草稿");
  expect(state.posts).toEqual([]);
});

test("a body review activation cancels an earlier unresolved composer reference", async ({
  context,
  page,
}) => {
  const review = `codex://threads/${threadId}?view=review`;
  const { input, state } = await fixture(context, page, sourceId, {
    user: "提问",
    assistant: `[审阅](${review})`,
  });
  const unknown = href.replace(
    threadId,
    "019b1234-1234-7123-8123-123456789bbb",
  );
  const link = await insertLink(input, unknown);
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = state.listRequests;
  await link.click();
  await expect.poll(() => state.listRequests).toBeGreaterThan(before);
  await page
    .locator(".message.assistant")
    .getByRole("link", { name: "审阅", exact: true })
    .click();
  release();
  state.hold = null;
  await expect(page.locator(".review-panel")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#${targetId}\\?view=review`));
  await expect(
    page.getByText("当前服务器的工作区内未找到此会话，原草稿已保留。", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#${sourceId}$`));
  await expectPromptText(input, "before 目标会话 after");
  expect(state.posts).toEqual([]);
});

test("a review body link opens a new Web tab with its source and preserves Back history", async ({
  context,
  page,
}) => {
  const review = `codex://threads/${threadId}?view=review&diffFilter=last-turn&path=src%2Ffile.ts`;
  const { input, state } = await fixture(context, page, sourceId, {
    user: "提问",
    assistant: `[审阅](${review})`,
  });
  await fillPromptText(input, "新页前的草稿");
  const popup = page.waitForEvent("popup");
  await page
    .locator(".message.assistant")
    .getByRole("link", { name: "审阅", exact: true })
    .click({ modifiers: ["Shift"] });
  const other = await popup;
  await expect(other.locator(".review-panel")).toBeVisible();
  await expect(
    other.getByRole("button", { name: "差异来源", exact: true }),
  ).toHaveText("最后一轮");
  await expect(other).toHaveURL(
    new RegExp(
      `#${targetId}\\?view=review&diffFilter=last-turn&path=src%2Ffile.ts$`,
    ),
  );
  await other.reload();
  await expect(other.locator(".review-panel")).toBeVisible();
  await expectPromptText(input, "新页前的草稿");
  expect(state.posts).toEqual([]);
  await other.close();
});
