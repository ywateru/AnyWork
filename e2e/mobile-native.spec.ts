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
    question?: boolean;
    subagent?: boolean;
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
      status: options.approval || options.question ? "waiting" : "idle",
      archived: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    let file = "# 合成文档\n\n只用于移动端验收。";
    const child = {
      ...session,
      id: "child-session",
      thread_id: "child-thread",
      title: "Child worker",
      status: "idle",
    };
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
    if (options.question)
      history.push({
        seq: 3,
        session_id: session.id,
        request_id: 18,
        method: "item/tool/requestUserInput",
        created_at: Date.now(),
        params: {
          questions: [
            {
              id: "scope",
              header: "实施范围",
              question: "本次选择哪个范围？",
              options: [{ label: "移动端", description: "只实施手机界面" }],
              isOther: true,
              isSecret: false,
            },
          ],
        },
      } as any);
    if (options.subagent)
      history.push({
        seq: 3,
        session_id: session.id,
        method: "item/completed",
        created_at: Date.now(),
        params: {
          item: {
            id: "child-activity",
            type: "collabAgentToolCall",
            tool: "spawnAgent",
            status: "completed",
            receiverThreadIds: [child.thread_id],
            receiverThreads: [
              { threadId: child.thread_id, thread: { title: "Child worker" } },
            ],
            agentsStates: { [child.thread_id]: { status: "running" } },
          },
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
      if (url.pathname === "/api/sessions")
        return { sessions: options.subagent ? [session, child] : [session] };
      if (url.pathname === `/api/sessions/${child.id}`)
        return { session: child };
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
        return {
          events: url.pathname.includes(`/sessions/${child.id}/`)
            ? []
            : history,
          cursor: null,
          has_more: false,
        };
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
      setRemoteFile: (content: string, revision: string) => {
        file = content;
        fileRevision = revision;
      },
      remoteFile: () => file,
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
          if (command === "plugin:mobile-system|appearance_set") {
            if (
              Object.keys(args).join() !== "request" ||
              typeof request.dark !== "boolean"
            )
              throw Error("Invalid appearance DTO");
            return { dark: request.dark };
          }
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
              return new Promise((resolve, reject) => {
                w.mobileFixture.resolveSave = (failed = false) =>
                  failed
                    ? reject(new Error("old account chooser failed"))
                    : resolve({ status: "saved" });
              });
            return {
              status:
                w.mobileFixture.exportResult ??
                (exports.get(request.handle).purpose === "share"
                  ? "chooserOpened"
                  : "saved"),
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

test("directory diagnostic details show only fixed codes and keep connection blocked", async ({
  page,
}, testInfo) => {
  await fixture(page, { signedIn: true, unknown: true });
  await page.getByText("诊断详情", { exact: true }).click();
  const details = page.locator(".mobile-directory-error details");
  for (const code of [
    "MOBILE_COORDINATION_CONFIG_FETCH_FAILED",
    "MOBILE_COORDINATION_REGISTRATION_FAILED",
    "MOBILE_INVALID_GATEWAY",
    "MOBILE_COORDINATION_DIRECTORY_FETCH_FAILED",
  ]) {
    await page.evaluate((errorCode) => {
      const f = (window as any).mobileFixture;
      f.setSnapshot({ ...f.snapshot(), errorCode });
    }, code);
    await expect(details.locator("code")).toHaveText(code);
    expect(
      await details.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "打开工作区" }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "刷新设备" })).toBeEnabled();
  }
  await page.screenshot({
    path: testInfo.outputPath("directory-diagnostic.png"),
  });
  for (const errorCode of [
    "MOBILE_NETWORK_ERROR\nprivate bearer token",
    "https://private.invalid/?token=synthetic",
    "UNREVIEWED_PRIVATE_VALUE",
    null,
  ]) {
    await page.evaluate((errorCode) => {
      const f = (window as any).mobileFixture;
      f.setSnapshot({ ...f.snapshot(), errorCode });
    }, errorCode);
    await expect(details).toContainText("暂未记录可用的诊断码，请重新检查。");
    await expect(details.locator("code")).toHaveCount(0);
  }
  expect(await calls(page, "mobile_transport_connect")).toHaveLength(0);
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
  await page.screenshot({ path: testInfo.outputPath("conversation-320.png") });
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

test("missing native bridge exposes retry without a browser login fallback", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  await page.goto("/mobile.html");
  await expect(page.getByRole("alert")).toContainText(
    /原生事件接口不可用|请在 AnyWork Android 应用中打开此界面/,
  );
  await expect(
    page.getByRole("button", { name: "重新加载", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "登录账号", exact: true }),
  ).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});

test("native PDF uses actual save/share and cancellation is not success", async ({
  page,
}) => {
  await fixture(page, { signedIn: true });
  await connect(page);
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("treeitem", { name: "report.pdf", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "分享文件", exact: true }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).mobileFixture.exportResult = "cancelled";
  });
  await page
    .getByRole("button", { name: "保存到手机", exact: true })
    .first()
    .click();
  await expect(page.getByRole("status")).toContainText("已取消保存");
  await expect(page.getByText("已保存到所选位置", { exact: true })).toHaveCount(
    0,
  );
  await page.evaluate(() => {
    delete (window as any).mobileFixture.exportResult;
  });
  await page.getByRole("button", { name: "分享文件", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已打开系统分享面板");
  expect(
    (await calls(page, "plugin:mobile-system|export_begin")).map((c: any) => [
      c.request.name,
      c.request.mime,
      c.request.purpose,
    ]),
  ).toEqual([
    ["report.pdf", "application/pdf", "save"],
    ["report.pdf", "application/pdf", "share"],
  ]);
});

test("dirty file tab close is cancellable and dialog traps focus", async ({
  page,
}) => {
  await fixture(page, { signedIn: true });
  await connect(page);
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  await page
    .getByRole("textbox", { name: "文件内容", exact: true })
    .fill("保留草稿");
  await page
    .getByRole("button", { name: "关闭标签：README.md", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "确认", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "文件内容", exact: true }),
  ).toHaveValue("保留草稿");
});

test("late export failure belongs to the old account", async ({ page }) => {
  await fixture(page, { signedIn: true, holdSave: true });
  await page.getByRole("heading", { name: "我的设备" }).waitFor();
  await page.evaluate(async () => {
    const p = await import("/src/platform.ts");
    void p
      .saveBlob(new Blob(["fixture"]), "fixture.txt")
      .catch(p.platformError);
  });
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
    f.resolveSave(true);
  });
  await expect(
    page.getByRole("button", { name: "登录账号", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await calls(page, "plugin:mobile-system|export_abort")).length,
    )
    .toBeGreaterThan(0);
});

