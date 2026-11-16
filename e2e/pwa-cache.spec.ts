import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("PWA bypasses stale HTTP documents while preserving its versioned offline shell", async ({
  page,
  context,
}) => {
  const temp = await mkdtemp(join(tmpdir(), "anywork-pwa-cache-"));
  const versions = new Map<number, { html: string; worker: string }>();
  const requests: string[] = [];
  let generation = 1;
  let apiReads = 0;
  const server = createServer((req, res) => {
    requests.push(req.url!);
    const url = new URL(req.url!, "http://fixture.invalid");
    const current = versions.get(generation)!;
    if (url.pathname === "/sw.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-store",
      });
      res.end(current.worker);
    } else if (url.pathname === `/assets/entry-v${generation}.js`) {
      res.writeHead(200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-store",
      });
      res.end(
        `document.getElementById('root').textContent='version-${generation}';`,
      );
    } else if (url.pathname.startsWith("/assets/")) {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end(current.html);
    } else if (url.pathname === "/api/fixture") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ reads: ++apiReads }));
    } else if (url.pathname === "/manifest.webmanifest") {
      res.writeHead(200, { "Content-Type": "application/manifest+json" });
      res.end('{"icons":[]}');
    } else {
      // Deliberately retain an old installation's cacheable HTTP policy. The
      // generated worker must bypass it without clearing the browser profile.
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "public, max-age=7200",
      });
      res.end(current.html);
    }
  });
  try {
    for (const version of [1, 2, 3]) {
      const directory = join(temp, `v${version}`);
      await mkdir(join(directory, "assets"), { recursive: true });
      await writeFile(
        join(directory, "index.html"),
        `<!doctype html><head></head><body><div id="root"></div><script type="module" src="/assets/entry-v${version}.js"></script></body>`,
      );
      await writeFile(join(directory, "manifest.webmanifest"), '{"icons":[]}');
      await writeFile(
        join(directory, `assets/entry-v${version}.js`),
        `// generation ${version}`,
      );
      await promisify(execFile)(
        process.execPath,
        [resolve("web/scripts/pwa.mjs"), directory],
        { env: { ...process.env, ANYWORK_WEB_BASE: "/" } },
      );
      versions.set(version, {
        html: await readFile(join(directory, "index.html"), "utf8"),
        worker: await readFile(join(directory, "sw.js"), "utf8"),
      });
    }
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as { port: number };
    const origin = `http://127.0.0.1:${port}`;
    await page.goto(origin);
    await expect(page.locator("#root")).toHaveText("version-1");
    await page.evaluate(async () => {
      localStorage.setItem("fixture.draft", "draft-kept");
      await fetch("/index.html");
    });
    generation = 2;
    const stale = await context.newPage();
    const missing = stale.waitForResponse((response) =>
      response.url().endsWith("/assets/entry-v1.js"),
    );
    await stale.goto(`${origin}/#local-ticket=synthetic-fixture`);
    const response = await missing;
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).toBe("text/html");
    await expect(stale.locator("#root")).toBeEmpty();
    expect(requests.filter((url) => url === "/")).toHaveLength(1);

    // Install the actual generated v2 worker while v1 /index.html is still
    // fresh in HTTP cache. Its offline shell must contain v2 HTML and chunks.
    await stale.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js", {
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => stale.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    await context.setOffline(true);
    await stale.goto(`${origin}/offline-install`);
    await expect(stale.locator("#root")).toHaveText("version-2");

    await context.setOffline(false);
    generation = 3;
    // v2's active worker must obtain current v3 HTML even though the HTTP cache
    // still has v1 at this exact navigation key. No worker activation/reload.
    await stale.goto(origin);
    await expect(stale.locator("#root")).toHaveText("version-3");
    expect(
      await stale.evaluate(() => localStorage.getItem("fixture.draft")),
    ).toBe("draft-kept");
    const reads = await stale.evaluate(async () => {
      const first = await (await fetch("/api/fixture")).json();
      const second = await (await fetch("/api/fixture")).json();
      return [first.reads, second.reads];
    });
    expect(reads).toEqual([1, 2]);
    const cachedPaths = await stale.evaluate(async () => {
      const paths = [];
      for (const key of await caches.keys())
        for (const request of await (await caches.open(key)).keys())
          paths.push(new URL(request.url).pathname);
      return paths;
    });
    expect(cachedPaths).toContain("/index.html");
    expect(cachedPaths.some((path) => path.startsWith("/api/"))).toBe(false);
    // Online navigation must not mix v3 HTML into the active v2 offline shell.
    await context.setOffline(true);
    await stale.goto(`${origin}/offline-again`);
    await expect(stale.locator("#root")).toHaveText("version-2");
    expect(
      await stale.evaluate(() => localStorage.getItem("fixture.draft")),
    ).toBe("draft-kept");
    expect(requests.every((url) => !url.includes("local-ticket"))).toBe(true);
  } finally {
    await context.setOffline(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  }
});
