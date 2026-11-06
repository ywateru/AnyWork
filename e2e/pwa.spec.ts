import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("updates are nonblocking, version-aware and remember Later across reloads", async ({
  page,
}) => {
  const root = resolve(process.env.ANYWORK_E2E_WEB_DIR ?? "web/dist");
  const original = await readFile(resolve(root, "sw.js"), "utf8");
  let generation = "";
  let pageVersion: string | null = null;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    try {
      if (path === "/sw.js") {
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Cache-Control", "no-store");
        res.end(
          original.replace(/anywork-[a-f0-9]{16}/g, (v) => v + generation),
        );
        return;
      }
      const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
      if (!file.startsWith(root + "/")) {
        res.writeHead(404).end();
        return;
      }
      const ext = file.split(".").pop();
      res.setHeader(
        "Content-Type",
        (
          {
            js: "application/javascript",
            css: "text/css",
            html: "text/html",
            svg: "image/svg+xml",
            webmanifest: "application/manifest+json",
          } as Record<string, string>
        )[ext!] || "application/octet-stream",
      );
      const bytes = await readFile(file);
      res.end(
        path === "/" && pageVersion
          ? bytes
              .toString()
              .replace(
                /(<meta name="app-version" content=")[^"]+/,
                "$1" + pageVersion,
              )
          : bytes,
      );
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  try {
    await page.goto(origin);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(page.getByRole("status", { name: "应用更新" })).toHaveCount(0);
    generation = "-next";
    await page.evaluate(async () => {
      const r = await navigator.serviceWorker.ready;
      await r.update();
    });
    const notice = page.getByRole("status", { name: "应用更新" });
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "稍后" }).click();
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("ra.dismissed-update")),
      )
      .toContain("-next");
    await page.waitForTimeout(1800);
    await expect(notice).toHaveCount(0);
    pageVersion = original.match(/anywork-[a-f0-9]{16}/)![0] + "-next";
    await page.evaluate(() => localStorage.removeItem("ra.dismissed-update"));
    await page.reload();
    await page.waitForTimeout(1800);
    await expect(notice).toHaveCount(0);
    generation = "-third";
    await page.evaluate(async () => {
      const r = await navigator.serviceWorker.ready;
      await r.update();
    });
    await expect(notice).toBeVisible();
    await Promise.all([
      page.waitForEvent("load"),
      notice.getByRole("button", { name: "重新加载" }).click(),
    ]);
    expect(dialogs).toBe(0);
    // A new document containing the same version as the waiting worker needs no notice.
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
