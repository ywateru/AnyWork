import { test, expect, type Page } from "@playwright/test";
import { manager, calls } from "./desktop-fixture";

// Production UI and synthetic IPC. Clipboard captures only this test's writes.
async function clipboard(
  page: Page,
  mode: "success" | "fail" | "hold" = "success",
) {
  await page.addInitScript((copyMode) => {
    const scope = window as unknown as {
      copiedAddresses: string[];
      finishCopy: () => void;
    };
    scope.copiedAddresses = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          scope.copiedAddresses.push(value);
          if (copyMode === "fail") throw new Error("Fixture clipboard denied");
          if (copyMode === "hold")
            await new Promise<void>((resolve) => {
              scope.finishCopy = resolve;
            });
        },
      },
    });
  }, mode);
}
const copied = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { copiedAddresses: string[] }).copiedAddresses,
  );
const address = (page: Page) => page.getByTestId("local-address");
const copyButton = (page: Page) =>
  page.getByRole("button", { name: "复制本地地址", exact: true });

test("local address follows saved snapshots, preserves drafts and opens through the ticket IPC", async ({
  page,
}) => {
  await clipboard(page);
  await manager(page, { port: 9472 });
  await expect(address(page)).toHaveText("http://127.0.0.1:9472/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "本机端口", exact: true })
    .fill("8531");
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(address(page)).toHaveText("http://127.0.0.1:9472/");
  await page.evaluate(() => {
    (
      window as unknown as { desktopFixture: { config: { port: number } } }
    ).desktopFixture.config.port = 9473;
  });
  await expect(address(page)).toHaveText("http://127.0.0.1:9473/");
  await copyButton(page).click();
  expect(await copied(page)).toEqual(["http://127.0.0.1:9473/"]);
  await expect(page.getByText("本地地址已复制", { exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.getByText("本地地址已复制", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开工作区", exact: true }).click();
  expect(await calls(page)).toEqual(["desktop_open"]);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "本机端口", exact: true }),
  ).toHaveValue("8531");
});

for (const options of [
  { off: true },
  { unauthorized: true },
  { snapshotUnavailable: true },
]) {
  test(`copy requires an authorized running snapshot ${JSON.stringify(options)}`, async ({
    page,
  }) => {
    await clipboard(page);
    await manager(page, options);
    await expect(copyButton(page)).toBeDisabled();
    if (options.snapshotUnavailable)
      await expect(address(page)).toHaveText("地址暂不可用");
    else
      await expect(
        page.getByText("已配置，服务就绪后可使用。", { exact: true }),
      ).toBeVisible();
    expect(await copied(page)).toEqual([]);
    expect(await calls(page)).toEqual([]);
  });
}

for (const port of [1023, 65536, 9000.5]) {
  test(`invalid snapshot port ${port} has no guessed local address`, async ({
    page,
  }) => {
    await clipboard(page);
    await manager(page, { port });
    await expect(address(page)).toHaveText("地址暂不可用");
    await expect(copyButton(page)).toBeDisabled();
    expect(await copied(page)).toEqual([]);
  });
}

test("clipboard failure gives fixed feedback without navigating or exposing credentials", async ({
  page,
}) => {
  await clipboard(page, "fail");
  await manager(page, { port: 65535 });
  await copyButton(page).click();
  await expect(
    page.getByText("未能复制，请选中上方地址手动复制。", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(
    page.getByText("未能复制，请选中上方地址手动复制。", { exact: true }),
  ).toBeVisible();
  expect(await copied(page)).toEqual(["http://127.0.0.1:65535/"]);
  expect(await calls(page)).toEqual([]);
});

test("an asynchronous copy cannot claim success for a changed address", async ({
  page,
}) => {
  await clipboard(page, "hold");
  await manager(page, { port: 1024 });
  await copyButton(page).click();
  await expect.poll(() => copied(page)).toEqual(["http://127.0.0.1:1024/"]);
  await page.evaluate(() => {
    (
      window as unknown as { desktopFixture: { config: { port: number } } }
    ).desktopFixture.config.port = 1025;
  });
  await expect(address(page)).toHaveText("http://127.0.0.1:1025/");
  await page.evaluate(() =>
    (window as unknown as { finishCopy: () => void }).finishCopy(),
  );
  await expect(page.getByText("本地地址已复制", { exact: true })).toHaveCount(
    0,
  );
  await copyButton(page).click();
  await expect.poll(() => copied(page)).toHaveLength(2);
  await page.evaluate(() =>
    (window as unknown as { finishCopy: () => void }).finishCopy(),
  );
  await expect(page.getByText("本地地址已复制", { exact: true })).toBeVisible();
  expect(await copied(page)).toEqual([
    "http://127.0.0.1:1024/",
    "http://127.0.0.1:1025/",
  ]);
});

for (const [width, height, options, state] of [
  [1440, 1000, {}, "ready-signed-out"],
  [960, 720, { signedIn: true, enabled: true }, "remote-enabled"],
  [800, 620, { authorizing: true }, "login-pending"],
  [390, 844, { off: true, reauth: true }, "local-off-reauth"],
] as const) {
  test(`access guide ${state} at ${width}×${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await manager(page, options);
    await expect(
      page.getByRole("heading", { name: "工作原理", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/首次使用、切换浏览器或本机会话过期/),
    ).toBeVisible();
    await expect(
      page.getByText(/本客户端的账号凭据和设备私钥只留在内存/),
    ).toBeVisible();
    await expect(page.getByText(/会处理账号与必要连接元数据/)).toBeVisible();
    if (width >= 800) {
      await expect(address(page)).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "打开工作区", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole("region", { name: "远程访问设置", exact: true }),
      ).toBeInViewport();
      const left = await page
        .getByRole("region", { name: "本地工作区", exact: true })
        .boundingBox();
      const right = await page
        .getByRole("region", { name: "AnyWork 账号入口", exact: true })
        .boundingBox();
      expect(left!.y).toBe(right!.y);
      expect(left!.x + left!.width).toBeLessThan(right!.x);
    }
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: info.outputPath(`access-${state}-${width}.png`),
      fullPage: true,
    });
    if (options.enabled) {
      await page.getByText("身份核对", { exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "设备公钥", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`identity-${width}.png`),
        fullPage: true,
      });
    }
    expect(await calls(page)).toEqual([]);
  });
}
