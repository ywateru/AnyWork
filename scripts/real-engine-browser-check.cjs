const { chromium, expect } = require("@playwright/test");
const fs = require("fs");
const info = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true }),
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  const checks = [],
    token = "isolated-real-engine-browser-fixture",
    headers = { Authorization: "Bearer " + token };
  try {
    const created = await context.request.post(info.url + "/api/sessions", {
      headers,
      data: {
        cwd: info.workspace,
        agent: "codex",
        title: "AnyWork isolated real engine acceptance",
        model: "shared-probe",
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { session } = await created.json();
    await context.addInitScript(
      ({ url, token }) => {
        localStorage.setItem("ra.connection", JSON.stringify({ url, token }));
        localStorage.setItem("ra.sidebar-pinned", "false");
      },
      { url: info.url, token },
    );
    await page.goto(info.url + "/#" + session.id);
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    await expect(input).toBeEditable({ timeout: 20000 });
    const send = async (text) => {
      await input.fill(text);
      await page.getByTitle("发送", { exact: true }).click();
    };
    const exported = async () => {
      const r = await context.request.get(
        info.url + "/api/sessions/" + session.id + "/export",
        { headers },
      );
      return r.json();
    };
    await send("Return the local fixture answer.");
    await expect(
      page.getByText("Shared engine complete.", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    checks.push("real_codex_answer_visible_in_browser");
    await context.request.get(info.model + "/control/plan/approval");
    await send("Ask for the isolated fixture permission.");
    const card = page.locator("[data-codex-approval-surface]");
    await expect(card).toBeVisible({ timeout: 30000 });
    await card.locator("button.request-deny").click();
    await expect(card).toHaveCount(0, { timeout: 10000 });
    checks.push("real_codex_approval_declined_via_web");
    await expect
      .poll(
        async () => {
          const d = await exported();
          return d.events.filter((e) => e.method === "turn/completed").length;
        },
        { timeout: 30000 },
      )
      .toBeGreaterThanOrEqual(2);
    await context.request.get(info.model + "/control/plan/hold");
    await send("Hold the local response to verify guidance.");
    await expect
      .poll(
        async () => {
          const r = await context.request.get(info.model + "/control/status");
          return (await r.json()).holding;
        },
        { timeout: 20000 },
      )
      .toBe(true);
    await send("Continue the same task with this guidance.");
    const queue = page.getByLabel("排队消息", { exact: true });
    await expect(queue).toContainText(
      "Continue the same task with this guidance.",
    );
    await queue.getByRole("button", { name: "引导", exact: true }).click();
    await expect(queue).toHaveCount(0, { timeout: 15000 });
    checks.push("running_turn_guided_from_native_web_queue");
    await expect
      .poll(
        async () => {
          const d = await exported();
          return d.events.filter((e) => e.method === "turn/completed").length;
        },
        { timeout: 30000 },
      )
      .toBeGreaterThanOrEqual(3);
    await context.request.get(info.model + "/control/plan/hold");
    await send("Hold for explicit interruption.");
    await expect
      .poll(
        async () => {
          const r = await context.request.get(info.model + "/control/status");
          return (await r.json()).holding;
        },
        { timeout: 20000 },
      )
      .toBe(true);
    await page.getByTitle("中断", { exact: true }).click();
    await context.request.get(info.model + "/control/release");
    await expect
      .poll(
        async () => {
          const d = await exported();
          return d.events.filter((e) => e.method === "turn/completed").length;
        },
        { timeout: 30000 },
      )
      .toBeGreaterThanOrEqual(4);
    checks.push("real_codex_interrupt_from_web");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=",
      "base64",
    );
    await page
      .locator("input[type=file]")
      .setInputFiles({ name: "probe.png", mimeType: "image/png", buffer: png });
    await expect(page.locator(".image-attachment")).toBeVisible();
    await expect(page.getByText("正在上传附件…", { exact: true })).toHaveCount(
      0,
      { timeout: 10000 },
    );
    await send("Describe the attached local fixture image.");
    await expect
      .poll(
        async () => {
          const d = await exported();
          return d.events.filter((e) => e.method === "turn/completed").length;
        },
        { timeout: 30000 },
      )
      .toBeGreaterThanOrEqual(5);
    await expect(
      page
        .locator(".message.user")
        .last()
        .getByLabel("查看图片", { exact: true }),
    ).toBeVisible();
    await page
      .locator(".message.user")
      .last()
      .getByLabel("查看图片", { exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "图片查看器", exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          page.getByRole("dialog", { name: "图片查看器", exact: true }).count(),
        { intervals: [1000, 1000, 1000] },
      )
      .toBe(1);
    await page
      .getByRole("button", { name: "关闭图片查看器", exact: true })
      .click();
    checks.push("uploaded_image_roundtrip_and_gallery_in_real_thread");
    await page.getByLabel("打开子窗口", { exact: true }).click();
    await page
      .locator(".panel-launcher-menu")
      .getByRole("button", { name: "文件", exact: true })
      .click();
    await page
      .getByRole("treeitem", { name: "README.md", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Real engine browser fixture",
        exact: true,
      }),
    ).toBeVisible();
    checks.push("document_preview_in_real_codex_session");
    await page.screenshot({ path: info.screenshot, fullPage: true });
    const result = {
      engine_version: info.engine_version,
      engine: "installed_codex_cli",
      model: "local_deterministic_responses_fixture",
      isolated: true,
      checks,
    };
    fs.writeFileSync(info.report, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } catch (error) {
    await page
      .screenshot({
        path: "/private/tmp/anywork-real-web-failure.png",
        fullPage: true,
      })
      .catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
