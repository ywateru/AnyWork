// Isolated HTTP-cache regression. No installed service, browser profile or account.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

let generation = "old";
const requests = [];
const html = () =>
  `<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/${generation}.js"></script></body></html>`;
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://fixture.invalid");
  requests.push(url.pathname + url.search);
  if (url.pathname === "/") {
    // Explicit freshness makes this deterministic; the live service's heuristic
    // caching/304 mechanism has not been captured and is not asserted here.
    response.writeHead(200, {
      "Content-Type": "text/html",
      "Cache-Control": "public, max-age=3600",
    });
    response.end(html());
  } else if (url.pathname === `/assets/${generation}.js`) {
    response.writeHead(200, {
      "Content-Type": "text/javascript",
      "Cache-Control": "no-store",
    });
    response.end(
      `document.querySelector('#root').textContent=${JSON.stringify(generation)};`,
    );
  } else {
    response.writeHead(404, {
      "Content-Type": "text/html",
      "Cache-Control": "no-store",
    });
    response.end(html());
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.ANYWORK_TEST_CHROME,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    headless: true,
  });
  const context = await browser.newContext();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const warm = await context.newPage();
  await warm.goto(origin);
  assert.equal(await warm.locator("#root").textContent(), "old");
  await warm.close();
  generation = "new";
  const stale = await context.newPage();
  const missingModule = stale.waitForResponse(
    (response) => new URL(response.url()).pathname === "/assets/old.js",
  );
  await stale.goto(`${origin}/#local-ticket=synthetic-one`);
  const missing = await missingModule;
  assert.equal(missing.status(), 404);
  assert.match(missing.headers()["content-type"], /text\/html/);
  assert.equal(await stale.locator("#root").textContent(), "");
  assert.equal(requests.filter((url) => url === "/").length, 1);
  const fresh = await context.newPage();
  const nonce = randomUUID();
  await fresh.goto(
    `${origin}/?desktop-open=${nonce}#local-ticket=synthetic-two`,
  );
  assert.equal(await fresh.locator("#root").textContent(), "new");
  assert.equal(
    requests.filter((url) => url === `/?desktop-open=${nonce}`).length,
    1,
  );
  assert.ok(requests.every((url) => !url.includes("local-ticket")));
  await mkdir("artifacts/desktop-v43-remote", { recursive: true });
  const result = {
    scope: "isolated synthetic HTTP-cache fixture; not live 304 reproduction",
    staleDocumentReused: true,
    removedModuleStatus: missing.status(),
    removedModuleContentType: missing.headers()["content-type"],
    staleRootEmpty: true,
    uniqueQueryRenderedCurrentModule: true,
    ticketAbsentFromHttpRequests: true,
    automaticReloadOrTicketReplay: false,
  };
  await writeFile(
    "artifacts/desktop-v43-remote/workspace-entry-cache.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
