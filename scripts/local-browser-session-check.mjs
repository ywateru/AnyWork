// Actual isolated HTTP + browser-cookie + PTY regression. No real user profile or service.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";
const root = path.resolve(import.meta.dirname, "..");
const binary = process.argv[2] ?? path.join(root, "target/debug/anywork");
const baseDir = await fs.mkdtemp(
  path.join(os.tmpdir(), "anywork-local-browser-"),
);
const socket = net.createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const workspace = path.join(baseDir, "workspace"),
  plugins = path.join(baseDir, "plugins"),
  web = path.join(baseDir, "web");
for (const dir of [workspace, plugins, web]) await fs.mkdir(dir);
await fs.writeFile(
  path.join(web, "index.html"),
  "<!doctype html><title>Isolated local browser</title><p>Local session fixture</p>",
);
await fs.writeFile(
  path.join(plugins, "fixture.json"),
  JSON.stringify({
    id: "fixture",
    name: "Fixture",
    protocol_version: 1,
    command: "python3",
    args: [path.join(root, "scripts/fake-agent.py")],
    capabilities: ["chat"],
  }),
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !["HOME", "USERPROFILE", "CODEX_HOME", "CODEX_BIN"].includes(key) &&
      !key.startsWith("ANYWORK_") &&
      !key.startsWith("REMOTE_AGENT_") &&
      !key.startsWith("FAKE_AGENT_"),
  ),
);
const bearer = "isolated-local-browser-bearer";
const child = spawn(
  binary,
  [
    "--codex-discovery",
    "false",
    "--bind",
    `127.0.0.1:${port}`,
    "--workspace",
    workspace,
    "--data-dir",
    path.join(baseDir, "data"),
    "--plugins-dir",
    plugins,
    "--web-dir",
    web,
    "--token",
    bearer,
  ],
  { env, stdio: "ignore" },
);
let browser;
const headers = {
  authorization: `Bearer ${bearer}`,
  "x-anywork-service-control": "desktop",
  "content-type": "application/json",
};
const publicContext = {
  accountLabel: "local@example.invalid",
  installationId: "00000000-0000-4000-8000-000000000001",
  remoteEnabled: false,
};
async function mint(body = publicContext) {
  return fetch(base + "/api/service/browser-ticket", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
try {
  let healthy = false;
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base + "/api/health")).status === 200) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(healthy, "isolated service started");
  for (const bad of [
    { ...publicContext, remoteEnabled: "private-marker" },
    { ...publicContext, subject: "private-marker" },
  ]) {
    const response = await mint(bad);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(!(await response.text()).includes("private-marker"));
  }
  for (const field of [
    "origin",
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-anything",
    "via",
    "cf-connecting-ip",
  ]) {
    const response = await fetch(base + "/api/service/browser-ticket", {
      method: "POST",
      headers: { ...headers, [field]: "spoofed" },
      body: "{}",
    });
    assert.equal(response.status, 403);
  }
  const issued = await mint();
  assert.equal(issued.status, 200);
  const { ticket, expiresIn } = await issued.json();
  assert.equal(expiresIn, 60);
  assert.equal(ticket.length, 64);
  browser = await chromium.launch({
    executablePath:
      process.env.ANYWORK_TEST_CHROME ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base);
  assert.equal(
    await page.evaluate(async () => (await fetch("/api/info")).status),
    401,
  );
  const redeemed = await page.evaluate(async (ticket) => {
    const r = await fetch("/api/local/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
    return { status: r.status, context: await r.json() };
  }, ticket);
  assert.equal(redeemed.status, 200);
  assert.deepEqual(redeemed.context, publicContext);
  const cookies = await context.cookies();
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, `anywork_local_${port}`);
  assert.equal(cookies[0].httpOnly, true);
  assert.equal(cookies[0].sameSite, "Strict");
  assert.equal(await page.evaluate(() => document.cookie), "");
  const cookie = `${cookies[0].name}=${cookies[0].value}`;
  const replay = await fetch(base + "/api/local/session", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(replay.status, 401);
  await page.reload();
  assert.deepEqual(
    await page.evaluate(async () => (await fetch("/api/local/session")).json()),
    publicContext,
  );
  assert.equal(
    await page.evaluate(async () => (await fetch("/api/info")).status),
    200,
  );
  for (const [extra, status] of [
    [{}, 401],
    [{ origin: "null" }, 401],
    [{ origin: `http://localhost:${port}` }, 401],
    [{ "sec-fetch-site": "same-site" }, 401],
    [{ "x-forwarded-proto": "http", origin: base }, 401],
    [{ authorization: "Bearer wrong", origin: base }, 401],
    [{ "sec-fetch-site": "same-origin" }, 200],
    [{ origin: base }, 200],
  ]) {
    const r = await fetch(base + "/api/info", {
      headers: { cookie, ...extra },
    });
    assert.equal(
      r.status,
      status,
      "source check " + Object.keys(extra).join(","),
    );
  }
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const r = http.get(
      base + "/api/info",
      { headers: { host: `127.0.0.1:${port + 1}`, origin: base, cookie } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    r.on("error", reject);
  });
  assert.equal(wrongHostStatus, 401);
  for (const endpoint of ["/api/service/browser-ticket", "/api/service/stop"]) {
    const r = await fetch(base + endpoint, {
      method: "POST",
      headers: { cookie, origin: base, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(r.status, 401);
  }
  for (const endpoint of ["/api/local/session"]) {
    const r = await fetch(base + endpoint, {
      headers: { cookie, origin: base, authorization: "Bearer wrong" },
    });
    assert.equal(r.status, 401);
  }
  const session = await page.evaluate(async () => {
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "fixture", cwd: ".", title: "Local PTY" }),
    });
    return (await r.json()).session;
  });
  assert.ok(session.id);
  await page.evaluate((id) => {
    window.ptyOutput = "";
    window.ptyClosed = false;
    window.ptyReady = false;
    const ws = new WebSocket(
      location.origin.replace("http:", "ws:") + "/ws/terminal/" + id,
    );
    ws.binaryType = "arraybuffer";
    window.pty = ws;
    ws.onopen = () => ws.send("anywork-local-session");
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        if (JSON.parse(e.data).type === "local.session.ready") {
          window.ptyReady = true;
          ws.send(
            JSON.stringify({
              type: "input",
              data: "printf 'LOCAL_%s\\n' 'PTY_READY'\n",
            }),
          );
        }
      } else window.ptyOutput += new TextDecoder().decode(e.data);
    };
    ws.onclose = () => (window.ptyClosed = true);
  }, session.id);
  await expect.poll(() => page.evaluate(() => window.ptyReady)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => window.ptyOutput.includes("LOCAL_PTY_READY")),
    )
    .toBe(true);
  assert.equal(
    await page.evaluate(
      async () =>
        (await fetch("/api/local/session", { method: "DELETE" })).status,
    ),
    200,
  );
  await expect
    .poll(() => page.evaluate(() => window.ptyClosed), { timeout: 3000 })
    .toBe(true);
  assert.equal(
    await page.evaluate(async () => (await fetch("/api/info")).status),
    401,
  );
  await page.reload();
  assert.equal(
    await page.evaluate(async () => (await fetch("/api/local/session")).status),
    401,
  );
  for (let n = 0; n < 32; n++) assert.equal((await mint()).status, 200);
  assert.equal((await mint()).status, 429);
  console.log(
    "Local browser session: real HTTP/cookie, fixed safe errors, exact source/Host/proxy boundaries, single-use/capacity, reload, real PTY ACK/output and logout cancellation passed.",
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", resolve);
  });
  await fs.rm(baseDir, { recursive: true, force: true });
}
