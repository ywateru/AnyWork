import { authorizeLocalContext } from "./local-fixture";
import { expectPromptText, fillPromptText } from "./prompt-editor-helpers";
import { test, expect, type Page } from "./local-fixture";
async function files(page: Page) {
  await page.getByLabel("打开子窗口", { exact: true }).click();
  await page.getByRole("button", { name: "文件", exact: true }).click();
}
const token = "browser-integration-test-token";
const headers = { Authorization: `Bearer ${token}` };

test("conversation restores draft, previews authenticated PDF and remembers keyboard split width", async ({
  page,
}, info) => {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const { session } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: {
        agent: "fixture",
        cwd: workspace,
        title: `Document acceptance ${info.project.name}`,
      },
    })
  ).json();
  // A complete one-page PDF keeps this check independent from external files or services.
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const name = `acceptance-${info.project.name}.pdf`;
  expect(
    (
      await page.request.put(`/api/sessions/${session.id}/files`, {
        headers,
        data: { path: name, content: pdf, expected_revision: null },
      })
    ).ok(),
  ).toBe(true);
  const markdownName = `acceptance-${info.project.name}.md`;
  expect(
    (
      await page.request.put(`/api/sessions/${session.id}/files`, {
        headers,
        data: {
          path: markdownName,
          expected_revision: null,
          content: `# Document links\n\n[预览 PDF](./${name})`,
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(`/#${session.id}`);
  const input = page.getByLabel("消息", { exact: true });
  await fillPromptText(input, "跨刷新保留的草稿\n第二行");
  await page.reload();
  await expectPromptText(input, "跨刷新保留的草稿\n第二行");
  await files(page);
  await page.getByRole("treeitem", { name, exact: true }).click();
  const frame = page.getByTitle(`PDF 预览：${name}`, { exact: true });
  await expect(frame).toHaveAttribute("src", /^blob:/);
  await expect(
    page.getByRole("link", { name: "下载文件", exact: true }),
  ).toHaveAttribute("download", name);
  const response = await page.request.get(
    `/api/sessions/${session.id}/document?path=${name}`,
    { headers },
  );
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(
    (
      await page.request.get(
        `/api/sessions/${session.id}/document?path=${name}`,
      )
    ).status(),
  ).toBe(401);
  await page.getByRole("treeitem", { name: markdownName, exact: true }).click();
  await page.getByRole("link", { name: "预览 PDF", exact: true }).click();
  await expect(
    page
      .getByRole("tablist", { name: "当前会话的子窗口", exact: true })
      .getByRole("tab", { name, exact: true }),
  ).toHaveCount(1);
  await expect(frame).toHaveAttribute("src", /^blob:/);
  const pane = page.getByLabel("会话内容", { exact: true });
  if (info.project.name === "desktop") {
    const handle = page.getByRole("separator", { name: "调整侧栏宽度" });
    const before = Number(await handle.getAttribute("aria-valuenow"));
    await handle.focus();
    await handle.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", String(before + 10));
    await expect(pane).toBeVisible();
    await page.reload();
    await files(page);
    await expect(handle).toHaveAttribute("aria-valuenow", String(before + 10));
  } else await expect(pane).toBeHidden();
  await page.getByRole("button", { name: "关闭预览面板", exact: true }).click();
  await expect(input).toBeVisible();
  await expectPromptText(input, "跨刷新保留的草稿\n第二行");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("reference viewport shows conversation and document in one header row", async ({
  browser,
  request,
}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "Reference screenshots are desktop captures",
  );
  const infoResponse = await request.get("/api/info", { headers });
  const { workspace } = await infoResponse.json();
  const { session } = await (
    await request.post("/api/sessions", {
      headers,
      data: { agent: "fixture", cwd: workspace, title: "AnyWork 会话与文档" },
    })
  ).json();
  await request.post(`/api/sessions/${session.id}/messages`, {
    headers,
    data: { text: "document-preview 请核对会话、附件与文档分屏。" },
  });
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/sessions/${session.id}`, { headers })
          ).json()
        ).session.status,
    )
    .toBe("idle");
  await request.post(`/api/sessions/${session.id}/composer`, {
    headers,
    data: { action: "goal", objective: "任何时候、任何地方，完成任何工作。" },
  });
  const context = await browser.newContext({
    viewport: { width: 1102, height: 896 },
    deviceScaleFactor: 2,
  });
  await authorizeLocalContext(context, new URL(infoResponse.url()).origin);
  await context.addInitScript(
    ({ token }) => {
      localStorage.setItem("ra.sidebar-pinned", "false");
    },
    { token },
  );
  const page = await context.newPage();
  await page.goto(`${new URL(infoResponse.url()).origin}/#${session.id}`);
  await page.getByRole("link", { name: "设计说明", exact: true }).click();
  await page
    .getByLabel("消息", { exact: true })
    .fill("检查移动端与桌面端的会话体验。");
  const separator = page.getByRole("separator", { name: "调整侧栏宽度" });
  await separator.focus();
  await separator.press("Home");
  for (let n = 0; n < 32; n++) await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "480");
  await expect(
    page.getByRole("heading", { name: "文档侧栏预览", exact: true }),
  ).toBeVisible();
  const header = await page.locator(".conversation-header").boundingBox();
  const panelHeader = await page.locator(".panel-tabs").boundingBox();
  expect(header!.height).toBe(43);
  expect(panelHeader!.y).toBe(header!.y);
  const composer = await page.locator(".composer").boundingBox();
  expect(Math.round(composer!.width)).toBe(448);
  expect(Math.round(composer!.height)).toBe(99);
  await page.getByLabel("消息", { exact: true }).focus();
  await page.screenshot({ path: "artifacts/anywork-reference-desktop.png" });
  await context.close();
});
