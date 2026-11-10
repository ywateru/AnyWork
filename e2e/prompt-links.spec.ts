import { expect, test, type Page } from "./local-fixture";
import {
  expectPromptText,
  fillPromptText,
  pastePromptText,
} from "./prompt-editor-helpers";
const headers = { Authorization: "Bearer browser-integration-test-token" };
async function fixture(page: Page, entries: unknown[] = []) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const { session } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { agent: "fixture", cwd: workspace, title: "链接交互验收" },
    })
  ).json();
  await page.addInitScript(
    ({ id, entries }) => {
      localStorage.setItem("ra.sidebar-pinned", "false");
      localStorage.setItem(
        `anywork.prompt-history.${location.origin}`,
        JSON.stringify({ [id]: entries }),
      );
    },
    { id: session.id, entries },
  );
  await page.goto(`/#${session.id}`);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(input).toBeEditable();
  await input.focus();
  return { input, session, workspace };
}
async function linkedText(page: Page) {
  const state = await fixture(page);
  await pastePromptText(
    state.input,
    "before linked after",
    '<p>before <a href="https://example.com/start"><strong>linked</strong></a> after</p>',
  );
  const link = state.input.locator(
    '[text-link-href="https://example.com/start"]',
  );
  await expect(link).toHaveText("linked");
  return { ...state, link };
}
const dialog = (page: Page) => page.getByRole("dialog", { name: "链接选项" });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });

test("text link actions preserve formatting, undo and actual submission", async ({
  page,
}) => {
  const { input, link } = await linkedText(page);
  await page.reload();
  await expect(link).toBeVisible();
  await link.click();
  await expect(dialog(page)).toBeVisible();
  await expect(button(page, "编辑文字")).toBeFocused();
  await expect(link).toHaveAttribute("aria-expanded", "true");
  await button(page, "编辑文字").click();
  await field(page, "文字").fill("  新的链接文字  ");
  await button(page, "保存链接文字").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(input.locator("strong")).toHaveText("新的链接文字");
  await input.focus();
  await input.press("ControlOrMeta+z");
  await expect(input.locator("strong")).toHaveText("linked");
  await input.press("ControlOrMeta+Shift+z");
  await expect(input.locator("strong")).toHaveText("新的链接文字");
  const submitted = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith("/messages"),
  );
  await page.getByTitle("发送", { exact: true }).click();
  const payload = (await submitted).postDataJSON();
  expect(payload.text).toContain("新的链接文字");
  expect(payload.text).toContain("https://example.com/start");
});

test("invalid URL is rejected, Escape returns to actions, and an empty URL removes only the link", async ({
  page,
}, info) => {
  const { input, link } = await linkedText(page);
  await link.focus();
  await link.press("Enter");
  await page.screenshot({
    path: `artifacts/anywork-link-actions-${info.project.name}.png`,
  });
  await button(page, "编辑链接").click();
  const url = field(page, "网址");
  await url.fill("javascript:alert(1)");
  await url.press("Enter");
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await expect(link).toHaveAttribute(
    "text-link-href",
    "https://example.com/start",
  );
  expect(
    await url.evaluate((el) => {
      const r = el.closest("form")!.getBoundingClientRect();
      return r.left >= 7 && r.right <= innerWidth - 7;
    }),
  ).toBe(true);
  await url.press("Escape");
  await expect(button(page, "编辑文字")).toBeFocused();
  await button(page, "编辑链接").click();
  await url.fill("");
  await page.screenshot({
    path: `artifacts/anywork-link-options-${info.project.name}.png`,
  });
  await button(page, "移除链接").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(input.locator("[text-link-href]")).toHaveCount(0);
  await expect(input.locator("strong")).toHaveText("linked");
  await expectPromptText(input, "before linked after");
});

test("Escape cancels both stages, empty text cannot save and opening never sends", async ({
  page,
}) => {
  const { input, link } = await linkedText(page);
  const posts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST") posts.push(req.url());
  });
  await link.focus();
  await link.press("Space");
  await button(page, "编辑文字").click();
  await field(page, "文字").fill("   ");
  await expect(button(page, "保存链接文字")).toBeDisabled();
  await field(page, "文字").press("Escape");
  await button(page, "编辑文字").press("Escape");
  await expect(link).toBeFocused();
  await expect(link).toHaveAttribute("aria-expanded", "false");
  await expectPromptText(input, "before linked after");
  await page.evaluate(() => {
    (window as unknown as { opened: string[] }).opened = [];
    window.open = ((url: string) => {
      (window as unknown as { opened: string[] }).opened.push(url);
      return null;
    }) as typeof window.open;
  });
  await link.click();
  await button(page, "打开链接").click();
  expect(
    await page.evaluate(
      () => (window as unknown as { opened: string[] }).opened,
    ),
  ).toEqual(["https://example.com/start"]);
  expect(posts).toEqual([]);
});