test("restored file draft retains its original revision and requires explicit rebase", async ({
  page,
}) => {
  await fixture(page, { signedIn: true });
  await connect(page);
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("treeitem", { name: "README.md", exact: true }).click();
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  await page
    .getByRole("textbox", { name: "文件内容" })
    .fill("old mobile draft");
  await page.evaluate(() =>
    (window as any).mobileFixture.emit("mobile-system-back", {
      eventId: 30,
      revision: 30,
    }),
  );
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.evaluate(() =>
    (window as any).mobileFixture.setRemoteFile(
      "another user changed this file",
      "sha256:" + "c".repeat(64),
    ),
  );
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("button", { name: "编辑文档", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "文件内容" })).toHaveValue(
    "old mobile draft",
  );
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "最新文件比较" }),
  ).toContainText("another user changed this file");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(
          sessionStorage.getItem(
            Object.keys(sessionStorage).find((k) =>
              k.includes("mobile-file-draft"),
            )!,
          )!,
        ).revision,
    ),
  ).toBe("sha256:" + "a".repeat(64));
  expect(
    await page.evaluate(() => (window as any).mobileFixture.remoteFile()),
  ).toBe("another user changed this file");
  await page
    .getByRole("button", {
      name: "使用此版本作为保存基线，保留草稿",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).mobileFixture.remoteFile()))
    .toBe("old mobile draft");
  const submitted = await page.evaluate(() =>
    [...(window as any).mobileFixture.operations.values()]
      .filter((o: any) => o.method === "PUT")
      .map((o: any) => JSON.parse(new TextDecoder().decode(o.body))),
  );
  expect(submitted).toHaveLength(1);
  expect(submitted[0].expected_revision).toBe("sha256:" + "c".repeat(64));
});

