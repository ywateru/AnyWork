import { expect, fetchLocalRoute, test, type Page } from "./local-fixture";
import { fillPromptText } from "./prompt-editor-helpers";
const headers = { Authorization: "Bearer browser-integration-test-token" };
async function fixture(
  page: Page,
  permission: "granted" | "denied" | "default" = "granted",
) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const create = async (title: string) =>
    (
      await (
        await page.request.post("/api/sessions", {
          headers,
          data: { cwd: workspace, agent: "fixture", title },
        })
      ).json()
    ).session;
  const a = await create("通知验收 A");
  const b = await create("通知验收 B");
  await page.addInitScript((initialPermission) => {
    localStorage.setItem("ra.sidebar-pinned", "false");
    const w = window as any;
    w.__notices = [];
    w.__permissionRequests = 0;
    w.__permission = initialPermission;
    w.__hidden = false;
    Object.defineProperty(document, "hidden", { get: () => w.__hidden });
    document.hasFocus = () => true;
    class FakeNotification {
      static get permission() {
        return w.__permission;
      }
      static async requestPermission() {
        w.__permissionRequests++;
        return w.__permission;
      }
      constructor(title: string, options: any) {
        w.__notices.push({ title, ...options });
      }
    }
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: FakeNotification,
    });
    Object.defineProperty(navigator.serviceWorker, "getRegistration", {
      configurable: true,
      value: async () => ({
        active: true,
        showNotification: async (title: string, options: any) => {
          w.__notices.push({ title, ...options });
        },
        getNotifications: async () =>
          w.__notices
            .filter((n: any) => !n.closed)
            .map((n: any) => ({
              tag: n.tag,
              close: () => {
                n.closed = true;
              },
            })),
      }),
    });
  }, permission);
  let streaming = false;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/events/poll") streaming = true;
  });
  await page.goto(`/#${a.id}`);
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeEditable();
  await expect.poll(() => streaming).toBe(true);
  return {
    a,
    b,
    send: async (id: string, text: string) => {
      const r = await page.request.post(`/api/sessions/${id}/messages`, {
        headers,
        data: { text },
      });
      expect(r.ok()).toBe(true);
    },
  };
}
const toasts = (page: Page) => page.getByLabel("会话提醒", { exact: true });
const center = (page: Page) =>
  page.getByRole("dialog", { name: "通知中心", exact: true });

test("pending history survives an older completion and request replay without toast overlap", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let blocked = false;
  let replayed = false;
  const delivered: { method: string; turnId?: string; requestId?: number }[] =
    [];
  await page.route("**/api/events/poll?after=*", async (route) => {
    if (replayed) return route.continue();
    blocked = true;
    await held;
    const response = await fetchLocalRoute(route);
    const body = await response.json();
    for (const event of body.events)
      delivered.push({
        method: event.method,
        turnId: event.params.turn?.id ?? event.params.turnId,
        requestId: event.request_id,
      });
    replayed = true;
    await route.fulfill({ response });
  });
  try {
    await fixture(page);
    await expect.poll(() => blocked).toBe(true);
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await fillPromptText(editor, "hello");
    await page.getByTitle("发送", { exact: true }).click();
    await expect(page.getByText("你的远程工作空间已连接，")).toBeVisible();
    await fillPromptText(editor, "approval");
    await expect(page.getByTitle("发送", { exact: true })).toBeEnabled();
    await page.getByTitle("发送", { exact: true }).click();
    const approve = page.getByRole("button", { name: "允许一次", exact: true });
    await expect(approve).toBeVisible();
    await expect(page).toHaveTitle("(1) AnyWork");
    await expect(toasts(page)).toHaveCount(0);

    // History has already restored turn B's pending request. Only now let the
    // global stream deliver turn A's completion followed by the same request.
    release();
    await expect.poll(() => replayed).toBe(true);
    const oldCompletion = delivered.find((e) => e.method === "turn/completed");
    const pending = delivered.find((e) => e.requestId === 700);
    expect(oldCompletion?.turnId).toBeTruthy();
    expect(pending?.turnId).toBeTruthy();
    expect(pending?.turnId).not.toBe(oldCompletion?.turnId);
    expect(delivered.indexOf(oldCompletion!)).toBeLessThan(
      delivered.indexOf(pending!),
    );
    await page.getByRole("button", { name: /通知，.*未读/ }).click();
    await expect(center(page)).toContainText("会话执行完成");
    const request = center(page)
      .locator(".notification-item")
      .filter({ hasText: "需要权限或确认" });
    await expect(request).toHaveCount(1);
    await expect(request).not.toContainText("已处理");
    await page
      .getByRole("button", { name: "关闭通知中心", exact: true })
      .click();
    await expect(toasts(page)).toHaveCount(0);
    await expect(approve).toBeVisible();
    await approve.click();
    await expect(page.getByText("审批已处理。")).toBeVisible();
    await expect(approve).toHaveCount(0);
    await expect(toasts(page)).toContainText("会话执行完成");
    await page.getByRole("button", { name: /通知，.*未读/ }).click();
    await expect(request).toContainText("已处理");
  } finally {
    release();
  }
});

