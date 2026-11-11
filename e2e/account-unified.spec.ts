import { test, expect } from "@playwright/test";
const headers = {
  Authorization: "Bearer browser-integration-test-token",
  "X-AnyWork-Service-Control": "desktop",
};
test("local desktop ticket is consumed once, fragment clears, cookie refreshes and old connection/bridge are ignored", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const ticketResponse = await request.post("/api/service/browser-ticket", {
    headers,
    data: { accountLabel: "Fixture", remoteEnabled: false },
  });
  expect(ticketResponse.status()).toBe(200);
  const { ticket } = await ticketResponse.json();
  await page.addInitScript(() => {
    localStorage.setItem("anywork.account.locale", "zh-CN");
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({
        url: "https://retired.invalid",
        token: "obsolete-fixture",
      }),
    );
    (window as any).RemoteAgentAndroid = {
      getConnection() {
        throw new Error("retired bridge called");
      },
    };
  });
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/") && !r.url().includes("/api/local/")) {
      requests.push(r.url());
      expect(r.headers().authorization).toBeUndefined();
    }
  });
  await page.goto(`/#local-ticket=${ticket}`);
  await expect(
    page.getByRole("heading", { name: "从哪里开始？" }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await expect(page.locator(".workspace-context")).toContainText(
    "由 Fixture 在本机打开",
  );
  expect(
    (await context.cookies()).some(
      (c) =>
        c.name.startsWith("anywork_local_") &&
        c.httpOnly &&
        c.sameSite === "Strict",
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      (ticket) =>
        JSON.stringify({ ...localStorage, ...sessionStorage }).includes(ticket),
      ticket,
    ),
  ).toBe(false);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "从哪里开始？" }),
  ).toBeVisible();
  expect(requests.every((url) => new URL(url).origin === baseURL)).toBe(true);
  expect(
    (
      await request.post("/api/local/session", {
        headers: { Origin: baseURL! },
        data: { ticket },
      })
    ).status(),
  ).toBe(401);
  // Logout belongs only to this browser session, not the service or cloud account.
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "常规", exact: true }).click();
  await page
    .getByRole("button", { name: "退出本机网页会话", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "这台电脑的工作区" }),
  ).toBeVisible();
  expect((await request.get("/api/info", { headers })).status()).toBe(200);
});
test("local cookie PTY waits for authorization ACK and deletion closes it", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const ticket = await request.post("/api/service/browser-ticket", {
    headers,
    data: {},
  });
  const data = await ticket.json();
  await page.goto(`/#local-ticket=${data.ticket}`);
  await expect(
    page.getByRole("heading", { name: "从哪里开始？" }),
  ).toBeVisible();
  const info = await (await request.get("/api/info", { headers })).json();
  const created = await (
    await request.post("/api/sessions", {
      headers,
      data: {
        agent: "fixture",
        cwd: info.workspace,
        title: "Local cookie PTY",
      },
    })
  ).json();
  const id = created.session.id;
  const output = await page.evaluate(async (id) => {
    const ws = new WebSocket(
      `${location.origin.replace(/^http/, "ws")}/ws/terminal/${id}`,
    );
    ws.binaryType = "arraybuffer";
    (window as any).cookieFixtureWs = ws;
    return await new Promise<string>((resolve, reject) => {
      let ready = false,
        text = "";
      const timer = setTimeout(
        () => reject(new Error("cookie PTY timeout")),
        5000,
      );
      ws.onopen = () => ws.send("anywork-local-session");
      ws.onmessage = (e) => {
        if (!ready) {
          if (JSON.parse(e.data).type !== "local.session.ready")
            return reject(new Error("no authorization ACK"));
          ready = true;
          ws.send(
            JSON.stringify({
              type: "input",
              data: "printf 'cookie-pty-ready\\n'\n",
            }),
          );
          return;
        }
        text += new TextDecoder().decode(new Uint8Array(e.data));
        if (text.includes("cookie-pty-ready")) {
          clearTimeout(timer);
          resolve(text);
        }
      };
    });
  }, id);
  expect(output).toContain("cookie-pty-ready");
  const result = await context.request.delete(baseURL + "/api/local/session", {
    headers: { Origin: baseURL! },
  });
  expect(result.status()).toBe(200);
  await expect
    .poll(() => page.evaluate(() => (window as any).cookieFixtureWs.readyState))
    .toBe(3);
  await expect(
    page.getByRole("heading", { name: "这台电脑的工作区" }),
  ).toBeVisible();
});
test("hosted/mobile account entry has no manual form, saved connection or Android bypass", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://**/*", (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("anywork.account.locale", "zh-CN");
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({ url: "https://retired.invalid", token: "obsolete" }),
    );
    (window as any).RemoteAgentAndroid = {
      getConnection() {
        throw new Error("retired bridge called");
      },
    };
  });
  await page.goto("/app/");
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "注册账号", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("高级连接", { exact: true })).toHaveCount(0);
  await expect(page.locator("input")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
