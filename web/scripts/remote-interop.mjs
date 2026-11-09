/** Real browser clatterjs ↔ Rust snow gateway. Uses only the isolated fixture. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
const nativeTree = process.env.ANYWORK_REMOTE_WORKTREE;
if (!nativeTree)
  throw new Error(
    "Set ANYWORK_REMOTE_WORKTREE to the checkout containing anywork-remote isolated example",
  );
const fixture = spawn(
  "cargo",
  ["run", "--quiet", "-p", "anywork-remote", "--example", "interop"],
  { cwd: resolve(nativeTree), stdio: ["ignore", "pipe", "pipe"] },
);
let diagnostic = "";
fixture.stderr.on("data", (bytes) => {
  diagnostic = (diagnostic + bytes.toString()).slice(-1000);
});
let browser;
try {
  const lines = createInterface({ input: fixture.stdout });
  let timer;
  const [line] = await Promise.race([
    once(lines, "line"),
    once(fixture, "exit").then(([code]) => {
      throw new Error("Isolated fixture exited " + code + ": " + diagnostic);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Isolated fixture startup timeout")),
        60000,
      );
    }),
  ]);
  clearTimeout(timer);
  const config = JSON.parse(line);
  if (config.fixture !== true || !Number.isInteger(config.port))
    throw new Error("Invalid isolated fixture");
  browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {},
  );
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://account-fixture.invalid/api/my-account", (route) =>
    route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200,
      headers: {
        "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
        "Access-Control-Allow-Headers": "authorization",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Content-Type": "application/json",
      },
      body:
        route.request().method() === "OPTIONS"
          ? undefined
          : JSON.stringify({ customData: { other: { preserved: true } } }),
    }),
  );
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  const result = await page.evaluate(async (config) => {
    const { RemoteTransport } = await import("/src/remoteTransport.ts");
    const RealWebSocket = window.WebSocket;
    const sockets = [];
    class FixtureSocket extends RealWebSocket {
      constructor(url, protocols) {
        super(
          String(url).startsWith("wss://fixture.trycloudflare.com/")
            ? `ws://127.0.0.1:${config.port}/remote/v1/ws`
            : url,
          protocols,
        );
        this.wire = [];
        sockets.push(this);
      }
      send(data) {
        if (data instanceof Uint8Array) this.wire.push(data.slice());
        super.send(data);
      }
    }
    window.WebSocket = FixtureSocket;
    const connect = (extra = {}) =>
      RemoteTransport.connect({
        url: "https://fixture.trycloudflare.com",
        installationId: config.installationId,
        publicKey: config.publicKey,
        accessToken: "test-access",
        ...extra,
      });
    const check = (value, description) => {
      if (!value) throw new Error(description);
    };
    let assertions = 0;
    const transport = await connect();
    assertions++;
    const { AccountStore } = await import("/src/accountData.ts");
    const settings = await new AccountStore(
      "https://account-fixture.invalid",
      async () => "fixture-account-token",
    ).read();
    check(
      settings.customData.other.preserved === true,
      "real browser native fetch receiver",
    );
    assertions++;
    for (const received of [undefined, 123]) {
      let rejected = false;
      try {
        transport.receive({ type: "ack", id: "never-issued", received });
      } catch {
        rejected = true;
      }
      check(rejected, "unknown or malformed ACK remains rejected");
    }
    assertions++;
    const delayedHandler = transport.ws.onmessage;
    transport.ws.onmessage = (event) =>
      setTimeout(() => delayedHandler(event), 100);
    const cancelAck = new AbortController();
    const cancelledAck = transport.request("/api/sessions/fixture/uploads", {
      method: "POST",
      body: new Uint8Array(65536),
      signal: cancelAck.signal,
    });
    while (transport.acks.size === 0)
      await new Promise((resolve) => setTimeout(resolve, 1));
    cancelAck.abort();
    await cancelledAck.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 250));
    transport.ws.onmessage = delayedHandler;
    check(
      (await transport.request("/api/info")).status === 200,
      "late authentic ACK after cancellation keeps sibling requests live",
    );
    assertions++;
    const beforeTimeoutHandler = transport.ws.onmessage;
    transport.ws.onmessage = (event) =>
      setTimeout(() => beforeTimeoutHandler(event), 100);
    const actualTimeout = window.setTimeout;
    window.setTimeout = (callback, ms, ...args) =>
      actualTimeout(callback, ms === 15000 ? 30 : ms, ...args);
    const timeoutCode = await transport
      .request("/api/sessions/fixture/uploads", {
        method: "POST",
        body: new Uint8Array(65536),
      })
      .then(
        () => "accepted",
        (error) => error.code,
      );
    window.setTimeout = actualTimeout;
    await new Promise((resolve) => setTimeout(resolve, 250));
    transport.ws.onmessage = beforeTimeoutHandler;
    check(
      timeoutCode === "REQUEST_TIMEOUT" &&
        (await transport.request("/api/info")).status === 200,
      "late ACK after chunk timeout keeps connection live",
    );
    assertions++;
    const info = await (await transport.request("/api/info")).json();
    check(info.hostname === "fixture", "real local API response");
    assertions++;
    const raw = new Uint8Array(140000);
    for (let i = 0; i < raw.length; i++) raw[i] = i % 251;
    const echo = new Uint8Array(
      await (
        await transport.request("/api/sessions/fixture/uploads", {
          method: "POST",
          body: raw,
        })
      ).arrayBuffer(),
    );
    check(
      echo.length === raw.length && echo.every((byte, i) => byte === raw[i]),
      "chunked binary upload and response",
    );
    assertions++;
    const large = new Uint8Array(20 * 1024 * 1024);
    large[0] = 19;
    large[large.length - 1] = 71;
    const largeReply = new Uint8Array(
      await (
        await transport.request("/api/sessions/fixture/uploads", {
          method: "POST",
          body: large,
        })
      ).arrayBuffer(),
    );
    check(
      largeReply.length === large.length &&
        largeReply[0] === 19 &&
        largeReply.at(-1) === 71,
      "supported20MiB encrypted upload",
    );
    assertions++;
    await transport
      .request("/api/sessions/fixture/uploads", {
        method: "POST",
        body: new Uint8Array(22 * 1024 * 1024 + 1),
      })
      .then(
        () => {
          throw new Error("oversized body accepted");
        },
        () => {
          assertions++;
        },
      );
    const before = sockets[0].wire.length;
    const heavy = transport.request("/api/sessions/fixture/uploads", {
      method: "POST",
      body: large,
    });
    while (sockets[0].wire.length === before)
      await new Promise((resolve) => setTimeout(resolve, 1));
    await transport
      .request("/api/sessions/fixture/uploads", {
        method: "POST",
        body: new Uint8Array(3 * 1024 * 1024),
      })
      .then(
        () => {
          throw new Error("aggregate assembly limit exceeded");
        },
        () => {
          assertions++;
        },
      );
    await heavy;
    const concurrent = await Promise.allSettled(
      Array.from({ length: 9 }, () => transport.request("/api/info")),
    );
    check(
      concurrent.filter((result) => result.status === "rejected").length === 1,
      "eight concurrent request limit",
    );
    assertions++;
    const form = new FormData();
    form.append("file", new Blob(["private-file-content"]), "fixture.txt");
    const multipart = await (
      await transport.request("/api/sessions/fixture/uploads", {
        method: "POST",
        body: form,
      })
    ).text();
    check(
      multipart.includes('name="file"; filename="fixture.txt"') &&
        multipart.includes("private-file-content"),
      "multipart content and boundary survive encryption",
    );
    assertions++;
    const blob = await (
      await transport.request("/api/sessions/fixture/document")
    ).blob();
    check(
      blob.size === 100000 &&
        new Uint8Array(await blob.arrayBuffer()).every((byte) => byte === 42),
      "chunked binary download",
    );
    assertions++;
    const abort = new AbortController();
    const cancelled = transport.request("/api/sessions/fixture/uploads", {
      method: "POST",
      body: raw,
      signal: abort.signal,
    });
    abort.abort();
    await cancelled.then(
      () => {
        throw new Error("cancelled write accepted");
      },
      () => {
        assertions++;
      },
    );
    let terminal,
      terminalData = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("PTY timeout")), 5000);
      terminal = transport.terminal("fixture", {
        ready() {
          terminal.resize(80, 24);
          terminal.input("fixture-pty-input");
        },
        data(bytes) {
          terminalData += new TextDecoder().decode(bytes);
          if (terminalData.includes("fixture-pty-input")) {
            clearTimeout(timer);
            resolve();
          }
        },
        closed() {},
      });
    });
    check(
      terminalData.includes("test-ready") &&
        terminalData.includes("fixture-pty-input"),
      "real local PTY lifecycle",
    );
    assertions++;
    terminal.close();
    check(
      sockets[0].wire.every(
        (bytes) =>
          !new TextDecoder().decode(bytes).includes("test-access") &&
          !new TextDecoder().decode(bytes).includes("private-file-content"),
      ),
      "relay only sees ciphertext",
    );
    assertions++;
    const replay = sockets[0].wire[1];
    sockets[0].send(replay);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await transport.request("/api/info").then(
      () => {
        throw new Error("replay did not close");
      },
      () => {
        assertions++;
      },
    );
    await connect({ accessToken: "wrong-token" }).then(
      () => {
        throw new Error("wrong token accepted");
      },
      () => {
        assertions++;
      },
    );
    const badKey = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    await connect({ publicKey: badKey }).then(
      () => {
        throw new Error("wrong device key accepted");
      },
      () => {
        assertions++;
      },
    );
    const controller = new AbortController();
    controller.abort();
    await connect({ signal: controller.signal }).then(
      () => {
        throw new Error("aborted handshake accepted");
      },
      () => {
        assertions++;
      },
    );
    await RemoteTransport.connect({
      url: "http://127.0.0.1",
      installationId: config.installationId,
      publicKey: config.publicKey,
      accessToken: "test-access",
    }).then(
      () => {
        throw new Error("plaintext endpoint accepted");
      },
      () => {
        assertions++;
      },
    );
    const realTimeout = window.setTimeout;
    window.setTimeout = (callback, ms, ...args) =>
      realTimeout(callback, ms > 250000 ? 30 : ms, ...args);
    const expiring = await connect();
    window.setTimeout = realTimeout;
    const expiryReason = await expiring.ended;
    check(
      expiryReason === "AUTHORIZATION_EXPIRED",
      "authorization expiry notifies owner and closes session",
    );
    assertions++;
    transport.close();
    return { assertions };
  }, config);
  if (errors.length)
    throw new Error("Browser errors: " + JSON.stringify(errors));
  console.log(
    `Passed ${result.assertions} real browser/Rust assertions: Noise, HTTP, binary, multipart, PTY, cancellation, relay ciphertext, replay and authentication rejection.`,
  );
} finally {
  await browser?.close();
  fixture.kill("SIGINT");
}