test("foreground completion shows an in-app reminder, opens the correct chat, and supports dismiss/outside/Escape", async ({
  page,
}, info) => {
  const { a, b, send } = await fixture(page);
  await send(b.id, "notification complete");
  await expect(toasts(page)).toContainText("会话执行完成");
  await expect(toasts(page)).toContainText("通知验收 B");
  expect(await page.evaluate(() => (window as any).__notices.length)).toBe(0);
  await expect(page).toHaveTitle("(1) AnyWork");
  await toasts(page)
    .getByRole("button", { name: /会话执行完成/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`#${b.id}$`));
  await expect(page).toHaveTitle("AnyWork");
  await page.getByRole("button", { name: "通知", exact: true }).click();
  await expect(center(page)).toContainText("通知验收 B");
  await page.getByRole("textbox", { name: "消息", exact: true }).click();
  await expect(center(page)).toHaveCount(0);
  await page.getByRole("button", { name: "通知", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(center(page)).toHaveCount(0);
  await page.evaluate((id) => {
    location.hash = id;
  }, a.id);
  await send(a.id, "notification next completion");
  await expect(toasts(page)).toContainText("通知验收 A");
  await toasts(page)
    .getByRole("button", { name: "关闭提醒", exact: true })
    .click();
  await expect(page).toHaveTitle("AnyWork");
  await page.getByRole("button", { name: "通知", exact: true }).click();
  await expect(center(page).locator(".notification-item")).toHaveCount(2);
  await page.screenshot({
    path: `artifacts/anywork-notifications-${info.project.name}.png`,
    fullPage: true,
  });
});

test("background approval notifies once and clicking selects its chat; resolution on another client clears the request", async ({
  page,
}) => {
  const { a, b, send } = await fixture(page);
  await page.evaluate(() => {
    (window as any).__hidden = true;
  });
  await send(b.id, "approval");
  await expect(toasts(page)).toContainText("需要权限或确认");
  await expect
    .poll(() => page.evaluate(() => (window as any).__notices.length))
    .toBe(1);
  await page.evaluate(() => {
    const data = (window as any).__notices[0].data;
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "ANYWORK_NOTIFICATION_CLICK", ...data },
      }),
    );
  });
  await expect(page).toHaveURL(new RegExp(`#${b.id}$`));
  await expect(page.locator("[data-codex-approval-surface]")).toBeVisible();
  await page.evaluate((id) => {
    location.hash = id;
  }, a.id);
  await page.evaluate((id) => {
    location.hash = id;
  }, b.id);
  await expect(page.locator("[data-codex-approval-surface]")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__notices.length)).toBe(1);
  const reply = await page.request.post(`/api/sessions/${b.id}/respond`, {
    headers,
    data: { request_id: 700, result: { decision: "accept" } },
  });
  expect(reply.ok()).toBe(true);
  await expect(page.locator("[data-codex-approval-surface]")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).__notices.length))
    .toBe(2);
  await expect
    .poll(() => page.evaluate(() => (window as any).__notices[0].closed))
    .toBe(true);
  await page.getByRole("button", { name: /通知，.*未读/ }).click();
  await expect(center(page)).toContainText("需要权限或确认 · 已处理");
  await expect(center(page)).toContainText("会话执行完成");
  await center(page).getByRole("button", { name: "全部标为已读" }).click();
  await expect(page).toHaveTitle("AnyWork");
});

test("browser permission is requested by user action only; denied permission keeps in-app reminders usable", async ({
  page,
}) => {
  const { a, send } = await fixture(page, "denied");
  await page.evaluate(() => {
    (window as any).__hidden = true;
  });
  await send(a.id, "notify permission denied");
  await expect(toasts(page)).toContainText("会话执行完成");
  expect(await page.evaluate(() => (window as any).__permissionRequests)).toBe(
    0,
  );
  await page.getByRole("button", { name: /通知，.*未读/ }).click();
  await center(page)
    .getByRole("button", { name: "开启系统通知", exact: true })
    .click();
  await expect(center(page).getByRole("status")).toContainText("浏览器阻止");
  expect(await page.evaluate(() => (window as any).__permissionRequests)).toBe(
    1,
  );
  expect(await page.evaluate(() => (window as any).__notices.length)).toBe(0);
  await center(page)
    .getByRole("button", { name: /会话执行完成/ })
    .click();
  await expect(page).toHaveTitle("AnyWork");
});