for (const exit of ["native-close", "reload"] as const)
  test(`pending send ${exit} retains a pre-dispatch receipt fence`, async ({
    page,
  }) => {
    await fixture(page, { signedIn: true });
    await connect(page);
    await page.evaluate(() => {
      const api = (window as any).__TAURI__.core;
      const original = api.invoke.bind(api);
      const f = (window as any).mobileFixture;
      api.invoke = async (command: string, args: any) => {
        if (
          command === "mobile_transport_http_finish" &&
          f.operations.get(args.request.operationId)?.path.endsWith("/messages")
        ) {
          f.heldSend = true;
          return new Promise(() => {});
        }
        return original(command, args);
      };
    });
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("may already be executing");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).mobileFixture.heldSend))
      .toBe(true);
    expect(
      await page.evaluate(() =>
        Object.keys(sessionStorage).filter((k) =>
          k.includes("mobile-uncertain-send"),
        ),
      ),
    ).toHaveLength(1);
    if (exit === "reload") await page.reload();
    else
      await page.evaluate(() =>
        (window as any).mobileFixture.emit("mobile-transport-closed", {
          connection: { connectionId: "fixture-connection", generation: 1 },
          code: "CONNECTION_CLOSED",
        }),
      );
    await expect(
      page.getByRole("heading", { name: "我的设备", exact: true }),
    ).toBeVisible();
    await connect(page);
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toContainText("may already be executing");
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText(
        "上次发送结果未知，电脑可能已经收到。请核对会话记录，避免重复发送。",
      ),
    ).toBeVisible();
  });

test("confirmed response clears only its submission receipt", async ({
  page,
}) => {
  await fixture(page, { signedIn: true });
  await connect(page);
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("confirmed request");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toHaveText("");
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) =>
        k.includes("mobile-uncertain-send"),
      ),
    ),
  ).toHaveLength(0);
});

test("explicit not_sent clears the pre-dispatch fence and retains editable draft", async ({
  page,
}) => {
  await fixture(page, { signedIn: true });
  await connect(page);
  await page.evaluate(() => {
    const api = (window as any).__TAURI__.core;
    const original = api.invoke.bind(api);
    const f = (window as any).mobileFixture;
    api.invoke = async (command: string, args: any) => {
      if (
        command === "mobile_transport_http_begin" &&
        args.request.path.endsWith("/messages")
      ) {
        f.seenReceipt = Object.keys(sessionStorage).some(
          (k) =>
            k.includes("mobile-uncertain-send") && sessionStorage.getItem(k),
        );
        throw { code: "DEVICE_NOT_READY", delivery: "not_sent" };
      }
      return original(command, args);
    };
  });
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("not dispatched");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("DEVICE_NOT_READY");
  expect(
    await page.evaluate(() => (window as any).mobileFixture.seenReceipt),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toContainText("not dispatched");
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) =>
        k.includes("mobile-uncertain-send"),
      ),
    ),
  ).toHaveLength(0);
});

test("system bar appearance follows resolved app theme instead of OS theme", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await fixture(page, { signedIn: true });
  await page.getByRole("button", { name: "账户与设置", exact: true }).click();
  await expect
    .poll(async () =>
      (await calls(page, "plugin:mobile-system|appearance_set")).map(
        (c: any) => c.request,
      ),
    )
    .toEqual([{ dark: false }]);
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(
      async () =>
        (await calls(page, "plugin:mobile-system|appearance_set")).at(-1)
          ?.request,
    )
    .toEqual({ dark: true });
  await page.screenshot({ path: testInfo.outputPath("dark-app-light-os.png") });
  await page.getByRole("button", { name: "跟随系统", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect
    .poll(
      async () =>
        (await calls(page, "plugin:mobile-system|appearance_set")).at(-1)
          ?.request,
    )
    .toEqual({ dark: false });
});

for (const exit of ["typed-unknown", "native-close", "reload"] as const)
  test(`approval ${exit} preserves exact request receipt and does not replay`, async ({
    page,
  }) => {
    await fixture(page, { signedIn: true, approval: true });
    await connect(page);
    await page.evaluate((exit) => {
      const api = (window as any).__TAURI__.core,
        f = (window as any).mobileFixture;
      const original = api.invoke.bind(api);
      api.invoke = async (command: string, args: any) => {
        if (
          command === "mobile_transport_http_finish" &&
          f.operations.get(args.request.operationId)?.path.endsWith("/respond")
        ) {
          f.heldResponse = true;
          if (exit === "typed-unknown")
            throw { code: "CONNECTION_LOST", delivery: "outcome_unknown" };
          return new Promise(() => {});
        }
        return original(command, args);
      };
    }, exit);
    await page.getByRole("button", { name: "允许一次", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).mobileFixture.heldResponse),
      )
      .toBe(true);
    if (exit === "reload") {
      await page.reload();
      await connect(page);
    } else if (exit === "native-close") {
      await page.evaluate(() =>
        (window as any).mobileFixture.emit("mobile-transport-closed", {
          connection: { connectionId: "fixture-connection", generation: 1 },
          code: "CONNECTION_CLOSED",
        }),
      );
      await expect(
        page.getByRole("heading", { name: "我的设备", exact: true }),
      ).toBeVisible();
      await connect(page);
    }
    await expect(
      page.getByText(
        "上次回应结果未知，电脑可能已经收到。请先核对审批或问题状态，避免重复回应。",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "允许一次", exact: true }),
    ).toBeDisabled();
    const writes = async () =>
      (await calls(page, "mobile_transport_http_begin")).filter((c: any) =>
        c.request.path.endsWith("/respond"),
      ).length;
    const before = await writes();
    await page
      .getByRole("button", { name: "刷新会话记录", exact: true })
      .click();
    await expect(
      page.getByText(
        "上次回应结果未知，电脑可能已经收到。请先核对审批或问题状态，避免重复回应。",
      ),
    ).toBeVisible();
    expect(await writes()).toBe(before);
    await page
      .getByRole("button", { name: "已核对，解除回应保护", exact: true })
      .click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "允许一次", exact: true }),
    ).toBeDisabled();
  });

