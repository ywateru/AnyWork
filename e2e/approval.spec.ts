import { expectPromptText, fillPromptText } from "./prompt-editor-helpers";
import { expect, test, type Page } from "./local-fixture";
import type { AgentEvent } from "../web/src/types";

const approvalEvent = (
  session = "approval-a",
  method = "item/commandExecution/requestApproval",
  params: Record<string, unknown> = {},
): AgentEvent => ({
  session_id: session,
  seq: 1,
  request_id: 17,
  method,
  created_at: Date.now(),
  params: {
    command: "npm test",
    cwd: "/work/project",
    reason: "测试需要本地访问",
    ...params,
  },
});

/** All API traffic is intercepted, including the long-poll transport. */
async function fixture(page: Page, initial: AgentEvent[] = [approvalEvent()]) {
  const state = {
    events: initial,
    responses: [] as { session: string; body: Record<string, unknown> }[],
    fail: false,
    hold: false,
    detailQueries: [] as string[],
    detailItem: null as Record<string, unknown> | null,
    detailFail: false,
    detailHold: false,
    releaseDetail: undefined as (() => void) | undefined,
    release: undefined as (() => void) | undefined,
  };
  const sessions = ["approval-a", "approval-b"].map((id) => ({
    id,
    title: id === "approval-a" ? "命令审批" : "权限审批",
    thread_id: id,
    cwd: "/work/project",
    agent: "fixture",
    model: null,
    policy: "manual",
    status: "waiting",
    archived: false,
    created_at: 1,
    updated_at: 1,
  }));
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/local/session")
      return route.fallback();
    const url = new URL(route.request().url());
    const path = url.pathname.slice(4);
    const id = path.split("/")[2];
    let data: unknown = {};
    if (path === "/info")
      data = { workspace: "/work/project", hostname: "approval-fixture" };
    else if (path === "/plugins")
      data = {
        plugins: [
          { id: "fixture", name: "Fixture", capabilities: ["approvals"] },
        ],
      };
    else if (path === "/sessions") data = { sessions };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path.endsWith("/history/item")) {
      state.detailQueries.push(url.searchParams.toString());
      if (state.detailHold)
        await new Promise<void>((resolve) => {
          state.releaseDetail = resolve;
        });
      await route.fulfill({
        status: state.detailFail ? 500 : 200,
        json: state.detailFail
          ? { error: "变更详情加载失败，请重试。" }
          : { item: state.detailItem },
      });
      return;
    } else if (path.endsWith("/history"))
      data = {
        events: state.events.filter((event) => event.session_id === id),
        next_cursor: null,
        latest_seq: Math.max(
          0,
          ...state.events
            .filter((event) => event.session_id === id)
            .map((event) => event.seq),
        ),
      };
    else if (path.endsWith("/events/poll"))
      data = {
        events: state.events.filter(
          (event) =>
            event.session_id === id &&
            event.seq > Number(url.searchParams.get("after") || 0),
        ),
      };
    else if (path.endsWith("/respond")) {
      state.responses.push({
        session: id,
        body: route.request().postDataJSON(),
      });
      if (state.hold)
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      await route.fulfill({
        status: state.fail ? 500 : 200,
        json: state.fail ? { error: "旧审批的迟到错误" } : { ok: true },
      });
      return;
    } else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (/^\/sessions\/[^/]+$/.test(path))
      data = { session: sessions.find((session) => session.id === id) };
    else
      throw new Error(
        `Unmocked API request: ${route.request().method()} ${path}`,
      );
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  await page.goto(`${process.env.APPROVAL_TEST_URL || ""}/#approval-a`);
  await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
  return state;
}

const card = (page: Page) => page.locator("[data-codex-approval-surface]");

