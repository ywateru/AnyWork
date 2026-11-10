import { expect, test, type Page } from "./local-fixture";

async function fixture(page: Page, text: string) {
  const state = { fileReads: [] as string[] };
  const session = {
    id: "authored-links",
    title: "用户链接",
    thread_id: "authored-links",
    cwd: "/work/project",
    agent: "fixture",
    model: null,
    policy: "manual",
    status: "idle",
    archived: false,
    created_at: 1,
    updated_at: 1,
  };
  const events = [
    {
      session_id: session.id,
      seq: 1,
      method: "user/message",
      params: { text },
      created_at: 1,
    },
    {
      session_id: session.id,
      seq: 2,
      method: "item/completed",
      params: {
        item: {
          id: "answer",
          type: "agentMessage",
          phase: "final_answer",
          text,
        },
      },
      created_at: 2,
    },
  ];
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/local/session")
      return route.fallback();
    const url = new URL(route.request().url()),
      path = url.pathname.slice(4);
    let data: unknown = {};
    if (path === "/info")
      data = { workspace: session.cwd, hostname: "authored-link-fixture" };
    else if (path === "/plugins")
      data = {
        plugins: [{ id: "fixture", name: "Fixture", capabilities: [] }],
      };
    else if (path === "/sessions") data = { sessions: [session] };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path.endsWith("/history"))
      data = { events, next_cursor: null, latest_seq: 2 };
    else if (path.endsWith("/events/poll")) data = { events: [] };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (path.endsWith("/files")) {
      state.fileReads.push(url.searchParams.get("path") || "");
      data = { entries: [], content: "文件预览内容\n第二行" };
    } else if (path === `/sessions/${session.id}`) data = { session };
    else throw new Error(`Unmocked authored-link fixture request: ${path}`);
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    localStorage.setItem("ra.sidebar-pinned", "false");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          (window as any).authoredCopy = {
            text: await (await items[0].getType("text/plain")).text(),
            html: await (await items[0].getType("text/html")).text(),
          };
        },
      },
    });
  });
  await page.goto(`${process.env.USER_MESSAGE_TEST_URL || ""}/#${session.id}`);
  const user = page.locator(".message.user .user-message-text-content");
  const assistant = page.locator(".message.assistant .markdown").first();
  await expect(user).toBeVisible();
  await expect(assistant).toBeVisible();
  return { state, user, assistant };
}

test("user-only authored paths and codex-text links retain formatted labels and ordinary titles", async ({
  page,
}, info) => {
  const { user, assistant } = await fixture(
    page,
    '[本地文件](/work/project/a b.md)\n[**粗体** ~~旧稿~~](codex-text-link:///work/project/c d.md)\n[标准标题](https://example.com/a(b) "原有标题")\n[跨行标题](https://example.com/multiline "第一行\n第二行")',
  );
  await expect(
    user.getByRole("link", { name: "本地文件", exact: true }),
  ).toHaveAttribute("href", "/work/project/a%20b.md");
  const formatted = user.getByRole("link", { name: "粗体 旧稿", exact: true });
  await expect(formatted).toHaveAttribute("href", "/work/project/c%20d.md");
  await expect(formatted.locator("strong")).toHaveText("粗体");
  await expect(formatted.locator("del")).toHaveText("旧稿");
  const titled = user.getByRole("link", { name: "标准标题", exact: true });
  await expect(titled).toHaveAttribute("href", "https://example.com/a(b)");
  await expect(titled).toHaveAttribute("title", "原有标题");
  await expect(
    user.getByRole("link", { name: "跨行标题", exact: true }),
  ).toHaveAttribute("title", "第一行\n第二行");
  await expect(
    assistant.getByRole("link", { name: "本地文件", exact: true }),
  ).toHaveCount(0);
  await expect(assistant).toContainText("[本地文件](/work/project/a b.md)");
  await expect(
    assistant.getByRole("link", { name: "标准标题", exact: true }),
  ).toHaveAttribute("title", "原有标题");
  await page.screenshot({
    path: `artifacts/anywork-user-links-${info.project.name}.png`,
    fullPage: true,
  });
});

test("escaped/code/image/nested labels keep their own syntax and incomplete input stops at its newline", async ({
  page,
}) => {
  const { user, assistant, state } = await fixture(
    page,
    '\\[转义](/work/project/a b.md)\n`[代码](codex-text-link:///work/project/code.md)`\n![图片](https://example.com/image.png)\n[外层 [内层](/work/project/a b.md)](https://example.com/outer "外层标题")\n[未完成](path **原样星号**\n下一行 **仍加粗** [有效](/work/project/next file.md)\n\n```txt\n[围栏](/work/project/a b.md)\n```',
  );
  await expect(
    user.getByRole("link", { name: "转义", exact: true }),
  ).toHaveCount(0);
  await expect(user.locator("code").first()).toHaveText(
    "[代码](/work/project/code.md)",
  );
  await expect(assistant.locator("code").first()).toHaveText(
    "[代码](codex-text-link:///work/project/code.md)",
  );
  await expect(user.locator("pre code")).toHaveText(
    "[围栏](/work/project/a b.md)\n",
  );
  await expect(user.locator("img")).toHaveCount(0);
  await expect(
    user.getByRole("link", { name: "图片", exact: true }),
  ).toHaveAttribute("href", "https://example.com/image.png");
  const outer = user.getByRole("link", {
    name: "外层 [内层](/work/project/a b.md)",
    exact: true,
  });
  await expect(outer).toHaveAttribute("href", "https://example.com/outer");
  await expect(outer.locator("a")).toHaveCount(0);
  await expect(
    user.getByRole("link", { name: "内层", exact: true }),
  ).toHaveCount(0);
  await expect(user).toContainText("[未完成](path **原样星号**");
  await expect(user.locator("strong")).toHaveText("仍加粗");
  await expect(
    user.getByRole("link", { name: "有效", exact: true }),
  ).toHaveAttribute("href", "/work/project/next%20file.md");
  expect(state.fileReads).toEqual([]);
});

test("colon and escaped punctuation links copy as rich text and open the exact local file", async ({
  page,
}) => {
  const { user, state } = await fixture(
    page,
    ":[文件 \\[草稿\\]](/work/project/a\\(b\\) doc.md:12:4)",
  );
  const link = user.getByRole("link", { name: "文件 [草稿]", exact: true });
  await expect(user).toContainText(":文件 [草稿]");
  await expect(link).toHaveAttribute(
    "href",
    "/work/project/a(b)%20doc.md:12:4",
  );
  await expect(link).toHaveAttribute("title", "/work/project/a(b) doc.md:12");
  await page
    .locator(".message.user")
    .getByRole("button", { name: "复制消息", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).authoredCopy?.text))
    .toBe(":文件 [草稿]");
  expect(
    await page.evaluate(() => (window as any).authoredCopy.html),
  ).toContain('href="/work/project/a(b)%20doc.md:12:4"');
  await link.click();
  await expect
    .poll(() => state.fileReads)
    .toContain("/work/project/a(b) doc.md");
  await expect(page).toHaveURL(/#authored-links$/);
});
