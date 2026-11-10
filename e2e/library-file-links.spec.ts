import { expect, test, type Page } from "./local-fixture";

async function fixture(page: Page, text: string) {
  const state = { fileReads: [] as string[] };
  const session = {
    id: "library-links",
    title: "用户链接",
    thread_id: "library-links",
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
      data = { workspace: session.cwd, hostname: "library-link-fixture" };
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
    else throw new Error(`Unmocked library-link fixture request: ${path}`);
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    localStorage.setItem("ra.sidebar-pinned", "false");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          (window as any).libraryCopy = {
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

function mention(
  source: string,
  id = "external-gdrive:file:abcde",
  mime = "application/vnd.google-apps.document",
) {
  const params = new URLSearchParams({
    asUrl: "1",
    sourceUrl: source,
    mimeType: mime,
  });
  return `chatgpt-library-file://${encodeURIComponent(id)}?${params}`;
}

test("Library references preserve identity, native inline geometry and the real source click", async ({
  page,
}, info) => {
  const source =
      "https://docs.google.com/document/d/abcde/edit?tab=original#heading",
    href = mention(source),
    { user, assistant, state } = await fixture(
      page,
      `请检查 [  项目文档  ](${href})，再修改本地文件。`,
    );
  for (const view of [user, assistant]) {
    const link = view.getByRole("link", { name: "项目文档", exact: true });
    await expect(link).toHaveAttribute("href", source);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("data-prompt-link-href", href);
    await expect(link).toHaveAttribute("data-prompt-link-label", "项目文档");
    await expect(link).toHaveAttribute(
      "data-library-file-id",
      "external-gdrive:file:abcde",
    );
    await expect(link.locator("[data-file-icon=google-docs]")).toHaveCount(1);
    const dimensions = await link.evaluate((element) => {
      const mention = element.querySelector(".library-file-mention")!,
        slot = element.querySelector(".library-file-icon-slot")!,
        icon = element.querySelector("svg")!;
      return {
        decoration: getComputedStyle(element).textDecorationLine,
        layout: getComputedStyle(mention).display,
        weight: getComputedStyle(mention).fontWeight,
        slotWidth: getComputedStyle(slot).width,
        slotPadding: getComputedStyle(slot).paddingInlineEnd,
        iconWidth: icon.getBoundingClientRect().width,
      };
    });
    expect(dimensions).toEqual({
      decoration: "none",
      layout: "inline",
      weight: "500",
      slotWidth: "16px",
      slotPadding: "3px",
      iconWidth: 16,
    });
  }
  // Observe navigation without contacting the real cloud document provider.
  let requested = "";
  await page.context().route("https://docs.google.com/**", async (route) => {
    requested = route.request().url();
    await route.fulfill({
      contentType: "text/html",
      body: "<title>Fixture document</title>文档",
    });
  });
  const popupPromise = page.waitForEvent("popup");
  await user.getByRole("link", { name: "项目文档", exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  expect(requested).toBe(source.split("#", 1)[0]);
  await expect(popup).toHaveURL(source);
  await popup.close();
  expect(state.fileReads).toEqual([]);
  await expect(page).toHaveURL(/#library-links$/);
  await page.screenshot({
    path: `artifacts/anywork-library-links-${info.project.name}.png`,
    fullPage: true,
  });
});

test("unsupported sources and malformed metadata never become a Library link or a local file read", async ({
  page,
}) => {
  const generic = mention("https://example.com/report.pdf"),
    unsupported = mention(
      "https://www.dropbox.com/sh/folder/shared",
      "external-dropbox:file:id:abc",
      "application/pdf",
    ),
    missing = mention(
      "https://app.box.com/file/123",
      "external-box:file:123",
      "application/pdf",
    ).replace("asUrl=1", "asUrl=0"),
    valid = mention(
      "https://app.box.com/file/123",
      "external-box:file:123",
      "application/pdf",
    ),
    { user, assistant, state } = await fixture(
      page,
      `[普通来源](${generic})\n[文件夹](${unsupported})\n[缺标记](${missing})\n[报告.pdf](${valid})\n[普通网页](https://example.com/article)`,
    );
  for (const view of [user, assistant]) {
    await expect(view.locator(".library-file-link")).toHaveCount(1);
    await expect(view.locator("[data-file-icon=pdf]")).toHaveCount(1);
    for (const label of ["普通来源", "文件夹", "缺标记"]) {
      await expect(view).toContainText(label);
      await expect(view.locator("a").filter({ hasText: label })).toHaveCount(0);
      await expect(
        view.locator("[data-prompt-link-href]").filter({ hasText: label }),
      ).toHaveCount(0);
    }
    await expect(
      view.getByRole("link", { name: "普通网页", exact: true }),
    ).toHaveAttribute("href", "https://example.com/article");
  }
  expect(state.fileReads).toEqual([]);
});

test("Library reference copy retains real destination plus original prompt-link metadata", async ({
  page,
}) => {
  const source = "https://drive.google.com/file/d/abcde/view",
    href = mention(source, "libfile_example", "application/pdf"),
    { user } = await fixture(page, `[  报告.pdf  ](${href})`);
  await expect(
    user.getByRole("link", { name: "报告.pdf", exact: true }),
  ).toHaveAttribute("href", source);
  await page
    .locator(".message.user")
    .getByRole("button", { name: "复制消息", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).libraryCopy?.text))
    .toBe("报告.pdf");
  const copied = await page.evaluate(() => (window as any).libraryCopy.html);
  expect(copied).toContain(`href="${source}"`);
  expect(copied).toContain(
    'data-prompt-link-href="chatgpt-library-file://libfile_example?',
  );
  expect(copied).toContain('data-prompt-link-label="报告.pdf"');
});