test("permission approval describes the actual turn scope and safely links its reason", async ({
  page,
}) => {
  const state = await fixture(page, [
    approvalEvent("approval-a", "item/permissions/requestApproval", {
      command: undefined,
      reason:
        "查看 https://example.com/review?q=1). 保留 javascript:alert(1) 与 <img src=x> 为文字。",
      permissions: {
        network: { enabled: true },
        fileSystem: { read: ["/work/read"], write: ["/work/write"] },
      },
    }),
  ]);
  await expect(card(page)).toContainText("本回合有效");
  const approve = card(page).getByRole("button", {
    name: "允许一次",
    exact: true,
  });
  await expect(approve).toBeFocused();
  await expect(card(page)).toContainText("/work/read");
  await expect(card(page)).toContainText("/work/write");
  await expect(card(page).locator("a")).toHaveCount(1);
  const link = card(page).getByRole("link", {
    name: "https://example.com/review?q=1",
    exact: true,
  });
  await expect(link).toHaveAttribute("href", "https://example.com/review?q=1");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noreferrer noopener");
  await expect(card(page).locator("img")).toHaveCount(0);
  await expect(card(page)).toContainText("javascript:alert(1)");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => state.responses)
    .toEqual([
      {
        session: "approval-a",
        body: {
          request_id: 17,
          result: {
            permissions: {
              network: { enabled: true },
              fileSystem: { read: ["/work/read"], write: ["/work/write"] },
            },
            scope: "turn",
          },
        },
      },
    ]);
  await expect(
    card(page).getByRole("button", { name: "已提交", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  expect(state.responses).toHaveLength(1);
});

test("an arriving approval preserves typing; editable controls, IME, modifiers and overlays suppress shortcuts", async ({
  page,
}) => {
  const state = await fixture(page, []);
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "保留正在输入的草稿");
  state.events = [approvalEvent()];
  const approve = card(page).getByRole("button", {
    name: "允许一次",
    exact: true,
  });
  await expect(approve).toBeVisible();
  await expect(input).toBeFocused();
  await input.press("Escape");
  expect(state.responses).toHaveLength(0);
  await approve.focus();
  await page.evaluate(() => {
    const focused = document.activeElement!;
    for (const options of [
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
    ])
      focused.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      );
  });
  for (const role of ["dialog", "menu", "listbox"]) {
    await page.evaluate((role) => {
      const overlay = document.createElement("div");
      overlay.id = "approval-test-overlay";
      overlay.setAttribute("role", role);
      overlay.textContent = "临时弹层";
      document.body.append(overlay);
    }, role);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page
      .locator("#approval-test-overlay")
      .evaluate((element) => element.remove());
  }
  // The native header menus use <details>, rather than an ARIA menu role.
  await page.locator(".session-menu").evaluate((element) => {
    (element as HTMLDetailsElement).open = true;
  });
  await approve.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.locator(".session-menu").evaluate((element) => {
    (element as HTMLDetailsElement).open = false;
  });
  expect(state.responses).toHaveLength(0);
  await expectPromptText(input, "保留正在输入的草稿");
  await approve.focus();
  await page.keyboard.press("Escape");
  await expect
    .poll(() => state.responses)
    .toEqual([
      {
        session: "approval-a",
        body: { request_id: 17, result: { decision: "decline" } },
      },
    ]);
});

