import { test, expect, type Page } from "@playwright/test";

/** Synthetic native boundary; exercises the real React UI + NativeTransport adapter.
 * No real account, gateway, credential or user conversation is contacted. */
async function fixture(
  page: Page,
  options: {
    signedIn?: boolean;
    unknown?: boolean;
    changedKey?: boolean;
    holdLogin?: boolean;
    holdSave?: boolean;
    unknownSend?: boolean;
    approval?: boolean;
  } = {},
) {
  await page.addInitScript((options) => {
    const w = window as any;
    const events = new Map<string, Set<(event: { payload: any }) => void>>();
    const calls: any[] = [];
    const operations = new Map<string, any>();
    const exports = new Map<string, any>();
    const encoder = new TextEncoder();
    const emit = (name: string, payload: any) =>
      events.get(name)?.forEach((fn) => fn({ payload }));
    const device = {
      deviceRef: "device-1",
      installationId: "fixture-install",
      label: "工作 Mac",
      platform: "macOS",
      publicKey: "B".repeat(43),
      keyVersion: 2,
      online: true,
      trustedPublicKey: options.changedKey ? "A".repeat(43) : null,
    };
    let snapshot: any = {
      protocolVersion: 1,
      epoch: 1,
      phase: options.signedIn ? "signedIn" : "signedOut",
      account: options.signedIn
        ? {
            scopeId: "fixture-account",
            label: "林晓",
            email: "lin@example.invalid",
          }
        : null,
      devices: options.signedIn
        ? [
            device,
            {
              ...device,
              deviceRef: "unknown",
              label: "状态未知的电脑",
              online: null,
            },
            {
              ...device,
              deviceRef: "offline",
              label: "离线电脑",
              online: false,
            },
          ]
        : [],
      directoryState: options.unknown ? "unknown" : "ready",
      revision: 1,
      errorCode: null,
    };
    const session: any = {
      id: "synthetic-session",
      thread_id: "synthetic-thread",
      title: "Android 界面开发",
      cwd: "/workspace/any-work",
      agent: "fixture",
      model: "fixture-model",
      policy: "manual",
      status: options.approval ? "waiting" : "idle",
      archived: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    let file = "# 合成文档\n\n只用于移动端验收。";
    let fileRevision = "sha256:" + "a".repeat(64);
    const history = [
      {
        seq: 1,
        session_id: session.id,
        method: "user/message",
        params: { text: "请给出手机客户端方案" },
        created_at: Date.now(),
      },
      {
        seq: 2,
        session_id: session.id,
        method: "item/completed",
        params: {
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: "手机界面已连接。\n\n[文档](README.md)",
          },
        },
        created_at: Date.now(),
      },
    ];
    if (options.approval)
      history.push({
        seq: 3,
        session_id: session.id,
        request_id: 17,
        method: "item/commandExecution/requestApproval",
        created_at: Date.now(),
        params: {
          command: "npm test",
          cwd: session.cwd,
          reason: "运行合成测试",
        },
      } as any);
    function response(path: string, method: string, body: Uint8Array) {
      const url = new URL(path, "https://tauri.localhost");
      if (url.pathname === "/api/info")
        return {
          hostname: "工作 Mac",
          workspace: "/workspace/any-work",
          client_presence: false,
        };
      if (url.pathname === "/api/plugins")
        return {
          plugins: [
            {
              id: "fixture",
              name: "Fixture",
              protocol_version: 1,
              available: true,
              capabilities: [
                "chat",
                "resume",
                "interrupt",
                "approvals",
                "questions",
                "models",
              ],
            },
          ],
        };
      if (url.pathname === "/api/workspaces")
        return {
          workspaces: [
            { path: session.cwd, name: "any-work", root: true, sessions: 1 },
          ],
        };
      if (url.pathname === "/api/sessions") return { sessions: [session] };
      if (url.pathname === `/api/sessions/${session.id}`) return { session };
      if (url.pathname.endsWith("/files")) {
        if (method === "PUT") {
          const data = JSON.parse(new TextDecoder().decode(body));
          file = data.content;
          fileRevision = "sha256:" + "b".repeat(64);
          return { ok: true, revision: fileRevision };
        }
        return url.searchParams.get("path")
          ? { content: file, revision: fileRevision }
          : {
              entries: [
                {
                  name: "README.md",
                  path: "README.md",
                  directory: false,
                  size: 64,
                },
                {
                  name: "report.pdf",
                  path: "report.pdf",
                  directory: false,
                  size: 8,
                },
              ],
            };
      }
      if (url.pathname.endsWith("/document"))
        return new Blob(["%PDF-1.4"], { type: "application/pdf" });
      if (url.pathname.endsWith("/history"))
        return { events: history, cursor: null, has_more: false };
      if (url.pathname.endsWith("/export")) return { session, events: history };
      if (url.pathname.endsWith("/poll"))
        return { events: [], cursor: 2, has_more: false };
      if (url.pathname.endsWith("/queue")) return { items: [], paused: false };
      if (url.pathname.endsWith("/composer"))
        return {
          models: [],
          model_catalog_complete: false,
          settings: { model: "fixture-model" },
          capabilities: [],
        };
      if (url.pathname.endsWith("/models"))
        return {
          models: [
            {
              id: "fixture-model",
              model: "fixture-model",
              displayName: "Fixture",
            },
          ],
        };
      if (url.pathname.endsWith("/messages")) return { turn: "synthetic-turn" };
      if (url.pathname.endsWith("/uploads"))
        return { files: [{ name: "测试.txt", path: "/uploads/测试.txt" }] };
      if (url.pathname.endsWith("/git")) return { status: "", diff: "" };
      return {};
    }
    const insets = {
      unit: "cssPx",
      revision: 1,
      systemBars: { top: 24, right: 0, bottom: 24, left: 0 },
      cutout: { top: 0, right: 0, bottom: 0, left: 0 },
      ime: { top: 0, right: 0, bottom: 0, left: 0 },
      imeVisible: false,
    };
    w.mobileFixture = {
      calls,
      emit,
      operations,
      exports,
      snapshot: () => snapshot,
      setSnapshot: (next: any) => {
        snapshot = next;
        emit("mobile://account-state", next);
      },
      insets,
      resolveSave: null,
    };
    w.__TAURI__ = {
      core: {
        Channel: class {
          onmessage: any = () => {};
        },
        invoke: async (command: string, args?: any) => {
          const request = args?.request;
          calls.push({
            command,
            request: request ? { ...request, onEvent: undefined } : undefined,
          });
          if (
            [
              "mobile_account_snapshot",
              "mobile_account_refresh",
              "mobile_account_cancel",
              "mobile_account_logout",
            ].includes(command) &&
            args !== undefined
          )
            throw Error("Noarg account command received args");
          if (
            command === "mobile_account_snapshot" ||
            command === "mobile_account_refresh"
          )
            return structuredClone(snapshot);
          if (command === "mobile_account_login") {
            if (options.holdLogin) return new Promise(() => {});
            snapshot = {
              ...snapshot,
              epoch: snapshot.epoch + 1,
              phase: "signedIn",
              account: {
                scopeId: "fixture-account",
                label: "林晓",
                email: "lin@example.invalid",
              },
              devices: [device],
            };
            emit("mobile://account-state", snapshot);
            return structuredClone(snapshot);
          }
          if (
            command === "mobile_account_logout" ||
            command === "mobile_account_cancel"
          ) {
            snapshot = {
              ...snapshot,
              epoch: snapshot.epoch + 1,
              phase: "signedOut",
              account: null,
              devices: [],
            };
            emit("mobile://account-state", snapshot);
            return structuredClone(snapshot);
          }
          if (command === "mobile_account_device_update")
            return structuredClone(snapshot);
          if (command === "mobile_transport_connect") {
            if (
              request.expectedEpoch !== snapshot.epoch ||
              request.expectedRevision !== snapshot.revision
            )
              throw { code: "DIRECTORY_CONFLICT" };
            if (
              device.trustedPublicKey !== device.publicKey &&
              request.keyConfirmation !== device.publicKey
            )
              throw { code: "KEY_CONFIRMATION_REQUIRED" };
            return {
              connectionId: "fixture-connection",
              generation: 1,
              scopeId: "fixture-account:fixture-install",
            };
          }
          if (command === "mobile_transport_http_begin") {
            operations.set(request.operationId, {
              ...request,
              body: new Uint8Array(),
              offset: 0,
            });
            return;
          }
          if (command === "mobile_transport_http_write") {
            const op = operations.get(request.operationId);
            const bytes = Uint8Array.from(atob(request.base64), (c) =>
              c.charCodeAt(0),
            );
            const all = new Uint8Array(op.body.length + bytes.length);
            all.set(op.body);
            all.set(bytes, op.body.length);
            op.body = all;
            return { received: all.length };
          }
          if (command === "mobile_transport_http_finish") {
            const op = operations.get(request.operationId);
            if (options.unknownSend && op.path.endsWith("/messages"))
              throw { code: "CONNECTION_LOST", delivery: "outcome_unknown" };
            const result = response(op.path, op.method, op.body);
            op.output =
              result instanceof Blob
                ? new Uint8Array(await result.arrayBuffer())
                : encoder.encode(JSON.stringify(result));
            return {
              status: 200,
              contentType:
                result instanceof Blob ? result.type : "application/json",
              size: op.output.length,
            };
          }
          if (command === "mobile_transport_http_read") {
            const op = operations.get(request.operationId);
            const bytes = op.output.subarray(op.offset, op.offset + 32768);
            op.offset += bytes.length;
            return {
              base64: btoa(String.fromCharCode(...bytes)),
              done: op.offset === op.output.length,
            };
          }
          if (
            command === "mobile_transport_cancel" ||
            command === "mobile_transport_close"
          )
            return {};
          if (command === "mobile_transport_pty") {
            if (request.type === "open")
              queueMicrotask(() =>
                request.onEvent.onmessage({
                  connection: request.connection,
                  operationId: request.operationId,
                  sequence: 1,
                  type: "ready",
                }),
              );
            return {};
          }
          if (command === "plugin:mobile-system|insets_get") return insets;
          if (command === "plugin:mobile-system|export_begin") {
            const handle = "export-" + exports.size;
            exports.set(handle, { ...request, received: 0 });
            return { handle };
          }
          if (command === "plugin:mobile-system|export_write") {
            const op = exports.get(request.handle);
            op.received += atob(request.base64).length;
            return { received: op.received };
          }
          if (command === "plugin:mobile-system|export_finish") {
            if (options.holdSave)
              return new Promise((resolve) => {
                w.mobileFixture.resolveSave = () =>
                  resolve({ status: "saved" });
              });
            return {
              status:
                exports.get(request.handle).purpose === "share"
                  ? "chooserOpened"
                  : "saved",
            };
          }
          if (command.startsWith("plugin:mobile-system|")) return {};
          throw Error("Unexpected native command " + command);
        },
      },
      event: {
        listen: async (name: string, handler: any) => {
          if (!events.has(name)) events.set(name, new Set());
          events.get(name)!.add(handler);
          return () => events.get(name)!.delete(handler);
        },
      },
    };
  }, options);
  await page.goto("/mobile.html");
}
async function connect(page: Page) {
  await page.getByRole("button", { name: "打开工作区" }).first().click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认并连接", exact: true }).click();
  await page.getByText("Android 界面开发", { exact: true }).first().click();
}
const calls = (page: Page, command: string) =>
  page.evaluate(
    (command) =>
      (window as any).mobileFixture.calls.filter(
        (call: any) => call.command === command,
      ),
    command,
  );

