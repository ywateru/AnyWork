import { expect, test, type Page } from "./local-fixture";

async function fixture(page: Page, text: string) {
  const session = {
    id: "user-collapse",
    title: "用户长消息",
    thread_id: "user-collapse",
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
  ];
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/local/session")
      return route.fallback();
    const path = new URL(route.request().url()).pathname.slice(4);
    let data: unknown = {};
    if (path === "/info")
      data = { workspace: session.cwd, hostname: "user-collapse-fixture" };
    else if (path === "/plugins")
      data = {
        plugins: [{ id: "fixture", name: "Fixture", capabilities: [] }],
      };
    else if (path === "/sessions") data = { sessions: [session] };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path.endsWith("/history"))
      data = { events, next_cursor: null, latest_seq: 1 };
    else if (path.endsWith("/events/poll")) data = { events: [] };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (path === `/sessions/${session.id}`) data = { session };
    else throw new Error(`Unmocked collapse fixture API: ${path}`);
    await route.fulfill({ json: data });
  });
  await page.addInitScript(() => {
    localStorage.setItem("ra.sidebar-pinned", "false");
  });
  await page.goto(
    `${process.env.USER_MESSAGE_TEST_URL || process.env.APPROVAL_TEST_URL || ""}/#user-collapse`,
  );
  const message = page.locator(".message.user");
  await expect(message).toBeVisible();
  await expect(message.locator(".user-message-text-content")).toBeAttached();
  return message;
}

test("user text collapses by measured wrapped lines and keeps the entire source mounted", async ({
  page,
}, info) => {
  const text =
    "这是没有换行但会按实际宽度折行的用户消息。".repeat(180) + "全文末尾";
  const message = await fixture(page, text);
  const root = message.locator(".user-message-text");
  const content = root.locator(".user-message-text-content");
  await expect(root).toHaveAttribute("data-collapsed", "true");
  await expect(content).toHaveText(text);
  const dimensions = await root.evaluate((node) => {
    const clip = node.querySelector<HTMLElement>(".user-message-text-clip")!;
    const content = node.querySelector<HTMLElement>(
      ".user-message-text-content",
    )!;
    return {
      height: clip.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(content).lineHeight),
      natural: content.scrollHeight,
    };
  });
  expect(
    Math.abs(dimensions.height - Math.ceil(dimensions.line * 19)),
  ).toBeLessThanOrEqual(1);
  expect(dimensions.natural).toBeGreaterThan(dimensions.height);
  await expect(root.locator(".user-message-ellipsis")).toHaveText("…");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).collapsedCopy = value;
        },
      },
    });
  });
  const copy = message.getByRole("button", { name: "复制消息", exact: true });
  await copy.focus();
  await copy.click();
  expect(await page.evaluate(() => (window as any).collapsedCopy)).toBe(text);
  await page.screenshot({
    path: `artifacts/anywork-user-collapse-${info.project.name}.png`,
  });
  const more = root.getByRole("button", { name: "显示更多", exact: true });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  const less = root.getByRole("button", { name: "收起", exact: true });
  await expect(less).toHaveAttribute("aria-expanded", "true");
  await expect(root).not.toHaveAttribute("data-collapsed");
  await expect(root.locator(".user-message-ellipsis")).toHaveCount(0);
  await expect(root.locator(".user-message-text-clip")).toHaveCSS(
    "max-height",
    "none",
  );
  await less.click();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(content).toContainText("全文末尾");
});

