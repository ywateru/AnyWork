import { test, expect } from "@playwright/test";
import { manager } from "./desktop-fixture";

for (const [width, height] of [
  [1440, 1000],
  [960, 720],
  [800, 620],
  [390, 844],
]) {
  test(`connection map and popup remain usable at ${width}×${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: "dark" });
    await manager(page, { owned: true, lan: true, changed: true });
    await expect(
      page.getByRole("heading", { name: "Codex", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Cursor|Claude Code/)).toHaveCount(0);
    await expect(page.locator(".route-node")).toHaveCount(3);
    await expect(page.locator(".overview-footer, .host-service")).toHaveCount(
      0,
    );
    await expect(
      page.getByText("工作环境与文件保留在本机", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".host-node")).toContainText("127.0.0.1:3210");
    await expect(page.locator(".agent-node")).toContainText("fixture");
    const address = page
      .getByRole("button", { name: "匿名隧道详情" })
      .locator(".route-address");
    await expect(address).toBeVisible();
    await expect(address).toHaveText("fixture.trycloudflare.com");
    await expect(address).toHaveAttribute(
      "title",
      "https://fixture.trycloudflare.com",
    );
    expect(
      await page
        .locator(".route-nodes")
        .evaluate((el) => getComputedStyle(el).borderTopWidth),
    ).toBe("0px");
    expect(
      await page
        .locator("html")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(255, 255, 255)");
    if (width >= 800) {
      const hub = await page.locator(".host-node").boundingBox();
      const stop = await page
        .getByRole("button", { name: "停止服务", exact: true })
        .boundingBox();
      expect(stop!.y).toBeGreaterThanOrEqual(hub!.y + hub!.height);
      await expect(page.locator(".network-lines > path")).toHaveCount(5);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: info.outputPath(`overview-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "匿名隧道详情" }).click();
    const popup = page.getByRole("dialog", { name: "匿名隧道", exact: true });
    await expect(
      popup.getByText("https://fixture.trycloudflare.com", { exact: true }),
    ).toBeVisible();
    const rect = await popup.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(15);
    expect(rect!.y).toBeGreaterThanOrEqual(15);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width - 15);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(height - 15);
    await page.screenshot({
      path: info.outputPath(`detail-${width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "匿名隧道详情" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "固定隧道详情" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "查看配置", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "公开 HTTPS 地址" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.mouse.click(3, 3);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("the three routes toggle independently, including stopping only the selected route", async ({
  page,
}) => {
  await manager(page, { available: true });
  await page.getByRole("switch", { name: "匿名隧道开关" }).click();
  await expect(
    page.getByRole("switch", { name: "匿名隧道开关" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("switch", { name: "固定隧道开关" }).click();
  for (const name of [
    "匿名隧道开关",
    "固定隧道开关",
    "WireGuard + TLS 中继开关",
  ])
    await expect(page.getByRole("switch", { name })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  await page.getByRole("button", { name: "固定隧道详情" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭此连接" })
    .click();
  await expect(
    page.getByRole("switch", { name: "固定隧道开关" }),
  ).toHaveAttribute("aria-checked", "false");
  await expect(
    page.getByRole("switch", { name: "匿名隧道开关" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("switch", { name: "WireGuard + TLS 中继开关" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("opening or switching details sends no engine commands and only one popup stays open", async ({
  page,
}) => {
  await manager(page);
  const quick = page.getByRole("button", { name: "匿名隧道详情" });
  await quick.click();
  await quick.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await quick.click();
  // Switch via keyboard, including when a popup overlaps the next card.
  await page.getByRole("button", { name: "固定隧道详情" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(
    page.getByRole("dialog", { name: "固定隧道", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { desktopCalls: string[] }).desktopCalls,
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
});

test("an unconfigured route opens its form without sending a start command", async ({
  page,
}) => {
  await manager(page, { unconfigured: true, available: true });
  await page.getByRole("switch", { name: "固定隧道开关" }).click();
  await expect(
    page.getByRole("textbox", { name: "公开 HTTPS 地址" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { desktopCalls: string[] }).desktopCalls,
    ),
  ).toEqual([]);
  await page
    .getByRole("textbox", { name: "公开 HTTPS 地址" })
    .fill("https://new.example.com");
  await page
    .getByRole("textbox", { name: "连接器令牌" })
    .fill("new-fixture-token");
  await page.waitForTimeout(1200); // A snapshot poll must not replace an unsaved draft.
  await expect(
    page.getByRole("textbox", { name: "公开 HTTPS 地址" }),
  ).toHaveValue("https://new.example.com");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  const start = page.getByRole("button", { name: "保存并开启", exact: true });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(
    page.getByRole("switch", { name: "固定隧道开关" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(
    await page.evaluate(
      () => (window as unknown as { desktopCalls: string[] }).desktopCalls,
    ),
  ).toEqual([
    "save_route:named",
    "desktop_cloudflared_status",
    "start_route:named",
  ]);
});

test("service controls stay at the host and respect external service ownership", async ({
  page,
}) => {
  await manager(page, { off: true, available: true });
  await expect(
    page.getByRole("switch", { name: "匿名隧道开关" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "启动服务", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止服务", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止服务", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "启动服务", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "匿名隧道开关" }),
  ).toBeDisabled();
});

test("verified connection details support copying, opening and Android QR pairing", async ({
  page,
}) => {
  await manager(page, { changed: true, lan: true });
  await page.getByRole("button", { name: "匿名隧道详情" }).click();
  await page.getByRole("button", { name: "复制访问地址", exact: true }).click();
  await page.getByRole("button", { name: "打开网页", exact: true }).click();
  await page.getByRole("button", { name: "生成二维码", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "连接 AnyWork Android" });
  await expect(
    dialog.getByRole("img", { name: "AnyWork Android 配对二维码" }),
  ).toBeVisible();
  await expect(dialog).toContainText("https://fixture.trycloudflare.com");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "局域网访问详情" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "http://192.0.2.10:3210",
  );
});

test("node settings lead to working configuration and save feedback stays visible", async ({
  page,
}) => {
  await manager(page, { off: true });
  await page.getByRole("button", { name: "配置工作目录", exact: true }).click();
  const workspace = page.getByRole("textbox", {
    name: "工作目录",
    exact: true,
  });
  await workspace.fill("/fixture/new-workspace");
  await page.getByRole("button", { name: "保存服务配置", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "配置已保存" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "总览", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "配置工作目录", exact: true }),
  ).toContainText("new-workspace");
  await page.getByRole("button", { name: "本地服务详情", exact: true }).click();
  const local = page.getByRole("dialog", { name: "本地服务", exact: true });
  await expect(
    local.getByRole("button", { name: "打开工作台", exact: true }),
  ).toBeDisabled();
  await local
    .getByRole("button", { name: "查看服务配置", exact: true })
    .click();
  await expect(
    local.getByRole("textbox", { name: "工作目录", exact: true }),
  ).toHaveValue("/fixture/new-workspace");
});

test("settings save failures give visible feedback", async ({ page }) => {
  await manager(page, { off: true, failSave: true });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "保存服务配置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "保存失败，请检查配置后重试。",
  );
});

test("long route URLs truncate inside their card while details retain the full address", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 620 });
  const url =
    "https://a-very-long-anonymous-tunnel-name-for-anywork.trycloudflare.com";
  await manager(page, { changed: true });
  await page.evaluate((value) => {
    const fixture = (
      window as unknown as { desktopFixture: { routes: { url: string }[] } }
    ).desktopFixture;
    fixture.routes[0].url = value;
  }, url);
  const card = page.getByRole("button", { name: "匿名隧道详情" });
  const address = card.locator(".route-address");
  await expect(address).toHaveAttribute("title", url);
  expect(await address.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  expect(
    await address.evaluate((el) => getComputedStyle(el).textOverflow),
  ).toBe("ellipsis");
  await card.click();
  await expect(
    page.getByRole("dialog").getByText(url, { exact: true }),
  ).toBeVisible();
});
