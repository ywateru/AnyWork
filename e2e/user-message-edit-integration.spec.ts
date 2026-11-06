import { expect, test, type Page } from "@playwright/test";
import { expectPromptText, fillPromptText } from "./prompt-editor-helpers";

const token = "browser-integration-test-token";
const headers = { Authorization: `Bearer ${token}` };

async function createConversation(
  page: Page,
  title: string,
  latestText = "等待编辑的原始问题",
) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const { session } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { agent: "codex", cwd: workspace, title },
    })
  ).json();
  for (const text of ["保留的前一回合", latestText]) {
    expect(
      (
        await page.request.post(`/api/sessions/${session.id}/messages`, {
          headers,
          data: { text },
        })
      ).ok(),
    ).toBe(true);
    await expect
      .poll(async () => {
        const result = await page.request.get(`/api/sessions/${session.id}`, {
          headers,
        });
        return (await result.json()).session.status;
      })
      .toBe("idle");
  }
  await page.addInitScript(
    ({ token }) => {
      localStorage.setItem(
        "ra.connection",
        JSON.stringify({ url: location.origin, token }),
      );
      localStorage.setItem("ra.sidebar-pinned", "false");
    },
    { token },
  );
  await page.goto(`/#${session.id}`);
  await expect(
    page.getByRole("button", { name: "编辑消息", exact: true }),
  ).toHaveCount(1);
  return session;
}

test("real server edits the original Codex thread and preserves earlier history and the composer draft", async ({
  page,
}, info) => {
  const session = await createConversation(
    page,
    `原地编辑 ${info.project.name}`,
  );
  const composer = page.getByLabel("消息", { exact: true });
  await fillPromptText(composer, "主输入框的独立草稿");
  await page.getByRole("button", { name: "编辑消息", exact: true }).click();
  const editor = page.getByRole("form", { name: "编辑消息", exact: true });
  await fillPromptText(
    editor.getByRole("textbox"),
    "  修改后的问题\n保留末尾空白  ",
  );
  await editor.getByRole("button", { name: "发送", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "加载更早消息", exact: true }).click();
  await expect(page.locator(".message.user")).toHaveCount(2);
  await expect(page.locator(".message.user").first()).toContainText(
    "保留的前一回合",
  );
  await expect(page.locator(".message.user").last()).toContainText(
    "修改后的问题",
  );
  await expect(page.locator(".message.user")).not.toContainText([
    "等待编辑的原始问题",
  ]);
  await expectPromptText(composer, "主输入框的独立草稿");
  const { session: actual } = await (
    await page.request.get(`/api/sessions/${session.id}`, { headers })
  ).json();
  expect(actual.thread_id).toBe(session.thread_id);
  await page.reload();
  await expect(page.locator(".message.user").last()).toContainText(
    "修改后的问题",
  );
  await expectPromptText(composer, "主输入框的独立草稿");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("real revert failure recovers the editor after refresh and retries the saved operation", async ({
  page,
}, info) => {
  const session = await createConversation(
    page,
    `编辑恢复 ${info.project.name}`,
  );
  await page.getByRole("button", { name: "编辑消息", exact: true }).click();
  const editor = page.getByRole("form", { name: "编辑消息", exact: true });
  await fillPromptText(
    editor.getByRole("textbox"),
    "edit-reject-once 保留失败草稿",
  );
  await editor.getByRole("button", { name: "发送", exact: true }).click();
  await expect(editor.getByRole("alert")).toBeVisible();
  const saved = await (
    await page.request.get(`/api/sessions/${session.id}/edit`, { headers })
  ).json();
  expect(saved.operation.phase).toBe("reverted");
  await expect(page.locator(".message.user").first()).toContainText(
    "保留的前一回合",
  );
  await page.reload();
  await expectPromptText(
    editor.getByRole("textbox"),
    "edit-reject-once 保留失败草稿",
  );
  await fillPromptText(editor.getByRole("textbox"), "恢复后修改并重新提交");
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith(`/api/sessions/${session.id}/edit`),
  );
  await editor.getByRole("button", { name: "发送", exact: true }).click();
  const retry = (await sent).postDataJSON();
  expect(retry.operation_id).toBe(saved.operation.id);
  expect(retry.retry).toBe(true);
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "加载更早消息", exact: true }).click();
  await expect(page.locator(".message.user")).toHaveCount(2);
  await expect(page.locator(".message.user").last()).toContainText(
    "恢复后修改并重新提交",
  );
  const recovered = await (
    await page.request.get(`/api/sessions/${session.id}/edit`, { headers })
  ).json();
  expect(recovered.operation).toBeNull();
});

test("wrapped context stays hidden and survives two real edits in the original thread", async ({
  page,
}, info) => {
  const prefix =
    "<page-comment-context>\nprivate-file-context docs/guide.md\n</page-comment-context>\n## My request:\n";
  const session = await createConversation(
    page,
    `上下文编辑 ${info.project.name}`,
    prefix + "outer ## My request:  原始正文  ",
  );
  const message = page.locator(".message.user").last();
  await expect(message).toContainText("原始正文");
  await expect(message).not.toContainText("private-file-context");
  await expect(message).not.toContainText("outer");
  for (const body of ["第一次编辑\n保留段落", "第二次编辑"]) {
    await page.getByRole("button", { name: "编辑消息", exact: true }).click();
    const editor = page.getByRole("form", { name: "编辑消息", exact: true });
    await expectPromptText(
      editor.getByRole("textbox"),
      body === "第二次编辑" ? "第一次编辑\n保留段落" : "原始正文",
    );
    await fillPromptText(editor.getByRole("textbox"), `  ${body}  \n`);
    await editor.getByRole("button", { name: "发送", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(message).toContainText(body);
    await expect(message).not.toContainText("private-file-context");
    const exported = await (
      await page.request.get(`/api/sessions/${session.id}/export`, { headers })
    ).json();
    const lastUser = exported.events
      .filter((event: { method: string }) => event.method === "user/message")
      .at(-1);
    expect(lastUser.params.text).toBe(prefix + body + "\n");
    await page.reload();
    await expect(message).toContainText(body);
  }
  const actual = await (
    await page.request.get(`/api/sessions/${session.id}`, { headers })
  ).json();
  expect(actual.session.thread_id).toBe(session.thread_id);
  await page.screenshot({
    path: `artifacts/anywork-wrapped-message-${info.project.name}.png`,
  });
});
