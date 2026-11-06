import { expectPromptText, fillPromptText } from "./prompt-editor-helpers";
import { test, expect, type Page } from "@playwright/test";
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("服务器地址").fill(new URL(page.url()).origin);
  await page.getByLabel("访问令牌").fill("browser-integration-test-token");
  await page.getByRole("button", { name: "连接工作空间" }).click();
  await expect(
    page.getByRole("heading", { name: "从哪里开始？" }),
  ).toBeVisible();
}
async function create(page: Page) {
  await page.getByRole("button", { name: "开始新会话", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Agent", exact: true })
    .selectOption("fixture");
  await page.getByRole("button", { name: "创建会话" }).click();
  await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
}
async function dismissReminders(page: Page) {
  const reminders = page.getByRole("button", { name: "关闭提醒", exact: true });
  while (await reminders.count()) await reminders.first().click();
}
async function clickWorkspaceTool(page: Page, name: string) {
  const action = page.getByRole("button", { name, exact: true });
  if (!(await action.isVisible()))
    await page.getByLabel("打开子窗口", { exact: true }).click();
  await action.click();
}
async function clickSessionAction(page: Page, name: string) {
  const action = page.getByRole("button", { name, exact: true });
  if (!(await action.isVisible()))
    await page.getByLabel("会话操作", { exact: true }).click();
  await action.click();
}
test("authentication, chat, approval, questions, files, terminal, and archive", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  if (testInfo.project.name === "desktop")
    await page.screenshot({
      path: "artifacts/web-desktop.png",
      fullPage: true,
    });
  await create(page);
  await fillPromptText(page.getByLabel("消息", { exact: true }), "hello");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.getByText("你的远程工作空间已连接，")).toBeVisible();
  await fillPromptText(page.getByLabel("消息", { exact: true }), "approval");
  await expect(page.getByTitle("发送", { exact: true })).toBeEnabled();
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.getByRole("button", { name: "允许一次" })).toBeVisible();
  await page.getByRole("button", { name: "允许一次" }).click();
  await expect(page.getByText("审批已处理。")).toBeVisible();
  await fillPromptText(page.getByLabel("消息", { exact: true }), "question");
  await expect(page.getByTitle("发送", { exact: true })).toBeEnabled();
  await page.getByTitle("发送", { exact: true }).click();
  await page.getByRole("button", { name: "深色 适合夜间" }).click();
  await page.getByRole("button", { name: "提交回答" }).click();
  await expect(page.getByText("回答已收到。")).toBeVisible();
  if (testInfo.project.name === "android-web")
    await page.screenshot({ path: "artifacts/web-mobile.png", fullPage: true });
  await dismissReminders(page);
  await clickWorkspaceTool(page, "文件");
  await page.getByRole("treeitem", { name: /README.md/ }).click();
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  await expect(page.locator(".file-editor")).toHaveValue(
    /# (Browser fixture|Updated in browser)/,
  );
  await page
    .locator(".file-editor")
    .fill(`# Updated in browser ${testInfo.project.name} ${Date.now()}\n`);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await clickWorkspaceTool(page, "变更");
  await page.getByRole("button", { name: "差异来源", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "未提交", exact: true })
    .click();
  await expect(page.locator(".review-panel")).toContainText(
    "# Updated in browser",
  );
  await clickWorkspaceTool(page, "终端");
  await expect(page.locator(".terminal-view .xterm")).toBeVisible();
  await expect(page.locator(".terminal-status")).toHaveText("已连接");
  expect(
    (await page.locator(".terminal-toolbar").boundingBox())!.height,
  ).toBeLessThan(49);
  const shortcuts = page.getByRole("button", { name: "快捷键", exact: true });
  if (testInfo.project.name === "desktop") {
    await expect(shortcuts).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByLabel("终端快捷键", { exact: true })).toHaveCount(0);
    await shortcuts.click();
  }
  const inputFrames: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (frame) => {
      try {
        const data = JSON.parse(String(frame.payload));
        if (data.type === "input") inputFrames.push(data.data);
      } catch {}
    }),
  );
  await page.getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(page.locator(".terminal-status")).toHaveText("已连接");
  const control = page.getByRole("button", { name: "Control", exact: true });
  await control.click();
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await page.locator(".xterm-helper-textarea").press("c");
  await expect.poll(() => inputFrames.includes("\x03")).toBe(true);
  await expect(control).toHaveAttribute("aria-pressed", "false");
  await page.getByTitle("中断终端命令", { exact: true }).click();
  await page.getByRole("button", { name: "清空终端", exact: true }).click();
  await page.screenshot({
    path: `artifacts/terminal-compact-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await shortcuts.click();
  await expect(page.getByLabel("终端快捷键", { exact: true })).toHaveCount(0);
  const output = await page.evaluate(
    async () =>
      await new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(
          `ws://${location.host}/ws/terminal/${location.hash.slice(1)}`,
        );
        ws.binaryType = "arraybuffer";
        let text = "";
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("PTY timeout"));
        }, 8000);
        ws.onopen = () => {
          ws.send(JSON.stringify({ token: "browser-integration-test-token" }));
          ws.send(
            JSON.stringify({
              type: "input",
              data: "printf 'PTY-browser-%s\\n' ok\n",
            }),
          );
        };
        ws.onmessage = (e) => {
          text +=
            typeof e.data === "string"
              ? e.data
              : new TextDecoder().decode(e.data);
          if (text.includes("PTY-browser-ok")) {
            clearTimeout(timer);
            ws.close();
            resolve(text);
          }
        };
      }),
  );
  expect(output).toContain("PTY-browser-ok");
  await page.getByRole("button", { name: "关闭预览面板", exact: true }).click();
  await page.getByLabel("会话操作").click();
  await page.getByRole("button", { name: "归档会话", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toBeDisabled();
  await clickSessionAction(page, "取消归档");
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByText("回答已收到。")).toBeVisible();
  expect(errors).toEqual([]);
});
test("session-derived workspace grouping, expansion, search and directory creation", async ({
  page,
}, testInfo) => {
  await login(page);
  const headers = { Authorization: "Bearer browser-integration-test-token" };
  const info = await (await page.request.get("/api/info", { headers })).json();
  const prefix = `导航会话 ${testInfo.project.name} ${Date.now()}`;
  for (let i = 0; i < 7; i++) {
    const response = await page.request.post("/api/sessions", {
      headers,
      data: { cwd: info.workspace, agent: "fixture", title: `${prefix} ${i}` },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();
  if (testInfo.project.name === "android-web")
    await page.getByRole("button", { name: "会话列表", exact: true }).click();
  await page.getByLabel("会话显示选项", { exact: true }).click();
  await page.getByRole("button", { name: "按目录", exact: true }).click();
  const root = page
    .locator(".workspace-group")
    .filter({ has: page.getByTitle(info.workspace, { exact: true }) });
  await expect(root.locator(".workspace-name")).toHaveText(
    info.workspace.split("/").pop(),
  );
  await expect(page.locator(".workspace-empty")).toHaveCount(0);
  await expect(root.locator(".session-row")).toHaveCount(5);
  await root.getByRole("button", { name: /展开显示/ }).click();
  await expect(root.locator(".session-row")).not.toHaveCount(5);
  await page.getByLabel("搜索会话").fill(`${prefix} 0`);
  await expect(
    page.getByRole("button", { name: `${prefix} 0`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `${prefix} 1`, exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("搜索会话").fill("完全不存在的目录或会话");
  await expect(page.getByText("没有找到匹配的目录或会话")).toBeVisible();
  await page.getByLabel("搜索会话").fill("empty-project");
  await expect(page.getByText("没有找到匹配的目录或会话")).toBeVisible();
  await expect(
    page.getByTitle(info.workspace + "/empty-project", { exact: true }),
  ).toHaveCount(0);
  const projectPath = `${info.workspace}/${testInfo.project.name}-project`;
  for (const title of ["真实子目录会话一", "真实子目录会话二"]) {
    const response = await page.request.post("/api/sessions", {
      headers,
      data: { cwd: projectPath, agent: "fixture", title: `${prefix} ${title}` },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();
  if (testInfo.project.name === "android-web")
    await page.getByRole("button", { name: "会话列表", exact: true }).click();
  await page.getByLabel("搜索会话").fill(prefix);
  const directory = page.locator(".workspace-group").filter({
    has: page.getByTitle(projectPath, { exact: true }),
  });
  await expect(directory.locator(".session-row")).toHaveCount(2);
  await directory
    .getByRole("button", {
      name: `在 ${testInfo.project.name}-project 新建会话`,
      exact: true,
    })
    .click();
  await expect(page.getByLabel("工作目录", { exact: true })).toHaveValue(
    projectPath,
  );
});

test("invalid token is rejected", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("服务器地址").fill(new URL(page.url()).origin);
  await page.getByLabel("访问令牌").fill("bad-token");
  await page.getByRole("button", { name: "连接工作空间" }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid access token");
});

test("PWA keeps the shell available offline without caching API data", async ({
  page,
  context,
}) => {
  await login(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(
      keys.find((k) => k.startsWith("anywork-"))!,
    );
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
  expect(cached).toContain("/index.html");
  expect(cached.some((p) => p.startsWith("/api/"))).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "从哪里开始？" }),
  ).toBeVisible();
  await context.setOffline(false);
});

test("recent messages load first, older pages show loading and preserve reading position", async ({
  page,
}) => {
  await login(page);
  const headers = { Authorization: "Bearer browser-integration-test-token" };
  const info = await (await page.request.get("/api/info", { headers })).json();
  const { session } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { cwd: info.workspace, agent: "fixture", title: "分页加载验收" },
    })
  ).json();
  for (let i = 0; i < 12; i++) {
    await page.request.post(`/api/sessions/${session.id}/messages`, {
      headers,
      data: { text: `分页消息 ${i}\n\n` + "阅读位置验证。".repeat(180) },
    });
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/sessions/${session.id}`, { headers })
            ).json()
          ).session.status,
      )
      .toBe("idle");
  }
  // End background subscriptions so this case exercises a cold page load;
  // same-page chat switching intentionally reuses the new history cache.
  await page.goto("about:blank");
  let releaseInitial!: () => void, releaseOlder!: () => void;
  const initialGate = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  const olderGate = new Promise<void>((resolve) => {
    releaseOlder = resolve;
  });
  let first = true,
    failOlder = true;
  await page.route(`**/api/sessions/${session.id}/history?*`, async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("cursor") && first) {
      first = false;
      await initialGate;
    } else if (url.searchParams.has("cursor")) {
      if (failOlder) {
        failOlder = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试加载失败" }),
        });
        return;
      }
      await olderGate;
    }
    await route.continue();
  });
  await page.goto(`/#${session.id}`);
  await expect(
    page.getByRole("status").filter({ hasText: "正在加载最近消息" }),
  ).toBeVisible();
  await expect(page.getByText("准备好了。开始构建吧。")).toHaveCount(0);
  releaseInitial();
  await expect(page.locator(".message, .tool-card")).toHaveCount(5);
  await expect(page.locator(".message.user").last()).toContainText(
    "分页消息 11",
  );
  await expect(
    page.locator('.user-message-text[data-collapsed="true"]'),
  ).not.toHaveCount(0);
  const chat = page.locator(".chat-scroll");
  await expect
    .poll(() =>
      chat.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(100);
  await chat.evaluate((el) => {
    el.scrollTop = 50;
  });
  await expect(
    page.getByRole("button", { name: "加载失败，点击重试", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".message, .tool-card")).toHaveCount(5);
  await page
    .getByRole("button", { name: "加载失败，点击重试", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "正在加载更早消息…", exact: true }),
  ).toBeDisabled();
  const anchor = page
    .locator(".message.user")
    .filter({ hasText: "分页消息 11" });
  const before = await anchor.boundingBox();
  releaseOlder();
  await expect(page.locator(".message, .tool-card")).toHaveCount(10);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const after = await anchor.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(6);
  await expect(page.locator(".message.user").last()).toContainText(
    "分页消息 11",
  );
  while (
    await page
      .getByRole("button", { name: "加载更早消息", exact: true })
      .count()
  ) {
    const response = page.waitForResponse(
      (r) =>
        r.url().includes(`/sessions/${session.id}/history?`) &&
        r.url().includes("cursor="),
    );
    await page
      .getByRole("button", { name: "加载更早消息", exact: true })
      // Scrolling the locator into view can itself trigger automatic pagination.
      .evaluate((el: HTMLButtonElement) => el.click());
    await response;
  }
  await expect(page.locator(".message.user")).toHaveCount(12);
  await expect(
    page.getByRole("button", { name: "加载更早消息", exact: true }),
  ).toHaveCount(0);
  await page.request.post(`/api/sessions/${session.id}/messages`, {
    headers,
    data: { text: "large" },
  });
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/sessions/${session.id}`, { headers })
          ).json()
        ).session.status,
    )
    .toBe("idle");
  await page.reload();
  await expect(page.locator(".history-loading")).toHaveCount(0);
  const tool = page.locator(".tool-card").last();
  await expect(tool).toBeAttached();
  await expect(tool.locator("pre")).toHaveCount(0);
  const detailResponse = page.waitForResponse((r) =>
    r.url().includes(`/sessions/${session.id}/history/item?`),
  );
  await page
    .getByRole("button", { name: /^展开工作过程/ })
    .last()
    .click();
  await tool.locator("summary").click();
  expect((await detailResponse).ok()).toBeTruthy();
  await expect(tool.locator("pre")).toContainText("large-tool-result");
});

test("ordinary sessions send, steer and stop without creating a fork", async ({
  page,
}) => {
  const native = {
    id: "codex-native",
    thread_id: "native",
    title: "普通执行会话",
    cwd: "/tmp",
    agent: "codex",
    model: null,
    policy: "manual",
    status: "running",
    archived: false,
    external: true,
    auxiliary: false,
    created_at: 1,
    updated_at: 1,
  };
  const actions: string[] = [];
  let queued: {
    id: number;
    text: string;
    attachments: string[];
    status: string;
  }[] = [];
  await page.route("**/api/sessions", async (route) => {
    await route.fulfill({ json: { sessions: [native] } });
  });
  await page.route("**/api/sessions/codex-native", (route) =>
    route.fulfill({ json: { session: native } }),
  );
  await page.route("**/api/sessions/codex-native/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/edit"))
      return route.fulfill({ json: { operation: null } });
    if (path.endsWith("/composer"))
      return route.fulfill({
        json: { goal: null, plan: false, plan_available: true },
      });
    if (path.endsWith("/queue")) {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON().action).toBe("steer");
        actions.push("steer");
        queued = [];
      }
      await route.fulfill({ json: { items: queued, paused: false } });
      return;
    }
    if (path.endsWith("/history")) {
      await route.fulfill({ json: { events: [], next_cursor: null } });
      return;
    }
    if (path.endsWith("/connect")) {
      actions.push("connect");
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (path.endsWith("/poll")) {
      await route.fulfill({ json: { events: [] } });
      return;
    }
    if (path.endsWith("/messages")) {
      const body = route.request().postDataJSON();
      actions.push(
        body.mode === "queue"
          ? "queue"
          : native.status === "running"
            ? "steer"
            : "start",
      );
      expect(body.text).toBeTruthy();
      if (body.mode === "queue")
        queued.push({
          id: 1,
          text: body.text,
          attachments: [],
          status: "pending",
        });
      native.status = "running";
      await route.fulfill({ json: { turn: { id: "native-turn" } } });
      return;
    }
    if (path.endsWith("/interrupt")) {
      actions.push("interrupt");
      native.status = "idle";
      await route.fulfill({ json: {} });
      return;
    }
    throw new Error(`Unexpected ordinary-session action: ${path}`);
  });
  await login(page);
  await page.goto("/#codex-native");
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toBeVisible();
  await expect(page.getByText("创建分支并继续")).toHaveCount(0);
  await expect(page.getByTitle("中断", { exact: true })).toBeVisible();
  const modelPicker = page.getByRole("button", {
    name: "模型与思考强度",
    exact: true,
  });
  await modelPicker.click();
  await expect(
    page.getByRole("menu", { name: "模型与思考强度" }),
  ).toContainText("当前任务完成后可更改模型。");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("审批模式")).toBeDisabled();
  await fillPromptText(input, "执行中补充指令");
  await page.getByTitle("发送", { exact: true }).click();
  await page
    .getByLabel("排队消息", { exact: true })
    .getByTitle("立即发送，引导当前任务")
    .click();
  await expectPromptText(input, "");
  await page.getByTitle("中断", { exact: true }).click();
  await expect(page.getByTitle("发送", { exact: true })).toBeVisible();
  await fillPromptText(input, "继续原会话");
  await page.getByTitle("发送", { exact: true }).click();
  await expectPromptText(input, "");
  expect(actions).toContain("connect");
  expect(actions.filter((a) => a !== "connect")).toEqual([
    "queue",
    "steer",
    "interrupt",
    "start",
  ]);
  expect(native.thread_id).toBe("native");
});

test("pasting an image uploads an attachment and keeps normal text paste", async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await login(page);
  await create(page);
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "请查看这张图片：");
  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route("**/uploads", async (route) => {
    await uploadGate;
    await route.continue();
  });
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    canvas.getContext("2d")!.fillRect(0, 0, 8, 8);
    const image = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), "image/png"),
    );
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": image }),
    ]);
  });
  await input.focus();
  await input.press("ControlOrMeta+V");
  await expect(
    page.getByRole("status").filter({ hasText: "正在上传附件" }),
  ).toBeVisible();
  await expect(page.getByTitle("发送", { exact: true })).toBeDisabled();
  await expect(page.getByTitle("中断", { exact: true })).toHaveCount(0);
  await expectPromptText(input, "请查看这张图片：");
  const thumbnail = page.locator(".attachments .image-attachment img");
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(8);
  await expect(page.locator(".image-attachment")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.locator(".image-attachment .image-load-trigger").click();
  const draftViewer = page.getByRole("dialog", {
    name: "图片查看器",
    exact: true,
  });
  await expect(draftViewer.locator("img")).toBeVisible();
  await draftViewer
    .getByRole("button", { name: "放大图片", exact: true })
    .click();
  await expect(draftViewer.getByLabel("图片缩放比例")).toHaveText("125%");
  await page.keyboard.press("Escape");
  await expect(draftViewer).toBeHidden();
  await expect(
    page.locator(".image-attachment .image-load-trigger"),
  ).toBeFocused();
  await expectPromptText(input, "请查看这张图片：");
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith("/uploads") && r.request().method() === "POST",
  );
  releaseUpload();
  const response = await uploaded;
  expect(response.ok()).toBeTruthy();
  const files = (await response.json()).files;
  expect(files).toHaveLength(1);
  expect(files[0].name).toMatch(/\.png$/i);
  await expect(page.locator(".attachments")).toContainText(files[0].name);
  await expect(thumbnail).toBeVisible();
  await expect(page.locator(".image-attachment")).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.screenshot({
    path: `artifacts/image-thumbnail-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await expect(page.getByTitle("发送", { exact: true })).toBeEnabled();
  await page.locator(".image-attachment .image-load-trigger").focus();
  await page.keyboard.press("Enter");
  await expect(draftViewer).toBeVisible();
  await expect(draftViewer.getByLabel("图片缩放比例")).toHaveText("100%");
  await draftViewer.locator("img").click();
  await expect(draftViewer).toBeVisible();
  await draftViewer
    .locator(".image-viewport")
    .click({ position: { x: 4, y: 4 } });
  await expect(draftViewer).toBeHidden();
  await expectPromptText(input, "请查看这张图片：");
  await page.evaluate(async () =>
    navigator.clipboard.writeText("文字正常粘贴"),
  );
  await input.focus();
  await input.press("End");
  await expect
    .poll(() =>
      input.evaluate((element) => {
        const selection = getSelection();
        return (
          !!selection?.focusNode &&
          element.contains(selection.focusNode) &&
          selection.focusOffset ===
            (selection.focusNode.textContent?.length ?? 0)
        );
      }),
    )
    .toBe(true);
  await input.press("ControlOrMeta+V");
  await expectPromptText(input, "请查看这张图片：文字正常粘贴");
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/messages") && r.method() === "POST",
  );
  await page.getByTitle("发送", { exact: true }).click();
  const payload = (await sent).postDataJSON();
  expect(payload.attachments).toEqual([files[0].path]);
  expect(payload.text).toBe("请查看这张图片：文字正常粘贴");
  await expect(page.locator(".attachments")).toHaveCount(0);
  const trigger = page
    .locator(".message-images")
    .getByRole("button", { name: "查看图片", exact: true })
    .last();
  let imageRequests = 0;
  let releaseImage!: () => void;
  const imageGate = new Promise<void>((resolve) => (releaseImage = resolve));
  await page.route("**/image?*", async (route) => {
    imageRequests++;
    await imageGate;
    await route.continue();
  });
  await expect(trigger).toBeVisible();
  await expect(page.locator(".message-images img")).toHaveCount(0);
  expect(imageRequests).toBe(0);
  await trigger.click();
  const viewer = page.getByRole("dialog", { name: "图片查看器", exact: true });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator(".viewer-placeholder")).toContainText(
    "正在加载图片",
  );
  releaseImage();
  const image = viewer.locator("img");
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(8);
  expect(imageRequests).toBe(1);
  await viewer.getByRole("button", { name: "放大图片", exact: true }).click();
  await expect(viewer.getByLabel("图片缩放比例")).toHaveText("125%");
  await viewer.getByRole("button", { name: "缩小图片", exact: true }).click();
  await expect(viewer.getByLabel("图片缩放比例")).toHaveText("100%");
  await viewer
    .getByRole("button", { name: "关闭图片查看器", exact: true })
    .click();
  await expect(viewer).toHaveCount(0);
  await expect(page.locator(".message-images img")).toHaveCount(0);
  await trigger.click();
  await expect(viewer.locator("img")).toBeVisible();
  expect(imageRequests).toBe(1);
  await viewer
    .getByRole("button", { name: "关闭图片查看器", exact: true })
    .click();
});

test("running messages queue, move back to the composer, undo, resubmit in FIFO order and steer", async ({
  page,
}) => {
  await login(page);
  await create(page);
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "slow");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.getByTitle("中断", { exact: true })).toBeVisible();
  await fillPromptText(input, "queued draft");
  await page.getByTitle("发送", { exact: true }).click();
  const queue = page.getByLabel("排队消息", { exact: true });
  await expect(queue.getByText("queued draft", { exact: true })).toBeVisible();
  await expect(page.getByLabel("选择发送方式", { exact: true })).toHaveCount(0);
  await fillPromptText(input, "last queued draft");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(queue.locator(".queue-item")).toHaveCount(2);
  await fillPromptText(input, "主输入框原草稿");
  await queue.locator('summary[aria-label="排队消息选项"]').first().click();
  const menu = queue.getByRole("menu", { name: "排队消息选项" });
  await expect(menu.getByRole("menuitem")).toHaveText(["编辑消息", "关闭排队"]);
  await menu.getByRole("menuitem", { name: "编辑消息", exact: true }).click();
  await expectPromptText(input, "queued draft");
  await expect(input).toBeFocused();
  await expect(queue.locator(".queue-item")).toHaveCount(1);
  await expect(page.getByLabel("编辑排队消息", { exact: true })).toHaveCount(0);
  await page
    .locator(".queue-edit-notice")
    .getByRole("button", { name: "撤销", exact: true })
    .click();
  await expectPromptText(input, "主输入框原草稿");
  await expect(queue.locator(".queue-item")).toHaveCount(2);
  await queue.locator('summary[aria-label="排队消息选项"]').first().click();
  await menu.getByRole("menuitem", { name: "编辑消息", exact: true }).click();
  await expectPromptText(input, "queued draft");
  await fillPromptText(input, "edited queued draft");
  await page.reload();
  await expectPromptText(input, "edited queued draft");
  await expect(page.locator(".queue-edit-notice")).toBeVisible();
  await page.getByTitle("发送", { exact: true }).click();
  await expect(queue.locator(".queue-item")).toHaveCount(2);
  await expect(queue.locator(".queue-item").first()).toContainText(
    "edited queued draft",
  );
  await queue.locator(".queue-item").last().getByTitle("删除排队消息").click();
  await expect(queue.locator(".queue-item")).toHaveCount(1);
  await queue.getByTitle("立即发送，引导当前任务").click();
  await expect(queue).toHaveCount(0);
  await expect(page.getByTitle("中断", { exact: true })).toBeVisible();
  await fillPromptText(input, "after stop");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(queue.getByText("after stop", { exact: true })).toBeVisible();
  await page.getByTitle("中断", { exact: true }).click();
  await expect(queue.getByText("排队已暂停", { exact: true })).toBeVisible();
  await queue.getByRole("button", { name: "继续排队", exact: true }).click();
  await expect(queue).toHaveCount(0);
});

test("workbench groups real sessions by status and filters their working directories", async ({
  page,
}, testInfo) => {
  await login(page);
  const headers = { Authorization: "Bearer browser-integration-test-token" };
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const prefix = `界面验收 ${testInfo.project.name} ${Date.now()}`;
  async function add(title: string, cwd = workspace, text?: string) {
    const { session } = await (
      await page.request.post("/api/sessions", {
        headers,
        data: { cwd, agent: "fixture", title: `${prefix} ${title}` },
      })
    ).json();
    if (text)
      await page.request.post(`/api/sessions/${session.id}/messages`, {
        headers,
        data: { text },
      });
    return session;
  }
  const idle = await add("待命");
  await add("执行", workspace, "slow");
  await add("审批", workspace, "approval");
  const child = `${workspace}/${testInfo.project.name}-project`;
  await add("子目录", child);
  await page.goto(`/#${idle.id}`);
  await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
  if (testInfo.project.name === "android-web")
    await page.getByRole("button", { name: "会话列表", exact: true }).click();
  await page.getByLabel("会话显示选项", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "按目录", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "按状态", exact: true }).click();
  await page.getByLabel("搜索会话").fill(prefix);
  await expect(page.locator('[data-group="running"]')).toContainText(
    `${prefix} 执行`,
  );
  await expect(page.locator('[data-group="waiting"]')).toContainText(
    `${prefix} 审批`,
  );
  await expect(page.locator('[data-group="recent"]')).toContainText(
    `${prefix} 待命`,
  );
  await page.getByLabel("会话显示选项", { exact: true }).click();
  await page.getByLabel("筛选工作目录", { exact: true }).selectOption(child);
  await expect(page.locator(".session-list .session-row")).toHaveCount(1);
  await expect(page.locator(".session-list .session-row")).toContainText(
    `${prefix} 子目录`,
  );
  await page.getByLabel("会话显示选项", { exact: true }).click();
  await page.getByLabel("筛选工作目录", { exact: true }).selectOption("");
  await page.getByLabel("会话显示选项", { exact: true }).click();
  await page.getByRole("button", { name: "按目录", exact: true }).click();
  await expect(page.locator(".workspace-group")).toHaveCount(2);
  await page.getByLabel("会话显示选项", { exact: true }).click();
  await page.getByRole("button", { name: "按状态", exact: true }).click();
  await page.screenshot({
    path: `artifacts/codex-navigation-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel("会话显示选项", { exact: true }).click();
  if (testInfo.project.name === "desktop") {
    await expect(
      page.getByRole("button", { name: "会话列表", exact: true }),
    ).toBeHidden();
    await page.getByTitle("收起侧栏", { exact: true }).click();
    await expect(page.locator("aside.sidebar")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "会话列表", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator("aside.sidebar")).toBeHidden();
    await page.getByLabel("会话操作", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "新建会话…", exact: true }),
    ).toBeVisible();
    await page.getByLabel("会话操作", { exact: true }).click();
    await page.getByRole("button", { name: "会话列表", exact: true }).click();
    await expect(page.locator("aside.sidebar")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "会话列表", exact: true }),
    ).toBeHidden();
  } else {
    await page
      .getByRole("button", { name: "关闭会话列表", exact: true })
      .click();
    await expect(page.locator(".sidebar-shade")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "会话列表", exact: true }),
    ).toBeVisible();
  }
});

test("workbench inspector keeps the conversation draft and supports both themes", async ({
  page,
}, testInfo) => {
  await login(page);
  await create(page);
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "先保留这条草稿，查看项目文件。");
  await clickWorkspaceTool(page, "文件");
  const inspector = page.getByLabel("文件面板", { exact: true });
  await expect(inspector).toBeVisible();
  await expect(
    inspector.getByRole("treeitem", { name: /README.md/ }),
  ).toBeVisible();
  const pane = page.getByLabel("会话内容", { exact: true });
  if (testInfo.project.name === "desktop") {
    await expect(pane).toBeVisible();
    const chatBox = await pane.boundingBox(),
      fileBox = await inspector.boundingBox();
    expect(fileBox!.x).toBeGreaterThanOrEqual(chatBox!.x + chatBox!.width - 1);
    await expect(
      page.getByRole("button", { name: "会话列表", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: "收起侧栏", exact: true }),
    ).toBeVisible();
  } else {
    await expect(pane).toBeHidden();
    const panelTabs = page.getByLabel("当前子窗口", { exact: true });
    await expect(panelTabs).toBeVisible();
    await expect(
      panelTabs.getByRole("tab", { name: "文件", exact: true }),
    ).toBeVisible();
    const tabs = await panelTabs.boundingBox();
    expect(tabs!.y + tabs!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height + 1,
    );
    expect(tabs!.y + tabs!.height).toBeLessThan(110);
  }
  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await clickSessionAction(page, "切换主题");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.screenshot({
      path: `artifacts/agent-os-workbench-${testInfo.project.name}-${theme}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "关闭预览面板", exact: true }).click();
  await expect(input).toBeVisible();
  await expectPromptText(input, "先保留这条草稿，查看项目文件。");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("color palettes apply to both appearances and persist after reload", async ({
  page,
}, testInfo) => {
  await login(page);
  await create(page);
  await clickSessionAction(page, "设置");
  const dialog = page.getByRole("dialog", { name: "设置与插件", exact: true });
  const values = [
    ["鸢尾紫", "violet"],
    ["海湾蓝", "blue"],
    ["青瓷", "teal"],
    ["松林绿", "green"],
    ["琥珀", "amber"],
    ["蔷薇", "rose"],
  ];
  const colors = new Set();
  for (const [name, id] of values) {
    await dialog
      .getByRole("combobox", { name: "主题", exact: true })
      .selectOption(id);
    await expect(page.locator("html")).toHaveAttribute("data-palette", id);
    await expect(
      dialog.getByRole("combobox", { name: "主题", exact: true }),
    ).toHaveValue(id);
    colors.add(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--accent"),
      ),
    );
  }
  expect(colors.size).toBe(6);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await clickSessionAction(page, "切换主题");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "rose");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: `artifacts/palette-rose-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("imageView and queued images load only after clicking their labels", async ({
  page,
}, testInfo) => {
  await login(page);
  await create(page);
  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 240;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#2563eb";
      ctx.fillRect(0, 0, 480, 240);
      ctx.fillStyle = "#93c5fd";
      ctx.fillRect(24, 24, 432, 56);
      ctx.fillStyle = "white";
      ctx.font = "32px sans-serif";
      ctx.fillText("Image preview", 32, 150);
      return canvas.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  const file = { name: "preview.png", mimeType: "image/png", buffer: png };
  await page.locator("input[type=file]").setInputFiles(file);
  await expect(page.locator(".attachments img")).toBeVisible();
  await expect(page.locator(".image-attachment")).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "viewimage");
  await page.getByTitle("发送", { exact: true }).click();
  let imageRequests = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.endsWith("/image")) imageRequests++;
  });
  const trigger = page
    .locator(".image-message")
    .getByRole("button", { name: "查看图片", exact: true });
  await page
    .getByRole("button", { name: /^展开工作过程/ })
    .last()
    .click();
  await expect(page.locator(".image-message img")).toHaveCount(0);
  expect(imageRequests).toBe(0);
  await page
    .locator(".image-message")
    .getByRole("button", { name: "已查看 1 张图像", exact: true })
    .click();
  await expect(page.locator(".image-message img")).toBeVisible();
  await expect(trigger).toBeVisible();
  await trigger.click();
  const viewer = page.getByRole("dialog", { name: "图片查看器", exact: true });
  const image = viewer.locator("img");
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(480);
  await viewer.getByRole("button", { name: "放大图片", exact: true }).click();
  await expect(viewer.getByLabel("图片缩放比例")).toHaveText("125%");
  await page.screenshot({
    path: `artifacts/image-viewer-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await viewer.getByRole("button", { name: "适应窗口", exact: true }).click();
  await expect(viewer.getByLabel("图片缩放比例")).toHaveText("100%");
  if (testInfo.project.name === "desktop") {
    await viewer.locator(".image-viewport").hover();
    await page.mouse.wheel(0, -100);
    await expect(viewer.getByLabel("图片缩放比例")).toHaveText("100%");
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect(viewer.getByLabel("图片缩放比例")).not.toHaveText("100%");
  } else {
    const client = await page.context().newCDPSession(page);
    const box = (await viewer.locator(".image-viewport").boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: x - 30, y, id: 1 },
        { x: x + 30, y, id: 2 },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 60, y, id: 1 },
        { x: x + 60, y, id: 2 },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(viewer.getByLabel("图片缩放比例")).not.toHaveText("100%");
    await client.detach();
  }
  await viewer
    .getByRole("button", { name: "关闭图片查看器", exact: true })
    .click();
  await expect(page.getByTitle("中断", { exact: true })).toHaveCount(0);
  await fillPromptText(input, "slow");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.getByTitle("中断", { exact: true })).toBeVisible();
  await page.locator("input[type=file]").setInputFiles(file);
  await expect(page.locator(".attachments img")).toBeVisible();
  await expect(page.locator(".image-attachment")).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
  await fillPromptText(input, "这张图片排队后再处理");
  await page.getByTitle("发送", { exact: true }).click();

  const queue = page.getByLabel("排队消息", { exact: true });
  await expect(
    queue.getByRole("button", { name: "查看图片", exact: true }),
  ).toBeVisible();
  await expect(queue.locator("img")).toHaveCount(0);
  expect(imageRequests).toBe(1);
  await dismissReminders(page);
  await queue.getByRole("button", { name: "查看图片", exact: true }).click();
  await expect(viewer.locator("img")).toBeVisible();
  await expect
    .poll(() =>
      viewer
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(480);
  await viewer
    .getByRole("button", { name: "关闭图片查看器", exact: true })
    .click();
  await dismissReminders(page);
  await queue.locator('summary[aria-label="排队消息选项"]').click();
  await page.screenshot({
    path: `artifacts/queue-images-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await queue.getByRole("menuitem", { name: "编辑消息", exact: true }).click();
  await expectPromptText(input, "这张图片排队后再处理");
  await expect(queue).toHaveCount(0);
  await expect(page.locator(".attachments .image-attachment")).toHaveCount(1);
  await fillPromptText(input, "更新后的图片任务");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(
    queue.getByText("更新后的图片任务", { exact: false }),
  ).toBeVisible();
  await expect(
    queue.getByRole("button", { name: "查看图片", exact: true }),
  ).toBeVisible();
  await expect(queue.locator("img")).toHaveCount(0);
  await page.reload();
  await expect(
    page
      .getByLabel("排队消息", { exact: true })
      .getByText("更新后的图片任务", { exact: false }),
  ).toBeVisible();
});

test("sending shows the accepted queue immediately without waiting for list and queue refreshes", async ({
  page,
}) => {
  await login(page);
  await create(page);
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "slow");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.getByTitle("中断", { exact: true })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let preflightReads = 0;
  const id = new URL(page.url()).hash.slice(1);
  await page.route("**/api/sessions", async (route) => {
    await gate;
    await route.continue();
  });
  await page.route(`**/api/sessions/${id}`, async (route) => {
    preflightReads++;
    await gate;
    await route.continue();
  });
  await page.route(`**/api/sessions/${id}/queue`, async (route) => {
    if (route.request().method() === "GET") await gate;
    await route.continue();
  });
  try {
    await fillPromptText(input, "立即显示已接收的排队消息");
    await page.getByTitle("发送", { exact: true }).click();
    await expect(page.locator(".queue-item")).toContainText(
      "立即显示已接收的排队消息",
    );
    await expectPromptText(input, "");
    await expect(input).toBeEditable();
    await expect(page.getByText("正在提交消息…", { exact: true })).toHaveCount(
      0,
    );
    expect(preflightReads).toBe(0);
  } finally {
    release();
  }
});

test("working indicator follows the current snapshot instead of historical starts or submission", async ({
  page,
}) => {
  const native = {
    id: "codex-state",
    thread_id: "state",
    title: "状态验收",
    cwd: "/tmp",
    agent: "codex",
    model: null,
    policy: "manual",
    status: "idle",
    archived: false,
    external: true,
    auxiliary: false,
    created_at: 1,
    updated_at: 1,
  };
  const oldStart = {
    seq: 1,
    session_id: native.id,
    method: "turn/started",
    params: { turn: { id: "old-turn", status: "inProgress" } },
    created_at: 1,
  };
  await page.route("**/api/sessions", (route) =>
    route.fulfill({ json: { sessions: [{ ...native, status: "running" }] } }),
  );
  await page.route("**/api/sessions/codex-state", (route) =>
    route.fulfill({ json: { session: native } }),
  );
  let releaseMessage!: () => void;
  const messageGate = new Promise<void>(
    (resolve) => (releaseMessage = resolve),
  );
  await page.route("**/api/sessions/codex-state/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/edit"))
      return route.fulfill({ json: { operation: null } });
    if (path.endsWith("/composer"))
      return route.fulfill({
        json: { goal: null, plan: false, plan_available: true },
      });
    if (path.endsWith("/history"))
      return route.fulfill({ json: { events: [oldStart], next_cursor: null } });
    if (path.endsWith("/poll"))
      return route.fulfill({ json: { events: [oldStart] } });
    if (path.endsWith("/queue"))
      return route.fulfill({ json: { items: [], paused: false } });
    if (path.endsWith("/connect")) return route.fulfill({ json: { ok: true } });
    if (path.endsWith("/messages")) {
      await messageGate;
      return route.fulfill({ json: {} });
    }
    throw new Error(`Unexpected state request ${path}`);
  });
  await login(page);
  await page.goto("/#codex-state");
  const input = page.getByLabel("消息", { exact: true });
  await expect(input).toBeVisible();
  await expect(page.locator(".session-header")).toHaveAttribute(
    "title",
    / · 待命 · /,
  );
  await expect(page.locator(".working")).toHaveCount(0);
  await fillPromptText(input, "仅提交中不能代表执行中");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.getByTitle("发送", { exact: true })).toBeDisabled();
  await expect(page.getByText("正在提交消息…", { exact: true })).toBeVisible();
  await expect(page.locator(".working")).toHaveCount(0);
  await expect(page.getByTitle("中断", { exact: true })).toHaveCount(0);
  releaseMessage();
  await expectPromptText(input, "");
  native.status = "running";
  await expect(page.locator(".working")).toContainText("正在处理你的请求…", {
    timeout: 10000,
  });
  native.status = "waiting";
  await expect(
    page.getByText("等待你的回应，请查看原客户端中的审批或问题。", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".working")).toHaveCount(0);
  native.status = "idle";
  await expect(page.locator(".session-header")).toHaveAttribute(
    "title",
    / · 待命 · /,
    {
      timeout: 10000,
    },
  );
  await expect(page.locator(".working")).toHaveCount(0);
  native.status = "starting";
  await expect(page.getByText("正在连接 Agent…", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator(".working")).toHaveCount(0);
  native.status = "external";
  await expect(page.locator(".session-header")).toHaveAttribute(
    "title",
    / · 运行状态未知 · /,
    {
      timeout: 10000,
    },
  );
  await expect(page.locator(".working")).toHaveCount(0);
});

test("composer add menu uploads, attaches remote files and controls native goal and plan", async ({
  page,
}, testInfo) => {
  await login(page);
  await create(page);
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "保留草稿");
  const add = page.getByRole("button", { name: "添加", exact: true });
  await add.click();
  const menu = page.getByRole("group", { name: "添加内容与模式" });
  await expect(menu.getByRole("button")).toHaveCount(4);
  await expect(menu.getByRole("button", { name: /计划模式/ })).toBeEnabled();
  await page.screenshot({
    path: `artifacts/composer-menu-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const chooser = page.waitForEvent("filechooser");
  await menu.getByRole("button", { name: /上传文件/ }).click();
  await (
    await chooser
  ).setFiles({
    name: "menu-upload.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("uploaded via add menu"),
  });
  await expect(page.locator(".attachments")).toContainText("menu-upload.txt");
  await expect(page.locator(".attachment-pending")).toHaveCount(0);
  await add.click();
  await menu.getByRole("button", { name: /添加远程文件/ }).click();
  const remote = page.getByRole("dialog", {
    name: "添加远程文件",
    exact: true,
  });
  await remote
    .getByRole("button", { name: "empty-project", exact: true })
    .click();
  await expect(remote.getByText("目录为空", { exact: true })).toBeVisible();
  await remote.getByRole("button", { name: "上一级目录" }).click();
  await remote.getByRole("button", { name: "README.md", exact: true }).click();
  await expect(remote.getByText("已选择 1 个文件")).toBeVisible();
  await page.screenshot({
    path: `artifacts/composer-remote-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await remote.getByRole("button", { name: "添加文件", exact: true }).click();
  await expect(page.locator(".attachments")).toContainText("README.md");
  await expectPromptText(input, "保留草稿");
  await add.click();
  await menu.getByRole("button", { name: /计划模式/ }).click();
  await expect(page.getByTitle("关闭计划模式", { exact: true })).toBeVisible();
  await expectPromptText(input, "保留草稿");
  await add.click();
  await menu.getByRole("button", { name: /目标/ }).click();
  await expect(
    page.getByRole("dialog", { name: "设置目标", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "退出目标模式", exact: true }),
  ).toBeVisible();
  await expectPromptText(input, "保留草稿");
  await expect(page.locator(".attachments")).toContainText("README.md");
  await fillPromptText(input, "完成添加菜单，验收通过且保留原会话权限");
  await page.screenshot({
    path: `artifacts/composer-goal-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const goalBanner = page.locator(".goal-banner");
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/messages") && r.method() === "POST",
  );
  await page.getByTitle("发送", { exact: true }).click();
  const body = (await sent).postDataJSON();
  expect(body.goal).toBe(true);
  expect(body.attachments).toHaveLength(2);
  expect(body.attachments.some((p: string) => p.endsWith("/README.md"))).toBe(
    true,
  );
  await expect(page.getByText("你的远程工作空间已连接，")).toBeVisible();
  await expect(goalBanner).toContainText("进行中的目标");
  await expect(goalBanner).toContainText(
    "完成添加菜单，验收通过且保留原会话权限",
  );
  await page.reload();
  await expect(page.getByTitle("关闭计划模式", { exact: true })).toBeVisible();
  await expect(goalBanner).toContainText("进行中的目标");
  await goalBanner
    .getByRole("button", { name: "编辑目标", exact: true })
    .click();
  const goalDetails = page.getByRole("complementary", {
    name: "目标面板",
    exact: true,
  });
  await expect(
    goalDetails.getByRole("textbox", { name: "目标", exact: true }),
  ).toContainText("完成添加菜单，验收通过且保留原会话权限");
  await page.getByRole("button", { name: "关闭预览面板", exact: true }).click();
  await expect(goalDetails).toHaveCount(0);
  await goalBanner
    .getByRole("button", { name: "清除目标", exact: true })
    .click();
  await expect(goalBanner).toHaveCount(0);
  await page.getByTitle("关闭计划模式", { exact: true }).click();
  await expect(page.getByTitle("关闭计划模式", { exact: true })).toHaveCount(0);
  await clickSessionAction(page, "切换主题");
  await add.click();
  await page.screenshot({
    path: `artifacts/composer-menu-dark-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const rect = await menu.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("Codex appearance follows system, edits colors and fonts, imports and restores defaults", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page);
  await clickSessionAction(page, "设置");
  const dialog = page.getByRole("dialog", { name: "设置与插件", exact: true });
  await expect(
    dialog.getByRole("heading", { name: "外观", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "浅色", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#ffffff",
  );
  await dialog.getByRole("button", { name: "跟随系统", exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await dialog.getByRole("button", { name: "浅色", exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: `artifacts/codex-appearance-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await dialog
    .getByLabel("强调色十六进制颜色", { exact: true })
    .fill("#7852ad");
  await dialog.getByLabel("背景十六进制颜色", { exact: true }).fill("#faf8f6");
  await dialog.getByLabel("前景十六进制颜色", { exact: true }).fill("#232122");
  await dialog
    .getByRole("combobox", { name: "字体", exact: true })
    .selectOption("mono");
  await dialog.getByRole("button", { name: "高级", exact: true }).click();
  await dialog
    .getByRole("slider", { name: "界面字号", exact: true })
    .fill("17");
  await dialog.getByRole("slider", { name: "行距", exact: true }).fill("1.8");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ra.appearance-v1")!),
  );
  expect(saved).toMatchObject({
    mode: "light",
    accent: "#7852ad",
    background: "#faf8f6",
    foreground: "#232122",
    font: "mono",
    fontSize: 17,
    lineHeight: 1.8,
  });
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "导出主题", exact: true }).click();
  expect((await downloading).suggestedFilename()).toBe("anywork-theme.json");
  await dialog.getByLabel("选择主题文件", { exact: true }).setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("invalid"),
  });
  await expect(dialog.locator(".appearance-notice")).toContainText("无法导入");
  await dialog.getByLabel("选择主题文件", { exact: true }).setInputFiles({
    name: "theme.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        appearance: { ...saved, accent: "#0169cc", fontSize: 15 },
      }),
    ),
  });
  await expect(dialog.locator(".appearance-notice")).toContainText(
    "主题已导入",
  );
  expect(
    await page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--accent"),
    ),
  ).toBe("#0169cc");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.reload();
  expect(
    await page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--font-ui-family"),
    ),
  ).toContain("monospace");
  await clickSessionAction(page, "设置");
  await dialog.getByRole("button", { name: "高级", exact: true }).click();
  await dialog.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "浅色", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await dialog.getByRole("button", { name: "返回聊天", exact: true }).click();
  await create(page);
  await fillPromptText(page.getByLabel("消息", { exact: true }), "hello");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.getByText("你的远程工作空间已连接，")).toBeVisible();
  await page.screenshot({
    path: `artifacts/codex-conversation-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("Codex document links open a rendered side panel, preserve drafts and expand turn activity", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await create(page);
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "document-preview",
  );
  await page.getByTitle("发送", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "设计说明", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("我先读取文档并核对结构。", { exact: true }),
  ).toBeHidden();
  const disclosure = page.getByRole("button", { name: /^展开工作过程/ }).last();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await disclosure.click();
  await expect(
    page.getByText("我先读取文档并核对结构。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".tool-card > summary").filter({ hasText: "docs/guide.md" }),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/codex-expanded-turn-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByText("我先读取文档并核对结构。", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("消息", { exact: true })
    .fill("打开文档后继续保留这条草稿");
  const pages = page.context().pages().length;
  await page.getByRole("link", { name: "设计说明", exact: true }).click();
  const panel = page.getByLabel("文件面板", { exact: true });
  await expect(
    panel.getByRole("heading", { name: "文档侧栏预览", exact: true }),
  ).toBeVisible();
  await expect(panel.locator(".document-markdown strong")).toHaveText(
    "Markdown",
  );
  await expect(
    panel.getByRole("treeitem", { name: "guide.md", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(page.context().pages().length).toBe(pages);
  if (testInfo.project.name === "desktop") {
    await expectPromptText(
      page.getByLabel("消息", { exact: true }),
      "打开文档后继续保留这条草稿",
    );
    const width = (await panel.boundingBox())!.width;
    await page
      .getByRole("separator", { name: "调整侧栏宽度" })
      .press("ArrowLeft");
    expect((await panel.boundingBox())!.width).toBeGreaterThan(width);
    await page
      .getByRole("separator", { name: "调整侧栏宽度" })
      .evaluate((el) => (el as HTMLElement).blur());
  }
  await page.screenshot({
    path: `artifacts/codex-markdown-panel-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await panel.getByRole("link", { name: "返回说明", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: /Browser fixture|Updated in browser/ }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "关闭预览面板", exact: true })
    .click();
  await expectPromptText(
    page.getByLabel("消息", { exact: true }),
    "打开文档后继续保留这条草稿",
  );
  await page.getByRole("link", { name: "代码定位", exact: true }).click();
  await expect(panel.locator(".file-editor")).toHaveValue(/fn main/);
  await expect
    .poll(() =>
      panel
        .locator(".file-editor")
        .evaluate((el: HTMLTextAreaElement) =>
          el.value.slice(el.selectionStart, el.selectionEnd),
        ),
    )
    .toContain("println!");
  await panel
    .getByRole("button", { name: "关闭预览面板", exact: true })
    .click();
  await page.getByRole("link", { name: "无法读取的文档", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(
    /No such file|outside|不存在/i,
  );
  await panel
    .getByRole("button", { name: "关闭预览面板", exact: true })
    .click();
  await expectPromptText(
    page.getByLabel("消息", { exact: true }),
    "打开文档后继续保留这条草稿",
  );
  expect(errors).toEqual([]);
});

test("expanded image activities load thumbnails on demand and browse the turn gallery", async ({
  page,
}, testInfo) => {
  await login(page);
  await create(page);
  const pngs = await page.evaluate(() =>
    [80, 120].map((width, index) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = 40;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = index ? "#0169cc" : "#c14b74";
      ctx.fillRect(0, 0, width, 40);
      return canvas.toDataURL("image/png").split(",")[1];
    }),
  );
  await page.locator("input[type=file]").setInputFiles(
    pngs.map((png, i) => ({
      name: `gallery-${i}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    })),
  );
  await expect(page.locator(".image-attachment[aria-busy=true]")).toHaveCount(
    0,
  );
  let requests = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.endsWith("/image")) requests++;
  });
  await fillPromptText(page.getByLabel("消息", { exact: true }), "viewimage");
  await page.locator(".image-attachment .image-load-trigger").first().click();
  const composerViewer = page.getByRole("dialog", {
    name: "图片查看器",
    exact: true,
  });
  await expect(
    composerViewer.getByRole("button", { name: "上一张图片", exact: true }),
  ).toBeDisabled();
  await composerViewer
    .getByRole("button", { name: "下一张图片", exact: true })
    .click();
  await expect(composerViewer.getByLabel("图片序号")).toHaveText("2 / 2");
  await expect(
    composerViewer.getByRole("button", { name: "下一张图片", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(composerViewer.getByLabel("图片序号")).toHaveText("2 / 2");
  await page.keyboard.press("Escape");
  await expectPromptText(page.getByLabel("消息", { exact: true }), "viewimage");
  expect(requests).toBe(0);
  await page.locator(".image-attachment .image-load-trigger").first().click();
  await expect(composerViewer.getByLabel("图片序号")).toHaveText("1 / 2");
  await page.keyboard.press("Escape");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.getByText("图片已查看。", { exact: true })).toBeVisible();
  expect(requests).toBe(0);
  await page
    .getByRole("button", { name: /^展开工作过程/ })
    .last()
    .click();
  expect(requests).toBe(0);
  const captions = page
    .locator(".image-message")
    .getByRole("button", { name: "已查看 2 张图像", exact: true });
  await expect(captions).toHaveCount(1);
  await captions.first().click();
  const thumbnails = page.locator(".image-message img");
  await expect(thumbnails).toHaveCount(2);
  await expect(thumbnails.first()).toBeVisible();
  expect(requests).toBe(2);
  await page.screenshot({
    path: `artifacts/codex-image-activity-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page
    .locator(".image-message")
    .first()
    .getByRole("button", { name: "查看图片", exact: true })
    .first()
    .click();
  const viewer = page.getByRole("dialog", { name: "图片查看器", exact: true });
  await expect(viewer.getByLabel("图片序号")).toHaveText("1 / 2");
  await expect
    .poll(() =>
      viewer
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(80);
  await viewer.getByRole("button", { name: "下一张图片", exact: true }).click();
  await expect(viewer.getByLabel("图片序号")).toHaveText("2 / 2");
  await expect
    .poll(() =>
      viewer
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(120);
  expect(requests).toBe(2);
  await viewer.getByRole("button", { name: "上一张图片", exact: true }).click();
  await expect
    .poll(() =>
      viewer
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(80);
  expect(requests).toBe(2);
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByLabel("图片序号")).toHaveText("2 / 2");
  await viewer.getByRole("button", { name: "放大图片", exact: true }).click();
  await expect(viewer.getByLabel("图片缩放比例")).toHaveText("125%");
  expect(await viewer.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `artifacts/codex-gallery-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  expect(requests).toBe(2);
});

test("document preview keeps the newest selection when an older file response arrives late", async ({
  page,
}) => {
  await login(page);
  await create(page);
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "document-preview",
  );
  await page.getByTitle("发送", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "设计说明", exact: true }),
  ).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/files?*", async (route) => {
    if (
      new URL(route.request().url()).searchParams
        .get("path")
        ?.endsWith("/docs/guide.md")
    ) {
      await gate;
      await route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ content: "# Stale document" }),
        })
        .catch(() => {});
    } else await route.continue();
  });
  await page.getByRole("link", { name: "设计说明", exact: true }).click();
  const panel = page.getByLabel("文件面板", { exact: true });
  await expect(panel.getByRole("status")).toContainText("正在加载文件");
  await panel.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: /Browser fixture|Updated in browser/ }),
  ).toBeVisible();
  release();
  await page.unroute("**/files?*");
  await expect(
    panel.getByRole("heading", { name: "Stale document", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("heading", { name: /Browser fixture|Updated in browser/ }),
  ).toBeVisible();
});

test("Codex expanded activity uses individual Harness rows without exposing reasoning", async ({
  page,
}, testInfo) => {
  await login(page);
  await create(page);
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "activity-layout",
  );
  await page.getByTitle("发送", { exact: true }).click();
  await expect(
    page.getByText("活动布局已核对。", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^展开工作过程/ })
    .last()
    .click();
  await expect(page.locator(".reasoning")).toHaveCount(0);
  await expect(page.getByText("思考内容不显示", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("先检查文件，再运行验证。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("检查已完成，继续下一步。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".activity-group")).toHaveCount(0);
  const tools = page.locator(".tool-card");
  await expect(tools).toHaveCount(3);
  await expect(tools.first()).toBeVisible();
  await tools.first().locator(":scope > summary").click();
  await expect(tools.first()).toHaveAttribute("open", "");
  await page.screenshot({
    path: `artifacts/codex-activity-rows-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("native model and reasoning settings persist, allow active effort and protect model changes during a turn", async ({
  page,
}, testInfo) => {
  await login(page);
  await create(page);
  const sessionId = new URL(page.url()).hash.slice(1),
    input = page.getByLabel("消息", { exact: true }),
    picker = page.getByRole("button", { name: "模型与思考强度", exact: true }),
    menu = page.getByRole("menu", { name: "模型与思考强度", exact: true });
  const changes: { model?: string; effort?: string }[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/composer"))
      return;
    const body = request.postDataJSON();
    if (body.action === "settings") changes.push(body);
  });
  await fillPromptText(input, "更改模型后保留这条草稿");
  await expect(picker).toContainText("Fixture");
  await picker.click();
  const slider = menu.getByRole("slider", { name: "选择推理强度" });
  await expect(slider).toHaveAttribute("aria-valuenow", "1");
  await expect(menu.getByText("medium", { exact: true })).toHaveCount(0);
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.screenshot({
    path: `artifacts/anywork-model-menu-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await slider.focus();
  await slider.press("End");
  await expect(menu).toHaveAttribute("aria-busy", "false");
  await expect(picker).toHaveAttribute("title", /思考强度：高/);
  await expectPromptText(input, "更改模型后保留这条草稿");
  expect(changes.at(-1)).toMatchObject({ action: "settings", effort: "high" });
  await menu.getByRole("button", { name: "选择模型", exact: true }).click();
  await expect(
    menu.getByRole("menuitem", { name: "速度", exact: true }),
  ).toHaveCount(0);
  await menu
    .getByRole("menuitemradio", { name: "Fixture Fast", exact: true })
    .click();
  await expect(picker).toContainText("Fixture Fast");
  await expect(picker).toHaveAttribute("title", /思考强度：轻度/);
  expect(changes.at(-1)).toMatchObject({
    model: "fixture-fast",
    effort: "low",
    service_tier: null,
  });
  await expect(slider).toHaveAttribute("aria-valuemax", "1");
  await slider.focus();
  await slider.press("End");
  await expect(menu).toHaveAttribute("aria-busy", "false");
  await expect(picker).toHaveAttribute("title", /思考强度：中/);
  await slider.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(picker).toBeFocused();
  await page.reload();
  await expect(picker).toContainText("Fixture Fast");
  await expect(picker).toHaveAttribute("title", /思考强度：中/);
  await picker.focus();
  await picker.press("ArrowDown");
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "选择模型", exact: true }).click();
  const first = menu.getByRole("menuitemradio", {
    name: "Fixture",
    exact: true,
  });
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.getByRole("menuitemradio", { name: "Fixture Fast", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(picker).toBeFocused();

  const headers = { Authorization: "Bearer browser-integration-test-token" };
  const unsupported = await page.request.post(
    `/api/sessions/${sessionId}/composer`,
    {
      headers,
      data: { action: "settings", effort: "high" },
    },
  );
  expect(unsupported.status()).toBe(400);
  await fillPromptText(input, "slow");
  await page.getByTitle("发送", { exact: true }).click();
  await expect(page.getByTitle("中断", { exact: true })).toBeVisible();
  await picker.click();
  await expect(menu).toContainText("当前任务完成后可更改模型。");
  await expect(slider).toHaveAttribute("aria-disabled", "false");
  await slider.focus();
  await slider.press("Home");
  await expect(picker).toHaveAttribute("title", /思考强度：轻度/);
  const active = await page.request.post(
    `/api/sessions/${sessionId}/composer`,
    {
      headers,
      data: { action: "settings", model: "fixture" },
    },
  );
  expect(active.status()).toBe(409);
  await page.keyboard.press("Escape");
  await page.getByTitle("中断", { exact: true }).click();
  await expect(page.getByTitle("发送", { exact: true })).toBeVisible();
  const current = await page.request.get(
    `/api/sessions/${sessionId}/composer`,
    { headers },
  );
  expect(await current.json()).toMatchObject({
    model: "fixture-fast",
    effort: "low",
  });
});

test("native goal banner pauses, resumes, opens the goal tab and clears without losing the draft", async ({
  page,
}, testInfo) => {
  await login(page);
  await create(page);
  const input = page.getByLabel("消息", { exact: true }),
    add = page.getByRole("button", { name: "添加", exact: true }),
    banner = page.locator(".goal-banner"),
    objective =
      "完成 AnyWork 会话区域：保留原生审批、模型设置与文件分屏。逐项验收桌面和手机上的真实操作。";
  await fillPromptText(input, objective);
  await add.click();
  await page
    .getByRole("group", { name: "添加内容与模式" })
    .getByRole("button", { name: /目标/ })
    .click();
  await expect(
    page.getByRole("button", { name: "退出目标模式", exact: true }),
  ).toBeVisible();
  await page.getByTitle("发送", { exact: true }).click();
  await expect(banner).toContainText("进行中的目标");
  await expect(banner.locator(".goal-banner-objective")).toHaveText(objective);
  await fillPromptText(input, "暂停和查看目标时保留草稿");
  await dismissReminders(page);
  const statusRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/composer") &&
      request.method() === "POST" &&
      request.postDataJSON().action === "goal_status",
  );
  await banner.getByRole("button", { name: "暂停目标", exact: true }).click();
  expect((await statusRequest).postDataJSON()).toMatchObject({
    action: "goal_status",
    status: "paused",
  });
  await expect(banner).toContainText("目标已暂停");
  await expectPromptText(input, "暂停和查看目标时保留草稿");
  await page.reload();
  await expect(banner).toContainText("目标已暂停");
  await fillPromptText(input, "恢复目标后继续保留草稿");
  await banner.getByRole("button", { name: "恢复目标", exact: true }).click();
  await expect(banner).toContainText("进行中的目标");
  await banner.getByRole("button", { name: "编辑目标", exact: true }).click();
  const details = page.getByRole("complementary", {
    name: "目标面板",
    exact: true,
  });
  await expect(details).toBeVisible();
  await expectPromptText(
    details.getByRole("textbox", { name: "目标", exact: true }),
    objective,
  );
  expect(
    await details.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/anywork-goal-details-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭预览面板", exact: true }).click();
  await expect(details).toHaveCount(0);
  await expectPromptText(input, "恢复目标后继续保留草稿");
  await banner.getByRole("button", { name: "清除目标", exact: true }).click();
  await expect(banner).toHaveCount(0);
  await expectPromptText(input, "恢复目标后继续保留草稿");
  await page.reload();
  await expect(banner).toHaveCount(0);
});

test("native header menus expose workspace tools, dismiss outside and restore keyboard focus", async ({
  page,
}, testInfo) => {
  await login(page);
  await create(page);
  const input = page.getByLabel("消息", { exact: true }),
    tools = page.getByLabel("打开子窗口", { exact: true }),
    actions = page.getByLabel("会话操作", { exact: true }),
    toolsMenu = page.locator(".header-tools-menu"),
    sessionMenu = page.locator(".conversation-header .session-menu");
  await fillPromptText(input, "打开菜单和面板时保留草稿");
  await expect(
    page.getByRole("button", { name: "文件", exact: true }),
  ).toHaveCount(0);
  await tools.click();
  await expect(toolsMenu).toHaveAttribute("open", "");
  await tools.press("ArrowUp");
  await expect(
    page.getByRole("button", { name: "终端", exact: true }),
  ).toBeFocused();
  await tools.focus();
  await tools.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: "文件", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("button", { name: "终端", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(
    page.getByRole("button", { name: "目标", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("button", { name: "文件", exact: true }),
  ).toBeFocused();
  const bounds = (await page.locator(".header-tools-options").boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.keyboard.press("Escape");
  await expect(toolsMenu).not.toHaveAttribute("open", "");
  await expect(tools).toBeFocused();
  await tools.click();
  await actions.click();
  await expect(toolsMenu).not.toHaveAttribute("open", "");
  await expect(sessionMenu).toHaveAttribute("open", "");
  await actions.press("End");
  await expect(
    page.getByRole("button", { name: "新建会话…", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();
  await expect(sessionMenu).not.toHaveAttribute("open", "");
  await tools.click();
  await input.click();
  await expect(toolsMenu).not.toHaveAttribute("open", "");
  await expectPromptText(input, "打开菜单和面板时保留草稿");
  await clickWorkspaceTool(page, "文件");
  await expect(page.getByLabel("文件面板", { exact: true })).toBeVisible();
  await expect(toolsMenu).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "关闭预览面板", exact: true }).click();
  await expectPromptText(input, "打开菜单和面板时保留草稿");
  await page.screenshot({
    path: `artifacts/anywork-native-header-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