test("a fenced code block crossing the cutoff remains completely visible", async ({
  page,
}) => {
  const text =
    Array.from({ length: 15 }, (_, i) => `前文第${i + 1}行`).join("\n") +
    "\n\n```js\n" +
    Array.from({ length: 9 }, (_, i) => `const line${i} = ${i};`).join("\n") +
    "\n```\n\n" +
    Array.from({ length: 30 }, (_, i) => `代码之后第${i + 1}行`).join("\n");
  const message = await fixture(page, text);
  const root = message.locator(".user-message-text");
  await expect(root).toHaveAttribute("data-collapsed", "true");
  const bounds = await root.evaluate((node) => {
    const clip = node
      .querySelector(".user-message-text-clip")!
      .getBoundingClientRect();
    const code = node.querySelector("pre")!.getBoundingClientRect();
    const content = node.querySelector<HTMLElement>(
      ".user-message-text-content",
    )!;
    return {
      clipBottom: clip.bottom,
      codeTop: code.top,
      codeBottom: code.bottom,
      defaultBottom:
        clip.top + parseFloat(getComputedStyle(content).lineHeight) * 19,
      natural: content.scrollHeight,
      clipped: clip.height,
    };
  });
  expect(bounds.codeTop).toBeLessThan(bounds.defaultBottom);
  expect(bounds.codeBottom).toBeGreaterThan(bounds.defaultBottom);
  expect(bounds.codeBottom).toBeLessThanOrEqual(bounds.clipBottom + 1);
  expect(bounds.natural).toBeGreaterThan(bounds.clipped);
});

test("clipped links leave keyboard and accessibility navigation and restore on expansion and print", async ({
  page,
}) => {
  const text =
    "[首行链接](https://example.com/first)\n" +
    Array.from({ length: 45 }, (_, i) => `第${i + 1}行`).join("\n") +
    "\n[末尾链接](https://example.com/last)";
  const message = await fixture(page, text);
  const root = message.locator(".user-message-text");
  const first = root.locator('a[href="https://example.com/first"]');
  const last = root.locator('a[href="https://example.com/last"]');
  await expect(root).toHaveAttribute("data-collapsed", "true");
  await expect(first).not.toHaveAttribute("inert");
  await expect(last).toHaveAttribute("inert", "");
  await expect(last).toHaveAttribute("aria-hidden", "true");
  await expect(
    root.getByRole("link", { name: "末尾链接", exact: true }),
  ).toHaveCount(0);
  await root.getByRole("button", { name: "显示更多", exact: true }).click();
  await expect(last).not.toHaveAttribute("inert");
  await expect(last).not.toHaveAttribute("aria-hidden");
  await root.getByRole("button", { name: "收起", exact: true }).click();
  await expect(last).toHaveAttribute("inert", "");
  await page.emulateMedia({ media: "print" });
  await expect(root.locator(".user-message-text-clip")).toHaveCSS(
    "max-height",
    "none",
  );
  await expect(last).not.toHaveAttribute("inert");
  await expect(root.getByRole("button")).toHaveCount(0);
  await page.emulateMedia({ media: "screen" });
  await expect(root).toHaveAttribute("data-collapsed", "true");
  await expect(last).toHaveAttribute("inert", "");
});

