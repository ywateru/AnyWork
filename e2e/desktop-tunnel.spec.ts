import { test, expect, type Page } from "@playwright/test";
import { manager } from "./desktop-fixture";

const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { desktopCalls: string[] }).desktopCalls,
  );

test("reconnecting keeps the toggle on and the previous address visible, and can be stopped", async ({
  page,
}) => {
  await manager(page, { reconnecting: true });
  await page.getByRole("button", { name: "匿名隧道详情" }).click();
  const toggle = page.getByRole("switch", { name: "匿名隧道开关" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle).toBeEnabled();
  await expect(
    page
      .getByRole("button", { name: "匿名隧道详情" })
      .getByText("正在恢复连接", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/4 秒后重试启动/)).toBeVisible();
  await expect(page.getByText("上次连接地址 · 正在恢复")).toBeVisible();
  const quick = page.getByRole("dialog", { name: "匿名隧道", exact: true });
  await expect(quick.getByRole("button", { name: "打开网页" })).toBeDisabled();
  await expect(
    quick.getByRole("button", { name: "生成二维码" }),
  ).toBeDisabled();
  await toggle.click();
  await expect.poll(() => calls(page)).toContain("stop_route:quick");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(
    page.getByRole("switch", { name: "WireGuard + TLS 中继开关" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("verified replacement addresses explain that remote devices must reconnect", async ({
  page,
}) => {
  await manager(page, { changed: true });
  await page.getByRole("button", { name: "匿名隧道详情" }).click();
  await expect(
    page.getByText("匿名地址已变更，请使用下方新地址重新连接远程设备。"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "匿名隧道", exact: true })
      .getByRole("button", { name: "生成二维码" }),
  ).toBeEnabled();
});

test("missing cloudflared prompts before starting, cancellation sends no command", async ({
  page,
}) => {
  await manager(page);
  await page.getByRole("switch", { name: "匿名隧道开关" }).click();
  const dialog = page.getByRole("dialog", { name: "需要安装 cloudflared" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("无需管理员权限", { exact: false }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await calls(page)).toEqual(["desktop_cloudflared_status"]);
  await expect(
    page.getByRole("switch", { name: "匿名隧道开关" }),
  ).toHaveAttribute("aria-checked", "false");
});

test("download dialog closes with Escape and outside click", async ({
  page,
}) => {
  await manager(page);
  const toggle = page.getByRole("switch", { name: "匿名隧道开关" });
  await toggle.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await toggle.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await calls(page)).filter((c) => c.startsWith("start_route")),
  ).toEqual([]);
});

test("download completes before one automatic start and leaves other connections running", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 800, height: 620 });
  await manager(page, { hold: true });
  await page.getByRole("switch", { name: "匿名隧道开关" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: info.outputPath("cloudflared-download-dialog.png"),
  });
  await dialog.getByRole("button", { name: "下载并开启" }).click();
  await expect(dialog.getByRole("status")).toContainText("正在下载");
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(
    (await calls(page)).filter((c) => c.startsWith("start_route")),
  ).toEqual([]);
  await page.evaluate(() =>
    (window as unknown as { finishInstall: () => void }).finishInstall(),
  );
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () =>
      (await calls(page)).filter((c) => c.startsWith("start_route")),
    )
    .toEqual(["start_route:quick"]);
  expect(
    (await calls(page)).filter((c) => c === "desktop_install_cloudflared"),
  ).toHaveLength(1);
  await expect(
    page.getByRole("switch", { name: "WireGuard + TLS 中继开关" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("failed download remains retryable and never starts a tunnel", async ({
  page,
}) => {
  await manager(page, { failFirst: true });
  await page.getByRole("switch", { name: "匿名隧道开关" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "下载并开启" }).click();
  await expect(dialog.getByRole("alert")).toContainText("请检查网络后重试");
  expect(
    (await calls(page)).filter((c) => c.startsWith("start_route")),
  ).toEqual([]);
  await dialog.getByRole("button", { name: "重试下载" }).click();
  await expect
    .poll(async () =>
      (await calls(page)).filter((c) => c.startsWith("start_route")),
    )
    .toEqual(["start_route:quick"]);
});

test("installed cloudflared starts directly without downloading", async ({
  page,
}) => {
  await manager(page, { available: true });
  await page.getByRole("switch", { name: "匿名隧道开关" }).click();
  await expect
    .poll(async () => calls(page))
    .toEqual(["desktop_cloudflared_status", "start_route:quick"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("named tunnel uses the same missing-program flow", async ({ page }) => {
  await manager(page);
  await page.getByRole("switch", { name: "固定隧道开关" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("固定隧道需要 cloudflared");
  await dialog.getByRole("button", { name: "下载并开启" }).click();
  await expect
    .poll(async () =>
      (await calls(page)).filter((c) => c.startsWith("start_route")),
    )
    .toEqual(["start_route:named"]);
});

test("unsupported architectures offer a manual path and disable download", async ({
  page,
}) => {
  await manager(page, { supported: false });
  await page.getByRole("switch", { name: "匿名隧道开关" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "此系统架构暂不支持自动下载",
  );
  await expect(page.getByRole("button", { name: "下载并开启" })).toBeDisabled();
});
