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
  await page.getByRole("button", { name: "返回", exact: true }).click();
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
  await page
    .getByRole("button", { name: "打开本地工作区", exact: true })
    .click();
  expect(await calls(page)).toEqual(["desktop_start", "desktop_open"]);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "本机端口", exact: true }),
  ).toHaveValue("8531");
});

test("missing service snapshot suspends readiness without another start", async ({
  page,
}) => {
  await manager(page);
  await page.evaluate(
    () =>
      ((
        window as unknown as { desktopSnapshotFailure: boolean }
      ).desktopSnapshotFailure = true),
  );
  await expect(page.getByText(/本机状态暂不可用/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开本地工作区", exact: true }),
  ).toHaveCount(0);
  expect(await calls(page)).toEqual(["desktop_start"]);
});

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
  expect(await calls(page)).toEqual(["desktop_start"]);
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

test("remote portal comes from the public snapshot and copies only its bare HTTPS address", async ({
  page,
}) => {
  await clipboard(page);
  await manager(page, { portal: "https://selfhost.fixture.invalid/app/" });
  await expect(page.getByTestId("account-portal")).toHaveText(
    "https://selfhost.fixture.invalid/app/",
  );
  await page.getByRole("button", { name: "复制账号入口", exact: true }).click();
  expect(await copied(page)).toEqual(["https://selfhost.fixture.invalid/app/"]);
  await expect(page.getByText("账号入口已复制", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开账号入口", exact: true }).click();
  expect(await calls(page)).toEqual([
    "desktop_start",
    "desktop_account_portal",
  ]);
});
for (const portal of [
  "",
  "http://localhost:3000/app/",
  "https://u:p@fixture.invalid/app/",
  "https://fixture.invalid/app/?token=fixture",
  "https://fixture.invalid/app/#ticket=fixture",
  "not a URL",
]) {
  test(`unsafe or missing portal is unavailable ${portal}`, async ({
    page,
  }) => {
    await clipboard(page);
    await manager(page, { portal });
    await expect(page.getByTestId("account-portal")).toHaveText(
      "账号入口暂不可用",
    );
    await expect(
      page.getByRole("button", { name: "复制账号入口", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "打开账号入口", exact: true }),
    ).toBeDisabled();
    expect(await copied(page)).toEqual([]);
  });
}
