import { expect, test, type Page } from "@playwright/test";
const headers = { Authorization: "Bearer browser-integration-test-token" };
async function fixture(page: Page) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const create = async () =>
    (
      await (
        await page.request.post("/api/sessions", {
          headers,
          data: { cwd: workspace, agent: "fixture", title: "图片编辑验收" },
        })
      ).json()
    ).session;
  const session = await create();
  await page.addInitScript(() => {
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({
        url: location.origin,
        token: "browser-integration-test-token",
      }),
    );
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  await page.goto(`/#${session.id}`);
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeEditable();
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 400;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 640, 400);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const upload = async (name = "original.png") => {
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/uploads") && r.request().method() === "POST",
    );
    await page.locator('.composer input[type="file"]').setInputFiles({
      name,
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
    const result = await (await response).json();
    await expect(page.locator(".attachment-pending")).toHaveCount(0);
    return result.files[0].path as string;
  };
  return { session, create, upload };
}
const editor = (page: Page) =>
  page.getByRole("dialog", { name: "编辑图片", exact: true });
async function openEditor(page: Page, index = 0) {
  await page
    .locator(".attachments")
    .getByRole("button", { name: "查看图片", exact: true })
    .nth(index)
    .click();
  await page.getByRole("button", { name: "编辑图片", exact: true }).click();
  await expect(
    editor(page).getByRole("button", { name: "完成", exact: true }),
  ).toBeEnabled();
}
async function draw(
  page: Page,
  tool: string,
  from = { x: 0.2, y: 0.3 },
  to = { x: 0.75, y: 0.3 },
) {
  await editor(page).getByRole("button", { name: tool, exact: true }).click();
  const box = (await editor(page).locator("canvas").boundingBox())!;
  await page.mouse.move(
    box.x + from.x * box.width,
    box.y + from.y * box.height,
  );
  await page.mouse.down();
  await page.mouse.move(box.x + to.x * box.width, box.y + to.y * box.height, {
    steps: 8,
  });
  await page.mouse.up();
}
async function finish(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/uploads") && r.request().method() === "POST",
  );
  await editor(page).getByRole("button", { name: "完成", exact: true }).click();
  const result = await (await response).json();
  await expect(editor(page)).toHaveCount(0);
  return result.files[0].path as string;
}
async function pixel(page: Page) {
  return editor(page)
    .locator("canvas")
    .evaluate((c) => [
      ...(c as HTMLCanvasElement).getContext("2d")!.getImageData(300, 120, 1, 1)
        .data,
    ]);
}