test("first run, cancelled login, retry and real account summary", async ({
  page,
}, testInfo) => {
  await fixture(page, { holdLogin: true });
  await expect(
    page.getByRole("heading", { name: "电脑上的工作， 从手机继续。" }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("welcome.png") });
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await page.getByRole("button", { name: "取消登录", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已取消登录");
  expect((await calls(page, "mobile_account_login"))[0].request).toEqual({
    signup: false,
  });
  await page.getByRole("button", { name: "如何添加工作电脑" }).click();
  await expect(
    page.getByRole("heading", { name: "把电脑准备好" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录账号", exact: true }),
  ).toBeVisible();
});

test("directory unknown is not empty/offline; key change and clipboard error", async ({
  page,
}, testInfo) => {
  await fixture(page, { signedIn: true, changedKey: true });
  await expect(
    page.getByText("状态未知 · macOS", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "等待状态确认" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "电脑离线" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("devices.png") });
  await page.getByRole("button", { name: "打开工作区" }).click();
  await expect(
    page.getByRole("heading", { name: "这台电脑的公钥已改变" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认并连接", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.getByRole("button", { name: "复制当前公钥", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("verify.png") });
  await page.evaluate(() => {
    const f = (window as any).mobileFixture;
    f.setSnapshot({ ...f.snapshot(), revision: 2, directoryState: "unknown" });
  });
  await expect(
    page.getByText("暂时无法确认设备状态", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "打开工作区" })).toBeDisabled();
});

test("full App uses real native adapter; FormData, file save/share and one back consumption", async ({
  page,
}, testInfo) => {
  await fixture(page, { signedIn: true });
  await connect(page);
  expect((await calls(page, "mobile_transport_connect"))[0].request).toEqual({
    deviceRef: "device-1",
    expectedEpoch: 1,
    expectedRevision: 1,
    keyConfirmation: "B".repeat(43),
  });
  await expect(
    page.getByRole("navigation", { name: "会话工具" }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("conversation.png") });
  // Exercise FormData through the actual NativeTransport, including a Chinese filename.
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "测试.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("mobile upload"),
    });
  await expect
    .poll(async () =>
      (await calls(page, "mobile_transport_http_begin")).some(
        (c: any) =>
          c.request.path.endsWith("/uploads") &&
          c.request.contentType.startsWith("multipart/form-data; boundary="),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await expect(page.getByText("合成文档", { exact: true })).toBeVisible();
  await page.locator('summary[aria-label="文件选项"]').click();
  await page.getByRole("button", { name: "保存到手机", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存到所选位置");
  await page.locator('summary[aria-label="文件选项"]').click();
  await page.getByRole("button", { name: "分享文件", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已打开系统分享面板");
  expect(
    (await calls(page, "plugin:mobile-system|export_write")).every(
      (c: any) => atob(c.request.base64).length <= 65536,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    const f = (window as any).mobileFixture;
    f.emit("mobile-system-back", { eventId: 1, revision: 2 });
    f.emit("mobile-system-back", { eventId: 1, revision: 2 });
  });
  await expect
    .poll(
      async () =>
        (await calls(page, "plugin:mobile-system|back_set_state")).filter(
          (c: any) => c.request.handledEventId === 1,
        ).length,
    )
    .toBe(1);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("files-320.png") });
});

test("late chooser completion after account epoch change never reports saved", async ({
  page,
}) => {
  await fixture(page, { signedIn: true, holdSave: true });
  await connect(page);
  await page.locator('summary[aria-label="会话操作"]').click();
  await page.getByRole("button", { name: "导出会话", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => !!(window as any).mobileFixture.resolveSave),
    )
    .toBe(true);
  await page.evaluate(() => {
    const f = (window as any).mobileFixture;
    f.setSnapshot({
      ...f.snapshot(),
      epoch: 2,
      phase: "signedOut",
      account: null,
      devices: [],
    });
    f.resolveSave();
  });
  await expect(
    page.getByRole("button", { name: "登录账号", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("已保存到所选位置", { exact: true })).toHaveCount(
    0,
  );
  expect(
    (await calls(page, "plugin:mobile-system|export_abort")).length,
  ).toBeGreaterThan(0);
});

test("bounded exports, safe external links and authoritative insets", async ({
  page,
}) => {
  await fixture(page, { signedIn: true });
  await expect(page.getByRole("heading", { name: "我的设备" })).toBeVisible();
  const boundary = await page.evaluate(async () => {
    const { saveBlob } = await import("/src/platform.ts");
    const { openExternal } = await import("/src/mobile/system.ts");
    let oversized = "";
    try {
      await saveBlob(
        new Blob([new Uint8Array(22 * 1024 * 1024 + 1)]),
        "too-large.bin",
      );
    } catch (e) {
      oversized = String(e);
    }
    await saveBlob(new Blob(["x".repeat(150_000)]), "分块.txt");
    let blocked = "";
    try {
      await openExternal("javascript:alert(1)");
    } catch (e) {
      blocked = String(e);
    }
    await openExternal("/source");
    const f = (window as any).mobileFixture;
    f.emit("mobile-system-insets", {
      ...f.insets,
      revision: 2,
      systemBars: { top: 24, right: 0, bottom: 24, left: 0 },
      cutout: { top: 30, right: 0, bottom: 0, left: 0 },
      ime: { top: 0, right: 0, bottom: 300, left: 0 },
      imeVisible: true,
    });
    f.emit("mobile-system-insets", { ...f.insets, revision: 1 });
    return {
      oversized,
      blocked,
      top: getComputedStyle(document.documentElement).getPropertyValue(
        "--mobile-top",
      ),
      ime: getComputedStyle(document.documentElement).getPropertyValue(
        "--mobile-ime",
      ),
    };
  });
  expect(boundary.oversized).toContain("22 MiB");
  expect(boundary.blocked).toContain("HTTPS");
  expect(boundary.top).toBe("30px");
  expect(boundary.ime).toBe("300px");
  const writes = await calls(page, "plugin:mobile-system|export_write");
  expect(writes.map((c: any) => atob(c.request.base64).length)).toEqual([
    65536, 65536, 18928,
  ]);
  expect(
    (await calls(page, "plugin:mobile-system|open_external"))[0].request.url,
  ).toBe("https://anywork.aixgg.com/source");
  expect((await calls(page, "plugin:mobile-system|export_begin")).length).toBe(
    1,
  );
});

test("native back protects dirty file and restores the identity-scoped draft", async ({
  page,
}) => {
  await fixture(page, { signedIn: true });
  await connect(page);
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  await page
    .getByRole("textbox", { name: "文件内容" })
    .fill("未保存的手机草稿");
  await page.evaluate(() =>
    (window as any).mobileFixture.emit("mobile-system-back", {
      eventId: 10,
      revision: 10,
    }),
  );
  await expect(
    page.getByRole("dialog", {
      name: "文件修改尚未保存到电脑。保留手机草稿并离开？",
    }),
  ).toBeVisible();
  expect(
    (await calls(page, "plugin:mobile-system|back_set_state")).filter(
      (c: any) => c.request.handledEventId === 10,
    ),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "会话工具" })
      .getByRole("button", { name: "对话", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "文件内容" })).toHaveValue(
    "未保存的手机草稿",
  );
});

test("terminal reaches native Channel and settings omit unsupported system notifications", async ({
  page,
}, testInfo) => {
  await fixture(page, { signedIn: true });
  await connect(page);
  await page.getByRole("button", { name: "终端", exact: true }).click();
  await expect(page.locator(".terminal-status")).toContainText("已连接");
  await page.locator(".terminal-view").click();
  await page.keyboard.type("pwd");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () =>
      (await calls(page, "mobile_transport_pty")).some(
        (c: any) => c.request.type === "input",
      ),
    )
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("terminal.png") });
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await page.locator('summary[aria-label="会话操作"]').click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开启系统通知", exact: true }),
  ).toHaveCount(0);
});

test("unknown send preserves draft and blocks replay across reconnect", async ({
  page,
}) => {
  await fixture(page, { signedIn: true, unknownSend: true });
  await connect(page);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("只应手动发送一次");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText(
      "上次发送结果未知，电脑可能已经收到。请核对会话记录，避免重复发送。",
    ),
  ).toBeVisible();
  await expect(input).toContainText("只应手动发送一次");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  const countMessages = async () =>
    (await calls(page, "mobile_transport_http_begin")).filter((c: any) =>
      c.request.path.endsWith("/messages"),
    ).length;
  expect(await countMessages()).toBe(1);
  await page.reload();
  await connect(page);
  await expect(
    page.getByText(
      "上次发送结果未知，电脑可能已经收到。请核对会话记录，避免重复发送。",
    ),
  ).toBeVisible();
  expect(await countMessages()).toBe(0);
  await page.getByRole("button", { name: "刷新会话记录", exact: true }).click();
  expect(await countMessages()).toBe(0);
  await page
    .getByRole("button", { name: "已核对，解除发送保护", exact: true })
    .click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByText(
      "上次发送结果未知，电脑可能已经收到。请核对会话记录，避免重复发送。",
    ),
  ).toBeVisible();
});

test("native back leaves approval pending and explicit decision keeps request identity", async ({
  page,
}) => {
  await fixture(page, { signedIn: true, approval: true });
  await connect(page);
  await expect(
    page.getByText("npm test", { exact: true }).first(),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).mobileFixture.emit("mobile-system-back", {
      eventId: 21,
      revision: 21,
    }),
  );
  await expect(
    page.getByRole("heading", { name: "我的设备" }),
  ).not.toBeVisible();
  expect(
    (await calls(page, "mobile_transport_http_begin")).filter((c: any) =>
      c.request.path.endsWith("/respond"),
    ),
  ).toHaveLength(0);
  await page.getByText("Android 界面开发", { exact: true }).first().click();
  await page.getByRole("button", { name: "允许一次", exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        [...(window as any).mobileFixture.operations.values()]
          .filter((op: any) => op.path.endsWith("/respond"))
          .map((op: any) => JSON.parse(new TextDecoder().decode(op.body))),
      ),
    )
    .toEqual([{ request_id: 17, result: { decision: "accept" } }]);
});