test("resizing the same full text recalculates whether twenty visual lines need disclosure", async ({
  page,
}) => {
  const message = await fixture(page, "按宽度重新测量。".repeat(90));
  const root = message.locator(".user-message-text");
  await root.evaluate((node) => {
    (node as HTMLElement).style.width = "1000px";
  });
  await expect(
    root.getByRole("button", { name: "显示更多", exact: true }),
  ).toHaveCount(0);
  await root.evaluate((node) => {
    (node as HTMLElement).style.width = "200px";
  });
  await expect(
    root.getByRole("button", { name: "显示更多", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await root.evaluate((node) => {
    (node as HTMLElement).style.width = "1000px";
  });
  await expect(
    root.getByRole("button", { name: "显示更多", exact: true }),
  ).toHaveCount(0);
});

test("pre-cut user text mounts only 10,240 units while copy, expansion and print preserve the full message", async ({
  page,
}) => {
  const text = "超长消息按原始字符预切。".repeat(2_500) + "全文唯一末尾";
  const message = await fixture(page, text);
  const root = message.locator(".user-message-text");
  const content = root.locator(".user-message-text-content");
  const preview = text.slice(0, 10_240);
  await expect(root).toHaveAttribute("data-collapsed", "true");
  expect(await content.textContent()).toBe(preview);
  await expect(content).not.toContainText("全文唯一末尾");

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          const item = items[0];
          (window as any).precutCopy = {
            plain: await (await item.getType("text/plain")).text(),
            html: await (await item.getType("text/html")).text(),
          };
        },
      },
    });
  });
  await message.getByRole("button", { name: "复制消息", exact: true }).click();
  await expect
    .poll(async () => page.evaluate(() => (window as any).precutCopy?.plain))
    .toBe(text);
  expect(await page.evaluate(() => (window as any).precutCopy.html)).toContain(
    "全文唯一末尾",
  );
  expect(await content.textContent()).toBe(preview);
  await expect(root).toHaveAttribute("data-collapsed", "true");
  await expect(
    root.getByRole("button", { name: "显示更多", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");

  await root.getByRole("button", { name: "显示更多", exact: true }).click();
  expect(await content.textContent()).toBe(text);
  await root.getByRole("button", { name: "收起", exact: true }).click();
  expect(await content.textContent()).toBe(preview);

  // Printing restores the original source, rather than merely lifting CSS clipping.
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  expect(await content.textContent()).toBe(text);
  await expect(root.getByRole("button")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  expect(await content.textContent()).toBe(preview);
  await page.emulateMedia({ media: "print" });
  await expect(content).toContainText("全文唯一末尾");
  await expect(root.locator(".user-message-text-clip")).toHaveCSS(
    "max-height",
    "none",
  );
  await page.emulateMedia({ media: "screen" });
  await expect.poll(async () => content.textContent()).toBe(preview);
});

test("pre-cut Markdown keeps the literal boundary and does not extend a crossing code block", async ({
  page,
}) => {
  const prefix =
    Array.from({ length: 15 }, (_, index) => `前文第${index + 1}行`).join(
      "\n",
    ) + "\n\n```ts\n";
  const firstCode = ("x".repeat(200) + "\n").repeat(70);
  const text = prefix + firstCode + "END_OF_CODE\n```\n\n未挂载末尾";
  const message = await fixture(page, text);
  const root = message.locator(".user-message-text");
  await expect(root).toHaveAttribute("data-collapsed", "true");
  const code = root.locator("pre code");
  await expect(code).not.toContainText("END_OF_CODE");
  await expect(root.locator(".user-message-text-content")).not.toContainText(
    "未挂载末尾",
  );
  const bounds = await root.evaluate((node) => {
    const clip = node.querySelector<HTMLElement>(".user-message-text-clip")!;
    const content = node.querySelector<HTMLElement>(
      ".user-message-text-content",
    )!;
    return {
      height: clip.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(content).lineHeight),
    };
  });
  expect(Math.abs(bounds.height - bounds.line * 19)).toBeLessThanOrEqual(1);
  await root.getByRole("button", { name: "显示更多", exact: true }).click();
  await expect(code).toContainText("END_OF_CODE");
  await expect(root.locator(".user-message-text-content")).toContainText(
    "未挂载末尾",
  );
});

test("long source forces disclosure even when horizontal code occupies fewer than twenty visual lines", async ({
  page,
}) => {
  const code = "x".repeat(11_000);
  const message = await fixture(page, "```txt\n" + code + "\n```");
  const root = message.locator(".user-message-text");
  await expect(root).toHaveAttribute("data-collapsed", "true");
  const natural = await root
    .locator(".user-message-text-content")
    .evaluate((element) => ({
      height: element.scrollHeight,
      line: parseFloat(getComputedStyle(element).lineHeight),
    }));
  expect(natural.height).toBeLessThan(natural.line * 20);
  const more = root.getByRole("button", { name: "显示更多", exact: true });
  await expect(more).toBeVisible();
  await more.click();
  expect(await root.locator("pre code").textContent()).toBe(code + "\n");
  await root.getByRole("button", { name: "收起", exact: true }).click();
  await expect(more).toBeVisible();
  expect((await root.locator("pre code").textContent())?.length).toBeLessThan(
    code.length,
  );
});
