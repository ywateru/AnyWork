import { expect, test, type Page } from "./local-fixture";
import {
  expectPromptText,
  fillPromptText,
  pastePromptText,
} from "./prompt-editor-helpers";

const headers = { Authorization: "Bearer browser-integration-test-token" };

async function fixture(page: Page, objective = "完成 AnyWork 目标编辑验收") {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const { session } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { cwd: workspace, agent: "fixture", title: "原生目标编辑验收" },
    })
  ).json();
  const endpoint = `/api/sessions/${session.id}/composer`;
  expect(
    (
      await page.request.post(endpoint, {
        headers,
        data: { action: "goal", objective },
      })
    ).ok(),
  ).toBe(true);
  await page.addInitScript(() => {
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  await page.goto(`/#${session.id}`);
  const banner = page.locator(".goal-banner");
  await expect(banner).toBeVisible();
  return { session, endpoint, banner, objective };
}

const panel = (page: Page) => page.locator(".goal-editor-panel");
const goalInput = (page: Page) =>
  panel(page).getByRole("textbox", { name: "目标", exact: true });

async function open(page: Page) {
  await page
    .locator(".goal-banner")
    .getByRole("button", { name: "编辑目标", exact: true })
    .click();
  await expect(goalInput(page)).toBeEditable();
}

test("goal body opens the native split editor and save keeps it open without replacing the main draft", async ({
  page,
}, testInfo) => {
  const { endpoint, banner, objective } = await fixture(page);
  await page.request.post(endpoint, {
    headers,
    data: { action: "goal_status", status: "paused" },
  });
  await page.reload();
  await expect(banner).toContainText("目标已暂停");
  const main = page.getByRole("textbox", {
    name: "消息",
    exact: true,
    includeHidden: true,
  });
  await fillPromptText(main, "编辑目标时继续保留主输入草稿");
  await banner
    .getByRole("button", { name: "编辑目标正文", exact: true })
    .click();
  await expect(goalInput(page)).toBeEditable();
  await expectPromptText(goalInput(page), objective);
  await expect(
    page.getByRole("separator", { name: "调整侧栏宽度", includeHidden: true }),
  ).toBeAttached();
  await expect(
    panel(page).getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await expect(
    panel(page).getByRole("button", { name: "还原", exact: true }),
  ).toBeDisabled();
  const submitted: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/composer") && request.method() === "POST")
      submitted.push(request.postDataJSON());
  });
  await goalInput(page).press("End");
  await goalInput(page).press("Enter");
  await goalInput(page).pressSequentially("保留原生分屏交互");
  await expectPromptText(goalInput(page), `${objective}\n保留原生分屏交互`);
  expect(submitted).toEqual([]);
  await panel(page).getByRole("button", { name: "还原", exact: true }).click();
  await expectPromptText(goalInput(page), objective);
  await fillPromptText(goalInput(page), "保存新的目标正文\n同时保留主输入草稿");
  await panel(page).getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    panel(page).getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await expect(panel(page)).toContainText("刚刚更新");
  await expectPromptText(
    goalInput(page),
    "保存新的目标正文\n同时保留主输入草稿",
  );
  await expect(panel(page)).toBeVisible();
  // A rich literal paste stores hard breaks as Markdown, while the editor shows LF.
  const savedObjective = "保存新的目标正文\\\n同时保留主输入草稿";
  expect(submitted).toEqual([{ action: "goal", objective: savedObjective }]);
  const saved = await (await page.request.get(endpoint, { headers })).json();
  expect(saved.goal).toMatchObject({
    objective: savedObjective,
    status: "active",
  });
  // The conversation remains mounted behind the mobile panel, too.
  await expectPromptText(main, "编辑目标时继续保留主输入草稿");
  expect(
    await panel(page).evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/anywork-goal-editor-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.locator(".workspace-inspector .panel-close").click();
  await expect(panel(page)).toHaveCount(0);
  await expectPromptText(main, "编辑目标时继续保留主输入草稿");
  await open(page);
  await expectPromptText(
    goalInput(page),
    "保存新的目标正文\n同时保留主输入草稿",
  );
});

test("goal rich editor persists formatting, supports save shortcut and rejects empty or unchanged values", async ({
  page,
}) => {
  const { endpoint, objective } = await fixture(page);
  await open(page);
  const input = goalInput(page),
    save = panel(page).getByRole("button", { name: "保存", exact: true });
  await fillPromptText(input, "   ");
  await expect(save).toBeDisabled();
  await input.press("ControlOrMeta+s");
  expect(
    (await (await page.request.get(endpoint, { headers })).json()).goal
      .objective,
  ).toBe(objective);
  await fillPromptText(input, "");
  await pastePromptText(input, "重要目标", "<p><strong>重要目标</strong></p>");
  await expect(input.locator("strong")).toHaveText("重要目标");
  await input.press("ControlOrMeta+s");
  await expect(save).toBeDisabled();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(endpoint, { headers })).json()).goal
          .objective,
    )
    .toBe("**重要目标**");
  await expect(panel(page)).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "还原", exact: true }),
  ).toBeDisabled();
  await fillPromptText(input, "尚未保存的更改");
  await input.dispatchEvent("keydown", {
    key: "s",
    ctrlKey: true,
    repeat: true,
  });
  await expect(save).toBeEnabled();
  await panel(page).getByRole("button", { name: "还原", exact: true }).click();
  await expect(input.locator("strong")).toHaveText("重要目标");
});