test("annotations flatten into the sent file and keep original plus undo/redo history when reopened", async ({
  page,
}, info) => {
  const { upload } = await fixture(page);
  const original = await upload();
  await openEditor(page);
  await draw(page, "直线");
  await expect.poll(() => pixel(page)).toEqual([239, 68, 68, 255]);
  await draw(page, "箭头", { x: 0.2, y: 0.5 }, { x: 0.7, y: 0.7 });
  await editor(page).getByRole("button", { name: "文字", exact: true }).click();
  const box = (await editor(page).locator("canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.1);
  await page
    .getByRole("textbox", { name: "批注文字" })
    .fill("请修改这里 · Review");
  await editor(page)
    .getByRole("button", { name: "添加文字", exact: true })
    .click();
  await page.screenshot({
    path: `artifacts/anywork-image-editor-${info.project.name}.png`,
    fullPage: true,
  });
  const flattened = await finish(page);
  expect(flattened).not.toBe(original);
  await openEditor(page);
  for (let i = 0; i < 3; i++)
    await editor(page).getByRole("button", { name: "撤销批注" }).click();
  await expect(
    editor(page).getByRole("button", { name: "撤销批注" }),
  ).toBeDisabled();
  await expect.poll(() => pixel(page)).toEqual([255, 255, 255, 255]);
  await finish(page);
  await openEditor(page);
  await expect(
    editor(page).getByRole("button", { name: "重做批注" }),
  ).toBeEnabled();
  await editor(page).getByRole("button", { name: "重做批注" }).click();
  await expect.poll(() => pixel(page)).toEqual([239, 68, 68, 255]);
  const finalPath = await finish(page);
  const submitted = page.waitForRequest(
    (r) => r.url().endsWith("/messages") && r.method() === "POST",
  );
  await page.getByTitle("发送", { exact: true }).click();
  expect((await submitted).postDataJSON().attachments).toEqual([finalPath]);
  const response = await page.request.get(
    `/api/sessions/${await fixtureSessionId(page)}/image?path=${encodeURIComponent(finalPath)}`,
    { headers },
  );
  expect(response.ok()).toBe(true);
});
async function fixtureSessionId(page: Page) {
  return new URL(page.url()).hash.slice(1);
}

test("gallery edits target the selected attachment, cancellation discards changes, failed save is retryable", async ({
  page,
}) => {
  const { upload } = await fixture(page);
  await upload("first.png");
  await upload("second.png");
  const first = await page
    .locator(".attachments img")
    .nth(0)
    .getAttribute("src");
  const second = await page
    .locator(".attachments img")
    .nth(1)
    .getAttribute("src");
  await page
    .locator(".attachments")
    .getByRole("button", { name: "查看图片", exact: true })
    .nth(0)
    .click();
  await page.getByRole("button", { name: "下一张图片" }).click();
  await page.getByRole("button", { name: "编辑图片", exact: true }).click();
  await expect(
    editor(page).getByRole("button", { name: "完成", exact: true }),
  ).toBeEnabled();
  await draw(page, "画笔");
  await editor(page).getByRole("button", { name: "取消编辑" }).click();
  expect(
    await page.locator(".attachments img").nth(1).getAttribute("src"),
  ).toBe(second);
  await openEditor(page, 1);
  await expect(
    editor(page).getByRole("button", { name: "撤销批注" }),
  ).toBeDisabled();
  await draw(page, "直线");
  await page.route(
    "**/uploads",
    (route) => route.fulfill({ status: 500, json: { error: "模拟上传失败" } }),
    { times: 1 },
  );
  await editor(page).getByRole("button", { name: "完成", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toContainText("模拟上传失败");
  await expect(
    editor(page).getByRole("button", { name: "撤销批注" }),
  ).toBeEnabled();
  await expect.poll(() => pixel(page)).toEqual([239, 68, 68, 255]);
  await finish(page);
  expect(
    await page.locator(".attachments img").nth(0).getAttribute("src"),
  ).toBe(first);
  expect(
    await page.locator(".attachments img").nth(1).getAttribute("src"),
  ).not.toBe(second);
  await openEditor(page, 1);
  expect(
    await editor(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await editor(page).getByRole("button", { name: "撤销批注" }).click();
  await expect.poll(() => pixel(page)).toEqual([255, 255, 255, 255]);
});

test("touch drawing keeps natural coordinates and switching chats during save cannot modify the next draft", async ({
  page,
}) => {
  const { upload, create } = await fixture(page);
  const next = await create();
  await upload();
  await openEditor(page);
  const canvas = editor(page).locator("canvas");
  await canvas.evaluate((c) => {
    const rect = c.getBoundingClientRect();
    const fire = (type: string, x: number) =>
      c.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 19,
          pointerType: "touch",
          isPrimary: true,
          bubbles: true,
          button: 0,
          clientX: rect.x + rect.width * x,
          clientY: rect.y + rect.height * 0.3,
        }),
      );
    // Synthetic pointer capture is not available without an active platform pointer.
    c.setPointerCapture = () => {};
    fire("pointerdown", 0.2);
    fire("pointermove", 0.75);
    fire("pointerup", 0.75);
  });
  await expect.poll(() => pixel(page)).toEqual([239, 68, 68, 255]);
  let release!: () => void;
  await page.route("**/uploads", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.continue().catch(() => {});
  });
  await editor(page).getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByTitle("发送", { exact: true })).toBeDisabled();
  await expect.poll(() => !!release).toBe(true);
  await page.evaluate((id) => {
    location.hash = id;
  }, next.id);
  await expect(editor(page)).toHaveCount(0);
  release();
  await expect(page.locator(".attachments")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeEditable();
});
