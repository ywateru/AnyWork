import { expect, test } from "./local-fixture";

for (const group of ["directory", "status"]) {
  test(`initial ${group} list shows loading until sessions resolve`, async ({
    page,
  }, testInfo) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.addInitScript((group) => {
      localStorage.setItem("ra.group-mode-v2", group);
    }, group);
    await page.route("**/api/sessions", async (route) => {
      requests++;
      if (requests === 1) await pending;
      await route.fulfill({ json: { sessions: [] } });
    });
    await page.goto("/");
    if (testInfo.project.name === "android-web")
      await page.getByRole("button", { name: "会话列表", exact: true }).click();
    const nav = page.getByRole("navigation", { name: "工作目录与会话" });
    await expect(nav.getByRole("status")).toHaveText("正在加载会话…");
    await expect(nav).toHaveAttribute("aria-busy", "true");
    await expect(
      page.getByText("还没有会话，点击 + 开始", { exact: true }),
    ).toHaveCount(0);
    release();
    await expect(nav.getByRole("status")).toHaveCount(0);
    if (group === "status")
      await expect(nav).toContainText("还没有会话，点击 + 开始");
  });
}

test("session load failure shows retry instead of an empty state", async ({
  page,
}, testInfo) => {
  let fail = true;
  await page.route("**/api/sessions", async (route) => {
    await route.fulfill(
      fail
        ? { status: 503, json: { error: "fixture offline" } }
        : { json: { sessions: [] } },
    );
  });
  await page.goto("/");
  if (testInfo.project.name === "android-web")
    await page.getByRole("button", { name: "会话列表", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "工作目录与会话" });
  await expect(nav.getByRole("alert")).toContainText("会话加载失败");
  await expect(
    page.getByText("还没有会话，点击 + 开始", { exact: true }),
  ).toHaveCount(0);
  fail = false;
  await nav.getByRole("button", { name: "重试" }).click();
  await expect(nav.getByRole("alert")).toHaveCount(0);
});