test("native question response returns exact answers to its original tool request", async ({
  page,
}) => {
  await fixture(page, { signedIn: true, question: true });
  await connect(page);
  await page
    .getByRole("button", { name: "移动端 只实施手机界面", exact: true })
    .click();
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...(window as any).mobileFixture.operations.values()]
          .filter((op: any) => op.path.endsWith("/respond"))
          .map((op: any) => JSON.parse(new TextDecoder().decode(op.body))),
      ),
    )
    .toEqual([
      {
        request_id: 18,
        result: { answers: { scope: { answers: ["移动端"] } } },
      },
    ]);
  await expect(
    page.getByRole("button", { name: "已提交", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) =>
        k.includes("mobile-uncertain-response"),
      ),
    ),
  ).toHaveLength(0);
});

test("native child composer shares the session receipt guard", async ({
  page,
}) => {
  await fixture(page, { signedIn: true, subagent: true });
  await connect(page);
  await page.locator('summary[aria-label="更多会话工具"]').click();
  await page.getByRole("button", { name: "子 Agent", exact: true }).click();
  await page
    .getByRole("button", { name: "查看子 Agent：Child worker", exact: true })
    .click();
  const region = page.getByRole("region", {
    name: "子 Agent 会话：Child worker",
    exact: true,
  });
  await page.evaluate(() => {
    const api = (window as any).__TAURI__.core,
      f = (window as any).mobileFixture;
    const original = api.invoke.bind(api);
    api.invoke = async (command: string, args: any) => {
      if (
        command === "mobile_transport_http_finish" &&
        f.operations.get(args.request.operationId)?.path ===
          "/api/sessions/child-session/messages"
      )
        throw { code: "CONNECTION_LOST", delivery: "outcome_unknown" };
      return original(command, args);
    };
  });
  await region
    .getByRole("textbox", { name: "给 Child worker 发送消息", exact: true })
    .fill("only child draft");
  await region.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    region.getByText(
      "上次发送结果未知，电脑可能已经收到。请核对会话记录，避免重复发送。",
    ),
  ).toBeVisible();
  await expect(
    region.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  const writes = await page.evaluate(() =>
    [...(window as any).mobileFixture.operations.values()]
      .filter((op: any) => op.path.endsWith("/messages"))
      .map((op: any) => op.path),
  );
  expect(writes).toEqual(["/api/sessions/child-session/messages"]);
});