test("long details scroll independently while the narrow card keeps actions visible", async ({
  page,
}, info) => {
  await fixture(page, [
    approvalEvent("approval-a", undefined, {
      reason: Array.from(
        { length: 100 },
        (_, index) => `详细说明 ${index}: 保留底部操作。`,
      ).join("\n"),
    }),
  ]);
  await expect(card(page)).toBeVisible();
  await card(page).evaluate((element) => {
    (element as HTMLElement).style.width = "26rem";
    (element as HTMLElement).style.maxWidth = "100%";
  });
  const body = card(page).locator(".request-body");
  const footer = card(page).locator(".request-actions");
  await expect(card(page).locator(".request-action-group")).toHaveCSS(
    "flex-direction",
    "column",
  );
  await expect(card(page).locator(".request-key").first()).toBeHidden();
  expect(
    await body.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  const before = await footer.boundingBox();
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(
    0,
  );
  expect(await footer.boundingBox()).toEqual(before);
  await expect(
    card(page).getByRole("button", { name: "允许一次", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: `artifacts/anywork-approval-${info.project.name}.png`,
  });
});

test("a delayed response cannot mark or report errors in a different session with the same request ID", async ({
  page,
}) => {
  const state = await fixture(page, [
    approvalEvent(),
    approvalEvent("approval-b", "item/permissions/requestApproval", {
      permissions: { network: { enabled: true } },
    }),
  ]);
  state.hold = true;
  state.fail = true;
  await card(page)
    .getByRole("button", { name: "允许一次", exact: true })
    .click();
  await expect.poll(() => state.responses.length).toBe(1);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  expect(state.responses).toHaveLength(1);
  await page.evaluate(() => {
    location.hash = "approval-b";
  });
  const approve = card(page).getByRole("button", {
    name: "允许一次",
    exact: true,
  });
  await expect(approve).toBeEnabled();
  const response = page.waitForResponse((response) =>
    response.url().endsWith("/approval-a/respond"),
  );
  state.release!();
  await response;
  await expect(page.getByText("旧审批的迟到错误", { exact: true })).toHaveCount(
    0,
  );
  await expect(approve).toBeEnabled();
  state.hold = false;
  state.fail = false;
  await approve.click();
  await expect.poll(() => state.responses.length).toBe(2);
  expect(state.responses[1]).toEqual({
    session: "approval-b",
    body: {
      request_id: 17,
      result: { permissions: { network: { enabled: true } }, scope: "turn" },
    },
  });
  await expect(
    card(page).getByRole("button", { name: "已提交", exact: true }),
  ).toBeDisabled();
});

test("permission scope menu preserves complete entry permissions, keyboard focus and error retry", async ({
  page,
}) => {
  const permissions = {
    network: { enabled: true },
    fileSystem: {
      entries: [
        { path: { type: "path", path: "/work/docs" }, access: "read" },
        { path: { type: "path", path: "/work/docs" }, access: "write" },
        {
          path: { type: "glob_pattern", pattern: "/work/**/*.md" },
          access: "read",
        },
        {
          path: {
            type: "special",
            value: { kind: "project_roots", subpath: "src" },
          },
          access: "write",
        },
        { path: { type: "path", path: "/private" }, access: "deny" },
      ],
    },
  };
  const state = await fixture(page, [
    approvalEvent("approval-a", "item/permissions/requestApproval", {
      permissions,
    }),
  ]);
  await expect(card(page).locator(".request-details")).toContainText(
    "读取和写入文件",
  );
  await expect(card(page).locator(".request-details")).toContainText(
    "/work/**/*.md",
  );
  await expect(card(page).locator(".request-details")).toContainText(
    ":project_roots/src",
  );
  await expect(card(page).locator(".request-details")).toContainText(
    "禁止访问文件",
  );
  await expect(card(page).locator(".request-raw")).not.toHaveAttribute(
    "open",
    "",
  );
  const trigger = card(page).getByRole("button", {
    name: "审批选项",
    exact: true,
  });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "审批选项", exact: true });
  await expect(
    menu.getByRole("menuitem", { name: "允许一次", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    menu.getByRole("menuitem", { name: "允许此对话", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(state.responses).toHaveLength(0);
  state.fail = true;
  await trigger.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(card(page).locator(".request-error")).toContainText("请重试");
  const expected = {
    session: "approval-a",
    body: { request_id: 17, result: { permissions, scope: "session" } },
  };
  expect(state.responses).toEqual([expected]);
  await expect(trigger).toBeEnabled();
  state.fail = false;
  await trigger.click();
  await menu.getByRole("menuitem", { name: "允许此对话", exact: true }).click();
  await expect.poll(() => state.responses).toEqual([expected, expected]);
  await expect(card(page).locator(".request-error")).toHaveCount(0);
  await expect(card(page)).toContainText("此对话有效");
});

test("file approval associates its real item diff and offers all edits for the conversation", async ({
  page,
}) => {
  const state = await fixture(page, [
    {
      ...approvalEvent(),
      seq: 1,
      request_id: undefined,
      method: "item/started",
      params: {
        item: {
          id: "patch-1",
          type: "fileChange",
          status: "inProgress",
          changes: [
            {
              path: "src/app.ts",
              kind: { type: "update", move_path: "src/main.ts" },
              diff: "@@ -1 +1 @@\n-old\n+new",
            },
          ],
        },
      },
    },
    {
      ...approvalEvent("approval-a", "item/fileChange/requestApproval", {
        itemId: "patch-1",
        command: undefined,
      }),
      seq: 2,
    },
  ]);
  await expect(card(page)).toContainText("编辑文件");
  await card(page).locator(".request-file-change summary").click();
  await expect(card(page).locator(".request-file-diff")).toContainText("+new");
  await expect(
    card(page).locator(".request-file-change summary"),
  ).toContainText("src/app.ts → src/main.ts");
  await card(page)
    .getByRole("button", { name: "审批选项", exact: true })
    .click();
  const choice = page.getByRole("menuitem", { name: /允许所有修改/ });
  await expect(choice).toContainText("本次及后续文件编辑");
  await choice.click();
  await expect
    .poll(() => state.responses)
    .toEqual([
      {
        session: "approval-a",
        body: { request_id: 17, result: { decision: "acceptForSession" } },
      },
    ]);
});

test("command policy menu sends the exact native amendment and exposes extra permissions", async ({
  page,
}) => {
  const decision = {
    acceptWithExecpolicyAmendment: {
      execpolicy_amendment: ["npm", "run", "test suite"],
    },
  };
  const state = await fixture(page, [
    approvalEvent("approval-a", undefined, {
      kind: "writeStdin",
      availableDecisions: ["accept", decision, "decline"],
      additionalPermissions: {
        network: { enabled: true },
        fileSystem: {
          entries: [
            {
              access: "write",
              path: { type: "special", value: { kind: "tmpdir" } },
            },
          ],
        },
      },
    }),
  ]);
  await expect(card(page)).toContainText("向正在运行的进程写入标准输入");
  await expect(card(page).locator(".request-details")).toContainText(
    "额外权限 · 网络",
  );
  await expect(card(page).locator(".request-details")).toContainText(":tmpdir");
  await card(page)
    .getByRole("button", { name: "审批选项", exact: true })
    .click();
  const similar = page.getByRole("menuitem", { name: /允许类似命令/ });
  await expect(similar).toContainText("以 npm run");
  await similar.click();
  await expect
    .poll(() => state.responses)
    .toEqual([
      { session: "approval-a", body: { request_id: 17, result: { decision } } },
    ]);
});

test("network approval presents its destination and only sends the exact allow proposal", async ({
  page,
}) => {
  const proposal = { host: "example.com", action: "allow" };
  const decision = {
    applyNetworkPolicyAmendment: { network_policy_amendment: proposal },
  };
  const state = await fixture(page, [
    approvalEvent("approval-a", undefined, {
      networkApprovalContext: { host: "example.com", protocol: "https" },
      proposedNetworkPolicyAmendments: [
        { host: "denied.example", action: "deny" },
        proposal,
      ],
      availableDecisions: ["accept", "acceptForSession", decision, "decline"],
    }),
  ]);
  await expect(card(page).getByRole("heading")).toContainText(
    "https://example.com",
  );
  await expect(card(page)).toContainText("互联网访问");
  await expect(card(page)).toContainText("example.com 不在当前网络允许列表中");
  await expect(card(page).locator(".request-details")).toContainText("https");
  await card(page)
    .getByRole("button", { name: "始终允许", exact: true })
    .click();
  await expect
    .poll(() => state.responses)
    .toEqual([
      { session: "approval-a", body: { request_id: 17, result: { decision } } },
    ]);
});

test("empty and restricted decision lists hide invalid menu actions and never fall back to Enter once", async ({
  page,
}) => {
  const state = await fixture(page, [
    approvalEvent("approval-a", undefined, {
      availableDecisions: [],
      proposedExecpolicyAmendment: ["npm", "test"],
      networkApprovalContext: { host: "example.com", protocol: "https" },
      proposedNetworkPolicyAmendments: [
        { host: "example.com", action: "allow" },
      ],
    }),
  ]);
  await expect(card(page)).toContainText("此请求未提供可用的审批操作");
  await expect(card(page).getByRole("button")).toHaveCount(0);
  await card(page).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  expect(state.responses).toHaveLength(0);
  state.events = [
    approvalEvent("approval-a", undefined, {
      availableDecisions: ["acceptForSession", "decline"],
    }),
  ];
  await page.reload();
  await expect(
    card(page).getByRole("button", { name: "允许一次", exact: true }),
  ).toBeDisabled();
  await card(page).focus();
  await page.keyboard.press("Enter");
  expect(state.responses).toHaveLength(0);
  await card(page)
    .getByRole("button", { name: "审批选项", exact: true })
    .click();
  const menu = page.getByRole("menu", { name: "审批选项", exact: true });
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  await expect(
    menu.getByRole("menuitem", { name: "允许一次", exact: true }),
  ).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "允许此对话", exact: true }).click();
  await expect
    .poll(() => state.responses)
    .toEqual([
      {
        session: "approval-a",
        body: { request_id: 17, result: { decision: "acceptForSession" } },
      },
    ]);
});

test("deferred file details use the exact external item query and can retry failures or mismatched responses", async ({
  page,
}) => {
  const state = await fixture(page, [
    {
      ...approvalEvent(),
      seq: 1,
      request_id: undefined,
      method: "item/completed",
      params: {
        history_turn_id: "turn /1",
        item: {
          id: "large-patch",
          type: "fileChange",
          history_detail: { turn_id: "turn /1", item_id: "large-patch" },
        },
      },
    },
    {
      ...approvalEvent("approval-a", "item/fileChange/requestApproval", {
        itemId: "large-patch",
        command: undefined,
      }),
      seq: 2,
    },
  ]);
  const load = card(page).getByRole("button", {
    name: "加载变更详情",
    exact: true,
  });
  await expect(load).toBeVisible();
  expect(state.detailQueries).toEqual([]);
  await expect(card(page)).toContainText("变更详情尚未提供");
  state.detailFail = true;
  await load.click();
  await expect(
    card(page).locator(".request-detail-load [role='alert']"),
  ).toContainText("加载失败");
  await expect(load).toBeEnabled();
  state.detailFail = false;
  state.detailItem = {
    id: "other-patch",
    type: "fileChange",
    changes: { "secret.txt": { type: "add", content: "wrong" } },
  };
  await load.click();
  await expect(
    card(page).locator(".request-detail-load [role='alert']"),
  ).toContainText("不匹配");
  await expect(card(page)).not.toContainText("secret.txt");
  state.detailItem = {
    id: "large-patch",
    type: "fileChange",
    changes: {
      "src/large.ts": {
        type: "update",
        unified_diff: "@@ -1 +1 @@\n-old\n+loaded",
      },
    },
  };
  await load.click();
  await expect(load).toHaveCount(0);
  await card(page).locator(".request-file-change summary").click();
  await expect(card(page).locator(".request-file-diff")).toContainText(
    "+loaded",
  );
  expect(state.detailQueries).toEqual(
    Array(3).fill("turn_id=turn+%2F1&item_id=large-patch"),
  );
  expect(state.responses).toEqual([]);
});

test("a deferred file fetch cannot leak its item or error into another session with the same approval ID", async ({
  page,
}) => {
  const state = await fixture(page, [
    {
      ...approvalEvent(),
      seq: 1,
      request_id: undefined,
      method: "item/completed",
      params: {
        item: { id: "patch-a", type: "fileChange", history_detail: { seq: 1 } },
      },
    },
    {
      ...approvalEvent("approval-a", "item/fileChange/requestApproval", {
        itemId: "patch-a",
      }),
      seq: 2,
    },
    approvalEvent("approval-b", "item/fileChange/requestApproval", {
      itemId: "patch-b",
    }),
  ]);
  state.detailHold = true;
  state.detailFail = true;
  await card(page)
    .getByRole("button", { name: "加载变更详情", exact: true })
    .click();
  await expect.poll(() => state.detailQueries).toEqual(["seq=1"]);
  await page.evaluate(() => {
    location.hash = "approval-b";
  });
  await expect(
    card(page).getByRole("button", { name: "加载变更详情", exact: true }),
  ).toHaveCount(0);
  state.releaseDetail!();
  await expect(
    card(page).locator(".request-detail-load [role='alert']"),
  ).toHaveCount(0);
  await expect(
    card(page).getByRole("button", { name: "允许一次", exact: true }),
  ).toBeEnabled();
  expect(state.responses).toEqual([]);
});
