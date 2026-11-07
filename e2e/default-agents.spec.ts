import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, legacy = false, delayInitial = false) {
  let configured = false;
  const writes: unknown[] = [];
  let pluginRequests = 0;
  let releaseInitial!: () => void;
  const initialPending = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    if (route.request().method() !== "GET") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({
        status: 400,
        json: { error: "fixture does not execute native commands" },
      });
    }
    let data: unknown = {};
    if (path === "/info") data = { workspace: "/work", hostname: "fixture" };
    else if (path === "/plugins")
      data = {
        plugins: ["codex", "deepseek-harness", "workbuddy"].map((id) => ({
          id,
          name:
            id === "codex"
              ? "Codex"
              : id === "workbuddy"
                ? "WorkBuddy"
                : "DeepSeek Harness",
          capabilities: ["chat"],
          protocol_version: 1,
          ...(!legacy ? { available: id === "codex" || configured } : {}),
        })),
      };
    else if (path === "/sessions") data = { sessions: [] };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path === "/events/poll") data = { events: [], cursor: 0 };
    else if (path === "/events")
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": heartbeat\n\n",
      });
    if (path === "/plugins" && ++pluginRequests === 1 && delayInitial)
      await initialPending;
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({ url: location.origin, token: "default-agent-fixture" }),
    ),
  );
  await page.goto("/");
  return {
    writes,
    releaseInitial,
    configure: () => {
      configured = true;
    },
  };
}

async function openCreate(page: Page) {
  await page.getByRole("button", { name: "开始新会话", exact: true }).click();
  return page.getByRole("dialog", { name: "新建会话" });
}

test("all default integrations remain selectable when their local entry is not configured", async ({
  page,
}) => {
  const { writes, configure } = await fixture(page);
  const dialog = await openCreate(page);
  const select = dialog.getByLabel("Agent", { exact: true });
  await expect(select.locator("option")).toHaveCount(3);
  await expect(select).toHaveValue("codex");
  const submit = dialog.getByRole("button", { name: "创建会话" });
  await expect(submit).toBeEnabled();
  for (const id of ["deepseek-harness", "workbuddy"]) {
    await select.selectOption(id);
    await expect(select).toHaveValue(id);
    await expect(select.locator(`option[value="${id}"]`)).toContainText(
      "待连接",
    );
    await expect(dialog.getByRole("status")).toContainText("插件已启用");
    await expect(dialog.getByRole("status")).toContainText("重新检查连接");
    await expect(submit).toBeDisabled();
    // Native submission remains blocked even by keyboard form submission.
    await dialog.getByLabel("工作目录", { exact: true }).press("Enter");
    expect(writes).toEqual([]);
  }
  configure();
  await dialog.getByRole("button", { name: "重新检查连接" }).click();
  await expect(select).toHaveValue("workbuddy");
  await expect(submit).toBeEnabled();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("older catalogs without availability metadata retain usable chooser behavior", async ({
  page,
}) => {
  const { writes } = await fixture(page, true);
  const dialog = await openCreate(page);
  for (const id of ["deepseek-harness", "workbuddy"]) {
    await dialog.getByLabel("Agent", { exact: true }).selectOption(id);
    await expect(
      dialog.getByRole("button", { name: "创建会话" }),
    ).toBeEnabled();
    await expect(dialog.getByRole("status")).toHaveCount(0);
  }
  expect(writes).toEqual([]);
});

test("a late initial catalog cannot overwrite an explicit connection recheck", async ({
  page,
}) => {
  const { configure, releaseInitial, writes } = await fixture(
    page,
    false,
    true,
  );
  const dialog = await openCreate(page);
  await expect(dialog.getByLabel("Agent", { exact: true })).toBeDisabled();
  configure();
  await dialog.getByRole("button", { name: "重新检查连接" }).click();
  const select = dialog.getByLabel("Agent", { exact: true });
  await select.selectOption("workbuddy");
  await expect(dialog.getByRole("button", { name: "创建会话" })).toBeEnabled();
  const oldCatalog = page.waitForResponse((response) =>
    response.url().endsWith("/api/plugins"),
  );
  releaseInitial();
  await oldCatalog;
  await expect(select).toHaveValue("workbuddy");
  await expect(dialog.getByRole("button", { name: "创建会话" })).toBeEnabled();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  expect(writes).toEqual([]);
});