test("provider atom URL editing becomes an ordinary link and persists through reload", async ({
  page,
}) => {
  const { input } = await fixture(page, [
    { markdown: "[pull request](https://github.com/openai/codex/pull/1)" },
  ]);
  await input.press("ArrowUp");
  const atom = input.locator('[data-composer-node-type="richLink"]');
  await expect(atom).toHaveAttribute("role", "button");
  await atom.click();
  await button(page, "编辑链接").click();
  await field(page, "网址").fill("mailto:anywork@example.com");
  await button(page, "保存链接网址").click();
  await expect(atom).toHaveCount(0);
  await expect(
    input.locator('[text-link-href="mailto:anywork@example.com"]'),
  ).toHaveText("pull request");
  await page.reload();
  const link = input.locator('[text-link-href="mailto:anywork@example.com"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(button(page, "打开链接")).toHaveCount(0);
  await expect(button(page, "编辑文字")).toBeVisible();
});

test("loading atoms cannot open and a library-backed rename preserves its identity", async ({
  page,
}) => {
  const { input } = await fixture(page, [
    {
      markdown: "saved",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "richLink",
                attrs: {
                  displayText: "canonical",
                  loadingDisplayText: "loading",
                  isLoading: true,
                  href: "https://example.com",
                  sourceAppId: "",
                },
              },
              { type: "text", text: " " },
              {
                type: "richLink",
                attrs: {
                  displayText: "library",
                  href: "https://example.com/library",
                  sourceAppId: "",
                  libraryFileId: "local-file-1",
                  serializeAsUrl: true,
                },
              },
            ],
          },
        ],
      },
    },
  ]);
  await input.press("ArrowUp");
  const loading = input.locator("[rich-link-loading]");
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await loading.click();
  await expect(dialog(page)).toHaveCount(0);
  await input.locator('[rich-link-display-text="library"]').click();
  await button(page, "编辑文字").click();
  await field(page, "文字").fill("renamed library");
  await button(page, "保存链接文字").click();
  const submitted = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith("/messages"),
  );
  await page.getByTitle("发送", { exact: true }).click();
  const nodes = (await submitted).postDataJSON().composer.document.content[0]
    .content;
  expect(
    nodes.find(
      (n: { attrs?: { displayText?: string } }) =>
        n.attrs?.displayText === "renamed library",
    ).attrs,
  ).toMatchObject({ libraryFileId: "local-file-1", serializeAsUrl: true });
});

test("switching chats closes pending edits without changing either draft", async ({
  page,
}) => {
  const { input, link, workspace, session } = await linkedText(page);
  await link.click();
  await button(page, "编辑文字").click();
  await field(page, "文字").fill("unsaved name");
  const { session: other } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { agent: "fixture", cwd: workspace, title: "另一个链接会话" },
    })
  ).json();
  await page.evaluate((id) => {
    location.hash = id;
  }, other.id);
  await expect(dialog(page)).toHaveCount(0);
  await fillPromptText(input, "other draft");
  await page.evaluate((id) => {
    location.hash = id;
  }, session.id);
  await expectPromptText(input, "before linked after");
  await expect(input.locator("[text-link-href]")).toHaveText("linked");
});

test("reopening an edited link returns to actions and IME confirmation never saves it", async ({
  page,
}) => {
  const { input, link } = await linkedText(page);
  await link.click();
  await button(page, "编辑文字").click();
  const text = field(page, "文字");
  await text.fill("unsaved");
  await text.dispatchEvent("keydown", {
    key: "Enter",
    isComposing: true,
    bubbles: true,
    cancelable: true,
  });
  await expect(text).toHaveValue("unsaved");
  await expectPromptText(input, "before linked after");
  await link.click();
  await expect(button(page, "编辑文字")).toBeFocused();
  await page.getByTitle("添加", { exact: true }).focus();
  await expect(dialog(page)).toHaveCount(0);
  await expectPromptText(input, "before linked after");
});

test("breakable URL marks use native actions while copying retains plain URL and HTML anchors", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const href = "https://example.com/path";
  const { input } = await fixture(page, [
    {
      markdown: href,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: href,
                marks: [
                  { type: "link", attrs: { href: null, sourceAppId: "" } },
                ],
              },
            ],
          },
        ],
      },
    },
  ]);
  await input.press("ArrowUp");
  const link = input.locator("[data-breakable-url]");
  await expect(link.locator("[data-inline-url-icon]")).toHaveCount(1);
  await expect(link.locator("[data-inline-url-icon] path")).not.toHaveCSS(
    "fill",
    "none",
  );
  await link.click();
  await button(page, "编辑文字").click();
  await field(page, "文字").fill("display label");
  await button(page, "保存链接文字").click();
  await expect(input.locator("[text-link-href]")).toHaveText("display label");
  await input.focus();
  await input.press("ControlOrMeta+A");
  await input.press("ControlOrMeta+C");
  const copied = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return {
      text: await (await item.getType("text/plain")).text(),
      html: await (await item.getType("text/html")).text(),
    };
  });
  expect(copied.text).toContain(href);
  expect(copied.html).toContain(`href="${href}"`);
  expect(copied.html).not.toContain("data-inline-url-icon");
});