for (const mode of ["light", "dark"] as const) {
  test(`mobile image portal respects ${mode} native bands through rotation, IME and rerenders`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.setItem(
        "ra.appearance-v1",
        JSON.stringify({
          mode,
          background: mode === "dark" ? "#ffffff" : "#171717",
        }),
      );
    }, mode);
    await fixture(page, { signedIn: true });
    await connect(page);
    const emitInsets = async (
      revision: number,
      landscape = false,
      keyboard = false,
    ) => {
      await page.evaluate(
        ({ revision, landscape, keyboard }) => {
          const f = (window as any).mobileFixture;
          f.emit("mobile-system-insets", {
            ...f.insets,
            revision,
            systemBars: landscape
              ? { top: 18, right: 0, bottom: 16, left: 0 }
              : { top: 28, right: 16, bottom: 32, left: 12 },
            cutout: landscape
              ? { top: 0, right: 20, bottom: 0, left: 32 }
              : f.insets.cutout,
            ime: { top: 0, right: 0, bottom: keyboard ? 180 : 0, left: 0 },
            imeVisible: keyboard,
          });
        },
        { revision, landscape, keyboard },
      );
    };
    const checkBounds = async (
      selector: string,
      landscape = false,
      keyboard = false,
    ) => {
      await expect
        .poll(() =>
          page.locator(selector).evaluate((el) => {
            const b = el.getBoundingClientRect();
            return {
              top: b.top,
              right: innerWidth - b.right,
              bottom: innerHeight - b.bottom,
              left: b.left,
              topCovered: !!document
                .elementFromPoint(innerWidth / 2, 5)
                ?.closest(".image-viewer,.image-editor"),
              bottomCovered: !!document
                .elementFromPoint(innerWidth / 2, innerHeight - 5)
                ?.closest(".image-viewer,.image-editor"),
              band: getComputedStyle(document.querySelector(".mobile-client")!)
                .backgroundColor,
              portalled: el.parentElement === document.body,
            };
          }),
        )
        .toEqual({
          top: landscape ? 18 : 28,
          right: landscape ? 20 : 16,
          bottom: keyboard ? 180 : landscape ? 16 : 32,
          left: landscape ? 32 : 12,
          topCovered: false,
          bottomCovered: false,
          band: mode === "dark" ? "rgb(23, 23, 23)" : "rgb(255, 255, 255)",
          portalled: true,
        });
    };
    const reachable = async (name: string) => {
      const control = page.getByRole("button", { name, exact: true });
      await control.scrollIntoViewIfNeeded();
      expect(
        await control.evaluate((el) => {
          const b = el.getBoundingClientRect();
          const dialog = el.closest("[role=dialog]")!.getBoundingClientRect();
          const hit = document.elementFromPoint(
            b.x + b.width / 2,
            b.y + b.height / 2,
          );
          return (
            b.top >= dialog.top &&
            b.bottom <= dialog.bottom &&
            b.left >= dialog.left &&
            b.right <= dialog.right &&
            !!hit &&
            el.contains(hit)
          );
        }),
      ).toBe(true);
    };
    await emitInsets(100);
    // A real local image attachment opens the shared viewer/editor, not a mocked dialog.
    const image = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 120;
      canvas.getContext("2d")!.fillStyle = "#b5b5b5";
      canvas.getContext("2d")!.fillRect(0, 0, 160, 120);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "fixture.png",
        mimeType: "image/png",
        buffer: Buffer.from(image, "base64"),
      });
    await expect(page.locator(".upload-status")).toHaveCount(0);
    await page.getByRole("button", { name: "查看图片", exact: true }).click();
    await checkBounds(".image-viewer");
    await reachable("关闭图片查看器");
    await reachable("下载图片");
    await page.getByRole("button", { name: "放大图片", exact: true }).click();
    await expect(page.getByLabel("图片缩放比例", { exact: true })).toHaveText(
      "125%",
    );
    await checkBounds(".image-viewer");

    await page.setViewportSize({ width: 852, height: 393 });
    await emitInsets(101, true);
    await checkBounds(".image-viewer", true);
    await reachable("关闭图片查看器");
    await emitInsets(102, true, true);
    await checkBounds(".image-viewer", true, true);
    await reachable("适应窗口");
    await reachable("编辑图片");
    await page.getByRole("button", { name: "编辑图片", exact: true }).click();
    await checkBounds(".image-editor", true, true);
    await reachable("取消编辑");
    await reachable("画笔");
    await page.getByRole("button", { name: "画笔", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "画笔", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    // Old orientation/keyboard snapshots must not undo the current bounds on rerender.
    await emitInsets(101);
    await checkBounds(".image-editor", true, true);
    await reachable("放大画布");
    await reachable("完成");
    await reachable("取消编辑");
    await page.screenshot({
      path: testInfo.outputPath("image-editor-landscape-ime.png"),
    });
    await page.getByRole("button", { name: "取消编辑", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "编辑图片", exact: true }),
    ).toHaveCount(0);

    await page.setViewportSize({ width: 393, height: 851 });
    await emitInsets(103);
    await page.getByRole("button", { name: "查看图片", exact: true }).click();
    await checkBounds(".image-viewer");
    await emitInsets(102, true, true);
    await page.getByRole("button", { name: "适应窗口", exact: true }).click();
    await checkBounds(".image-viewer");
    await reachable("关闭图片查看器");
    await page
      .getByRole("button", { name: "关闭图片查看器", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "图片查看器", exact: true }),
    ).toHaveCount(0);
  });
}