test("failed saves keep the goal draft and in-flight requests cannot submit twice", async ({
  page,
}) => {
  const { endpoint } = await fixture(page);
  await open(page);
  await fillPromptText(goalInput(page), "失败后也要保留的目标草稿");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  await page.route(`**${endpoint}`, async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().action === "goal"
    ) {
      count++;
      await gate;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "目标保存暂时失败" }),
      });
    } else await route.continue();
  });
  await panel(page).getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => count).toBe(1);
  await expect(
    page.locator(".goal-banner-actions").getByRole("button", {
      name: "清除目标",
      exact: true,
      includeHidden: true,
    }),
  ).toBeDisabled();
  await expect(
    page.locator(".goal-banner-actions").getByRole("button", {
      name: "暂停目标",
      exact: true,
      includeHidden: true,
    }),
  ).toBeDisabled();
  await expect(goalInput(page)).not.toBeEditable();
  await expect(
    panel(page).getByRole("button", { name: "还原", exact: true }),
  ).toBeDisabled();
  await panel(page).dispatchEvent("keydown", { key: "s", ctrlKey: true });
  expect(count).toBe(1);
  release();
  await expect(goalInput(page)).toBeEditable();
  await expect(panel(page).getByRole("alert")).toHaveText("目标保存暂时失败");
  await expectPromptText(goalInput(page), "失败后也要保留的目标草稿");
  await expect(
    panel(page).getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  await page.unroute(`**${endpoint}`);
  await goalInput(page).press("ControlOrMeta+s");
  await expect(
    panel(page).getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
});

test("long native goals resolve their local objective file and save a fresh bounded reference", async ({
  page,
}) => {
  const objective = `# 长期目标\n\n${"任何时间，任何地点，完成任何工作。😀\n".repeat(240)}`;
  const { endpoint, banner } = await fixture(page, objective);
  const raw = (await (await page.request.get(endpoint, { headers })).json())
    .goal.objective;
  expect(raw).toMatch(
    /^Read the Codex goal objective file at .*\/attachments\/[0-9a-f-]{36}\/goal-objective\.md before continuing\.$/,
  );
  await open(page);
  await expect(goalInput(page).locator("h1")).toHaveText("长期目标");
  await expect(goalInput(page)).toContainText(
    "任何时间，任何地点，完成任何工作。",
  );
  const next = `修改长期目标\n${"核对桌面和手机上的完整编辑行为。\n".repeat(260)}`;
  await fillPromptText(goalInput(page), next);
  await panel(page).getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    panel(page).getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  const result = await (
    await page.request.get(`${endpoint}?goal_editor=true`, { headers })
  ).json();
  expect(result.goal.objective).not.toBe(raw);
  expect(result.goal.objective).toMatch(
    /^Read the Codex goal objective file at /,
  );
  expect(result.goal_objective).toBe(next.replaceAll("\n", "\\\n").trim());
  await page.reload();
  await expect(panel(page)).toBeVisible();
  await expect(banner).toBeAttached();
  await expect(goalInput(page)).toBeEditable();
  await expect(goalInput(page)).toContainText("修改长期目标");
  await expect(goalInput(page)).toContainText(
    "核对桌面和手机上的完整编辑行为。",
  );
});

test("IME save keys and a late save response cannot overwrite the next session", async ({
  page,
}) => {
  const { endpoint } = await fixture(page, "第一个会话的目标");
  await open(page);
  await fillPromptText(goalInput(page), "第一个会话正在保存的目标");
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const { session: other } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { cwd: workspace, agent: "fixture", title: "第二个目标会话" },
    })
  ).json();
  await page.request.post(`/api/sessions/${other.id}/composer`, {
    headers,
    data: { action: "goal", objective: "第二个会话独立目标" },
  });
  let release!: () => void;
  let count = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${endpoint}`, async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().action === "goal"
    ) {
      count++;
      await gate;
      await route.continue();
    } else await route.continue();
  });
  await goalInput(page).dispatchEvent("keydown", {
    key: "s",
    ctrlKey: true,
    isComposing: true,
  });
  expect(count).toBe(0);
  await expect(
    panel(page).getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  await panel(page).getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => count).toBe(1);
  await page.evaluate((id) => {
    location.hash = id;
  }, other.id);
  await expect(page.locator(".goal-banner-objective")).toHaveText(
    "第二个会话独立目标",
  );
  await expect(panel(page)).toHaveCount(0);
  await open(page);
  release();
  await expect(goalInput(page)).toBeEditable();
  await expectPromptText(goalInput(page), "第二个会话独立目标");
  await page.locator(".workspace-inspector .panel-close").click();
  const main = page.getByRole("textbox", {
    name: "消息",
    exact: true,
    includeHidden: true,
  });
  await fillPromptText(main, "第二个会话独立草稿");
  await open(page);
  await expectPromptText(goalInput(page), "第二个会话独立目标");
  await expectPromptText(main, "第二个会话独立草稿");
});
