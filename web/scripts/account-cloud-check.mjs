/** Read-only account/discovery acceptance using an isolated DEV browser login. */
import { chromium } from "@playwright/test";
import { chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const state = process.env.ANYWORK_DEV_BROWSER_STATE;
if (!state)
  throw new Error(
    "Set ANYWORK_DEV_BROWSER_STATE to the private isolated DEV browser state file",
  );
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {},
);
try {
  const context = await browser.newContext({
    storageState: state,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
  });
  const page = await context.newPage(),
    results = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      (url.origin === "https://ueg42e.logto.app" &&
        url.pathname === "/api/my-account") ||
      (url.origin === "https://anywork-cybergrid-dev.vercel.app" &&
        url.pathname.startsWith("/api/v1/console/"))
    )
      results.push({ path: url.pathname, status: response.status() });
  });
  await page.goto("http://localhost:5173/app/", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "我的设备", exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".account-main .account-loading"),
  );
  if (await page.getByRole("alert").count())
    throw new Error(
      "Account UI reported an error: " +
        (await page.getByRole("alert").allTextContents()).join("; ") +
        "; observed " +
        JSON.stringify(results),
    );
  for (const path of [
    "/api/my-account",
    "/api/v1/console/auth/config",
    "/api/v1/console/auth/exchange",
    "/api/v1/console/devices",
  ])
    if (!results.some((item) => item.path === path && item.status === 200))
      throw new Error(
        "Missing successful live account/discovery boundary: " +
          path +
          "; observed " +
          JSON.stringify(results),
      );
  await mkdir(resolve("artifacts"), { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    if (
      !(await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ))
    )
      throw new Error("Horizontal overflow at " + width);
    await page.screenshot({
      path: resolve(`artifacts/anywork-account-devices-dev-${width}.png`),
    });
  }
  const add = page
    .getByRole("button", { name: "添加设备", exact: true })
    .first();
  await add.click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  if (await page.getByRole("dialog").isVisible())
    throw new Error("Add-device dialog did not close on Escape");
  // SDK refresh remains one owner. Persist only this same context's rotated grant.
  await context.storageState({ path: state });
  await chmod(state, 0o600);
  console.log(
    "Passed live DEV hosted account/discovery: Account API200, trusted Grid config200, exchange200, devices200, responsive1440/390px, add-device dialog and zero UI alerts.",
  );
} finally {
  await browser.close();
}
