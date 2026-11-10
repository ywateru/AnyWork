import { test, expect, type BrowserContext, type Page } from "./local-fixture";
import { expectPromptText, fillPromptText } from "./prompt-editor-helpers";

const id = "review-session";
const patch =
  "diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -5,2 +5,3 @@ function main\n keep\n-old value\n+new value\n+extra line\ndiff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\ndiff --git a/image.png b/image.png\nnew file mode 100644\nBinary files /dev/null and b/image.png differ\n";
async function fixture(
  context: BrowserContext,
  page: Page,
  route = `${id}?view=review`,
  source?: string,
  initialPatch = patch,
) {
  const state = {
    requests: [] as URL[],
    commitRequests: [] as URL[],
    commitError: false,
    commitEmpty: false,
    commitHold: null as Promise<void> | null,
    commits: Array.from({ length: 40 }, (_, i) => ({
      sha: i.toString(16).padStart(40, "a"),
      subject: `实现提交 ${i} 的会话与输入交互，这是一条需要省略显示的长提交标题`,
      message: `实现提交 ${i} 的会话与输入交互，这是一条需要省略显示的长提交标题\n\n完整提交说明 ${i}\n保留第二行`,
      committed_at: "2026-11-04T10:30:00+08:00",
    })),
    posts: [] as string[],
    error: false,
    empty: false,
    expected: false,
    hold: null as Promise<void> | null,
    held: "",
    patch: initialPatch,
  };
  const session = {
    id,
    agent: "codex",
    thread_id: "019b1234-1234-7123-8123-123456789abc",
    title: "审阅工作区",
    cwd: "/workspace",
    model: null,
    policy: "manual",
    status: "idle",
    archived: false,
    created_at: 1,
    updated_at: 1,
  };
  await context.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/local/session")
      return route.fallback();
    const url = new URL(route.request().url()),
      path = url.pathname.slice(4);
    if (route.request().method() !== "GET") state.posts.push(path);
    let data: unknown = {};
    if (path === "/info")
      data = { workspace: "/workspace", hostname: "review-fixture" };
    else if (path === "/plugins")
      data = { plugins: [{ id: "codex", name: "Codex", capabilities: [] }] };
    else if (path === "/workspaces") data = { workspaces: [] };
    else if (path === "/sessions") data = { sessions: [session] };
    else if (path === `/sessions/${id}`) data = { session };
    else if (path.endsWith("/history"))
      data = { events: [], latest_seq: 0, next_cursor: null };
    else if (path.endsWith("/events/poll")) data = { events: [] };
    else if (path.endsWith("/composer"))
      data = { settings_available: false, models: [], goal: null };
    else if (path.endsWith("/queue")) data = { items: [], paused: false };
    else if (path.endsWith("/models")) data = { data: [] };
    else if (path.endsWith("/edit")) data = { operation: null };
    else if (path.endsWith("/feedback")) data = { feedback: [] };
    else if (path.endsWith("/review/commits")) {
      state.commitRequests.push(url);
      const captured = state.commitEmpty ? [] : [...state.commits];
      if (state.commitHold) await state.commitHold;
      if (state.commitError) {
        await route.fulfill({
          status: 500,
          json: { error: "commit fixture failure" },
        });
        return;
      }
      data = { type: "success", commits: captured };
    } else if (path.endsWith("/review")) {
      state.requests.push(url);
      const capturedPatch = state.patch;
      if (state.hold && url.searchParams.get("source") === state.held)
        await state.hold;
      if (state.error) {
        await route.fulfill({ status: 500, json: { error: "临时读取失败" } });
        return;
      }
      data = {
        type: state.expected ? "expected" : "success",
        reason: "default-branch-unavailable",
        source: url.searchParams.get("source"),
        diff: state.empty ? "" : capturedPatch,
        root: "/workspace",
        current_branch: "feature",
        base_branch: "origin/main",
        branches: ["main", "feature", "origin/main"],
      };
    } else if (path === `/sessions/${id}/files`)
      data =
        url.searchParams.get("path") === "/workspace/src/main.ts"
          ? {
              path: "/workspace/src/main.ts",
              content: "export const preview = true;",
            }
          : { path: "/workspace", entries: [] };
    else throw new Error(`Unexpected review request: ${path}`);
    await route.fulfill({ json: data });
  });
  await context.addInitScript(
    ({ source }) => {
      localStorage.setItem("ra.sidebar-pinned", "false");
      localStorage.setItem("ra.theme", "system");
      if (source) localStorage.setItem("anywork.review.source", source);
    },
    { source },
  );
  await page.goto(`/#${route}`);
  await expect(page.locator(".review-panel")).toBeVisible();
  return state;
}
async function source(page: Page, name: string) {
  await page.getByRole("button", { name: "差异来源", exact: true }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}
async function option(page: Page, name: string) {
  await page.getByRole("button", { name: "变更选项", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name, exact: true }).click();
}

test("review renders exact patch lines, rename and binary metadata in responsive split view", async ({
  context,
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = await fixture(context, page);
  await expect(
    page.getByRole("region", { name: "src/main.ts 差异", exact: true }),
  ).toContainText("new value");
  await expect(page.locator(".review-toolbar .review-total")).toHaveAttribute(
    "aria-label",
    "2 行新增，1 行删除",
  );
  await expect(page.locator('[data-review-path="new.ts"]')).toContainText(
    "old.ts → new.ts",
  );
  await expect(page.locator('[data-review-path="image.png"]')).toContainText(
    "二进制文件已更改",
  );
  await expect(
    page
      .locator(
        ".review-code [data-column-number][data-line-type=change-deletion]",
      )
      .first(),
  ).toHaveText("6");
  await option(page, "左右对照");
  await expect(page.locator(".review-panel")).toHaveClass(/review-split/);
  await expect(
    page.locator(".review-code [data-diff-type=split]"),
  ).toBeVisible();
  await expect(
    page.locator(".review-code [data-deletions] [data-line]"),
  ).toContainText(["keep", "old value"]);
  await expect(
    page.locator(".review-code [data-additions] [data-line]"),
  ).toContainText(["keep", "new value", "extra line"]);
  const gutter = await page
    .locator(".review-code [data-column-number]")
    .first()
    .boundingBox();
  // Native global tokens reserve four digits plus three ch of padding.
  expect(gutter!.width).toBeGreaterThan(40);
  expect(gutter!.width).toBeLessThan(65);
  await option(page, "自动换行");
  await expect(page.locator(".review-panel")).toHaveClass(/review-wrap/);
  await page.screenshot({
    path: `artifacts/anywork-review-${info.project.name}.png`,
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: `artifacts/anywork-review-dark-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(state.posts).toEqual([]);
  expect(errors).toEqual([]);
});

test("source menu selects each comparison, preserves explicit choice and branch query", async ({
  context,
  page,
}) => {
  const state = await fixture(context, page);
  expect(state.requests[0].searchParams.get("source")).toBe("branch");
  for (const [label, value] of [
    ["未提交", "uncommitted"],
    ["未暂存", "unstaged"],
    ["已暂存", "staged"],
    ["最后一轮", "last-turn"],
    ["分支", "branch"],
  ]) {
    await source(page, label);
    await expect
      .poll(() => state.requests.at(-1)?.searchParams.get("source"))
      .toBe(value);
    await expect(page.locator(".review-content")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  }
  await page.getByRole("combobox", { name: "基准分支" }).selectOption("main");
  await expect
    .poll(() => state.requests.at(-1)?.searchParams.get("base_branch"))
    .toBe("main");
  await option(page, "忽略空白变更");
  await expect
    .poll(() => state.requests.at(-1)?.searchParams.get("hide_whitespace"))
    .toBe("true");
  await source(page, "已暂存");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "差异来源", exact: true }),
  ).toHaveText("已暂存");
  expect(state.posts).toEqual([]);
});

test("review link overrides stored source, survives reload and closes back to the draft", async ({
  context,
  page,
}) => {
  await fixture(
    context,
    page,
    `${id}?view=review&diffFilter=last-turn&path=src%2Fmain.ts`,
    "staged",
  );
  await expect(
    page.getByRole("button", { name: "差异来源", exact: true }),
  ).toHaveText("最后一轮");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "差异来源", exact: true }),
  ).toHaveText("最后一轮");
  await page.getByRole("button", { name: "关闭侧面板", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#${id}$`));
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await fillPromptText(input, "保留审阅前的草稿");
  await page.goBack();
  await expect(page.locator(".review-panel")).toBeVisible();
  await page.getByRole("button", { name: "关闭侧面板", exact: true }).click();
  await expectPromptText(input, "保留审阅前的草稿");
});

test("file and all-file folding, keyboard menus and focus restoration", async ({
  context,
  page,
}) => {
  await fixture(context, page);
  const file = page.locator('[data-review-path="src/main.ts"]');
  await file.getByRole("button", { name: "src/main.ts", exact: true }).click();
  await expect(file.getByRole("region")).toHaveCount(0);
  const trigger = page.getByRole("button", { name: "变更选项", exact: true });
  await trigger.focus();
  await trigger.press("ArrowDown");
  await expect(
    page.getByRole("menuitemcheckbox", { name: "左右对照", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitem", { name: "折叠所有差异", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
  await expect(page.locator(".review-file-body")).toHaveCount(0);
  await trigger.click();
  await page
    .getByRole("menuitem", { name: "展开所有差异", exact: true })
    .click();
  await expect(file.getByRole("region")).toBeVisible();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("error retry, empty turn and unavailable default remain distinguishable", async ({
  context,
  page,
}) => {
  const state = await fixture(context, page);
  state.error = true;
  await page.getByRole("button", { name: "刷新差异", exact: true }).click();
  await expect(page.locator(".review-panel [role=alert]")).toContainText(
    "临时读取失败",
  );
  state.error = false;
  state.empty = true;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".review-empty")).toContainText("暂无变更");
  await source(page, "最后一轮");
  await expect(page.locator(".review-empty")).toContainText("这一轮暂无变更");
  await page.getByRole("button", { name: "变更选项", exact: true }).click();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "忽略空白变更", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  state.expected = true;
  await source(page, "分支");
  await expect(page.locator(".review-empty")).toContainText(
    "选择基准分支以查看变更",
  );
});

test("a late response from a previous source cannot replace the current patch", async ({
  context,
  page,
}) => {
  const state = await fixture(context, page);
  let release!: () => void;
  state.held = "staged";
  state.hold = new Promise((resolve) => (release = resolve));
  await source(page, "已暂存");
  await expect
    .poll(() => state.requests.at(-1)?.searchParams.get("source"))
    .toBe("staged");
  state.patch = patch.replace("new value", "current unstaged value");
  await source(page, "未暂存");
  await expect(page.locator(".review-code")).toContainText(
    "current unstaged value",
  );
  release();
  state.hold = null;
  await expect(
    page.getByRole("button", { name: "差异来源", exact: true }),
  ).toHaveText("未暂存");
  await expect(page.locator(".review-code")).toContainText(
    "current unstaged value",
  );
});

test("review path scrolls to the requested file once and opens files from repository root", async ({
  context,
  page,
}) => {
  const many =
    Array.from(
      { length: 35 },
      (_, i) =>
        `diff --git a/file-${i}.ts b/file-${i}.ts\n--- a/file-${i}.ts\n+++ b/file-${i}.ts\n@@ -1 +1 @@\n-old-${i}\n+new-${i}\n`,
    ).join("") + patch;
  await fixture(
    context,
    page,
    `${id}?view=review&diffFilter=last-turn&path=%2Fworkspace%2Fsrc%2Fmain.ts`,
    undefined,
    many,
  );
  const content = page.locator(".review-content");
  await expect
    .poll(() => content.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  await content.evaluate((el) => (el.scrollTop = 0));
  await page.getByRole("button", { name: "刷新差异", exact: true }).click();
  await expect(content).toHaveAttribute("aria-busy", "false");
  expect(await content.evaluate((el) => el.scrollTop)).toBe(0);
  await page
    .getByRole("button", { name: "打开文件 src/main.ts", exact: true })
    .click();
  await expect(page.locator(".workspace-panel")).toContainText(
    "export const preview = true;",
  );
});

async function openCommits(page: Page) {
  await page.getByRole("button", { name: "差异来源", exact: true }).click();
  await page.getByRole("menuitem", { name: "提交", exact: true }).click();
  return page.getByRole("menu", { name: "分支提交", exact: true });
}

test("commit submenu selects exact SHA, keeps full message and returns to the last explicit source after reload", async ({
  context,
  page,
}, info) => {
  const state = await fixture(context, page);
  await source(page, "已暂存");
  const menu = await openCommits(page);
  const item = menu.locator("button[data-commit]").nth(2);
  await expect(menu.locator("button[data-commit]")).toHaveCount(40);
  if (info.project.name === "desktop")
    await page
      .getByRole("menuitem", { name: "提交", exact: true })
      .press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(item).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveText(state.commits[2].message);
  await expect(menu.locator("time").first()).not.toHaveText("");
  await item.click();
  await expect
    .poll(() => state.requests.at(-1)?.searchParams.get("commit"))
    .toBe(state.commits[2].sha);
  await expect(page.getByLabel("选中的提交", { exact: true })).toHaveText(
    state.commits[2].subject,
  );
  await page.keyboard.press("Escape");
  await page.getByLabel("选中的提交", { exact: true }).focus();
  await expect(page.getByRole("tooltip")).toHaveText(state.commits[2].message);
  await expect(
    page.getByRole("button", { name: "差异来源", exact: true }),
  ).toHaveText("提交");
  expect(
    await page.evaluate(() => localStorage.getItem("anywork.review.source")),
  ).toBe("staged");
  const again = await openCommits(page);
  await expect(again.locator('[aria-current="true"]')).toHaveAttribute(
    "data-commit",
    state.commits[2].sha,
  );
  if (info.project.name === "desktop") {
    await expect(
      page.getByRole("menuitem", { name: "提交", exact: true }),
    ).toBeFocused();
  } else {
    await expect(again.locator('[aria-current="true"]')).toBeFocused();
  }
  const box = await again.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  if (info.project.name === "desktop") {
    const triggerBox = await page
      .getByRole("menuitem", { name: "提交", exact: true })
      .boundingBox();
    expect(Math.abs(box!.y - (triggerBox!.y - 5))).toBeLessThanOrEqual(1);
  }
  await page.screenshot({
    path: `artifacts/anywork-review-commit-${info.project.name}.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "差异来源", exact: true }),
  ).toHaveText("已暂存");
  expect(state.posts).toEqual([]);
});

test("commit submenu keyboard navigation, return, outside dismissal and branch selection", async ({
  context,
  page,
}) => {
  const state = await fixture(context, page);
  await page.getByRole("combobox", { name: "基准分支" }).selectOption("main");
  const trigger = page.getByRole("button", { name: "差异来源", exact: true });
  await trigger.click();
  const submenuTrigger = page.getByRole("menuitem", {
    name: "提交",
    exact: true,
  });
  await submenuTrigger.focus();
  await submenuTrigger.press("ArrowRight");
  const menu = page.getByRole("menu", { name: "分支提交", exact: true });
  await expect(menu.locator("button[data-commit]").first()).toBeFocused();
  expect(state.commitRequests.at(-1)?.searchParams.get("base_branch")).toBe(
    "main",
  );
  await page.keyboard.press("End");
  await expect(menu.locator("button[data-commit]").last()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.locator("button[data-commit]").nth(38)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(submenuTrigger).toBeFocused();
  await expect(menu).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(menu).toBeVisible();
  if (page.viewportSize()!.width < 768) {
    await menu.getByRole("menuitem", { name: "提交", exact: true }).click();
    await expect(submenuTrigger).toBeFocused();
    await submenuTrigger.click();
  }
  await page.getByRole("button", { name: "刷新差异", exact: true }).click();
  await expect(menu).toHaveCount(0);
  expect(
    state.requests.every((url) => url.searchParams.get("source") !== "commit"),
  ).toBe(true);
  expect(state.posts).toEqual([]);
});

test("commit loading, retry and empty list preserve the existing comparison", async ({
  context,
  page,
}) => {
  const state = await fixture(context, page);
  let release!: () => void;
  state.commitHold = new Promise((resolve) => (release = resolve));
  state.commitError = true;
  const menu = await openCommits(page);
  await expect(menu.getByRole("status")).toHaveText("正在加载提交…");
  release();
  state.commitHold = null;
  await expect(menu.getByRole("alert")).toHaveText("无法加载提交");
  state.commitError = false;
  await menu.getByRole("menuitem", { name: "重试", exact: true }).click();
  await expect(menu.locator("button[data-commit]")).toHaveCount(40);
  await expect(menu.locator("button[data-commit]").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  state.commitEmpty = true;
  await openCommits(page);
  await expect(menu.getByRole("status")).toHaveText("分支上没有提交");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "差异来源", exact: true }),
  ).toHaveText("分支");
  await expect(page.locator(".review-code")).toContainText("new value");
});

test("dismissed commit loads cannot replace a reopened list and changing commits cannot replace the draft", async ({
  context,
  page,
}) => {
  const state = await fixture(context, page);
  let release!: () => void;
  state.commitHold = new Promise((resolve) => (release = resolve));
  const menu = await openCommits(page);
  await expect(menu.getByRole("status")).toHaveText("正在加载提交…");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  state.commitHold = null;
  state.commits = [
    { ...state.commits[0], subject: "new branch commit", sha: "b".repeat(40) },
  ];
  await openCommits(page);
  await expect(menu.locator("button[data-commit]")).toHaveCount(1);
  release();
  await expect(menu.locator("button[data-commit]")).toHaveCount(1);
  await expect(menu.locator("button[data-commit]")).toContainText(
    "new branch commit",
  );
  await menu.locator("button[data-commit]").click();
  await expect
    .poll(() => state.requests.at(-1)?.searchParams.get("commit"))
    .toBe("b".repeat(40));
  await page.getByRole("button", { name: "关闭侧面板", exact: true }).click();
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await fillPromptText(input, "审阅提交时保留草稿");
  await page.goBack();
  await expect(page.locator(".review-panel")).toBeVisible();
  await openCommits(page);
  await menu.locator("button[data-commit]").click();
  await page.getByRole("button", { name: "关闭侧面板", exact: true }).click();
  await expectPromptText(input, "审阅提交时保留草稿");
  expect(state.posts).toEqual([]);
});

test("real Git commit submenu and HTTP review agree while local modifications remain untouched", async ({
  page,
  request,
}, info) => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const headers = { Authorization: "Bearer browser-integration-test-token" };
  const server = await (await request.get("/api/info", { headers })).json();
  const root = mkdtempSync(
    `${server.workspace}/review-commit-${info.project.name}-`,
  );
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        root,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        ...args,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  git("init", "-b", "main");
  writeFileSync(`${root}/tracked.txt`, "base version\n");
  git("add", ".");
  git("commit", "-m", "baseline");
  git("checkout", "-b", "feature");
  writeFileSync(`${root}/tracked.txt`, "selected commit version\n");
  git("commit", "-am", "审阅真实提交", "-m", "这是完整提交说明\n第二行说明");
  const sha = git("rev-parse", "HEAD");
  writeFileSync(`${root}/tracked.txt`, "staged version\n");
  git("add", ".");
  writeFileSync(`${root}/tracked.txt`, "working version\n");
  writeFileSync(`${root}/new.txt`, "untracked version\n");
  const status = git("status", "--porcelain=v1");
  const created = await (
    await request.post("/api/sessions", {
      headers,
      data: { agent: "fixture", cwd: root, title: "真实提交审阅" },
    })
  ).json();
  const sid = created.session.id;
  try {
    await page.addInitScript(() => {
      localStorage.setItem("ra.sidebar-pinned", "false");
      localStorage.setItem("anywork.review.source", "branch");
    });
    await page.goto(`/#${sid}?view=review`);
    await page.getByRole("combobox", { name: "基准分支" }).selectOption("main");
    const menu = await openCommits(page);
    await expect(menu.locator("button[data-commit]")).toHaveCount(1);
    await expect(menu.locator("button[data-commit]")).toHaveAttribute(
      "data-commit",
      sha,
    );
    await menu.locator("button[data-commit]").click();
    await expect(
      page.getByRole("region", {
        name: "tracked.txt \u5dee\u5f02",
        exact: true,
      }),
    ).toContainText("selected commit version");
    await expect(
      page.getByRole("region", {
        name: "tracked.txt \u5dee\u5f02",
        exact: true,
      }),
    ).not.toContainText("working version");
    await expect(
      page.getByRole("region", {
        name: "tracked.txt \u5dee\u5f02",
        exact: true,
      }),
    ).not.toContainText("staged version");
    await expect(page.locator(".review-panel")).not.toContainText("new.txt");
    expect(git("status", "--porcelain=v1")).toBe(status);
  } finally {
    await request.delete(`/api/sessions/${sid}`, { headers });
    // All files belong to the disposable browser server workspace.
    rmSync(root, { recursive: true, force: true });
  }
});

test("commit flyout waits 200ms, cancels on leave or keyboard, and ignores touch hover", async ({
  context,
  page,
}, info) => {
  const state = await fixture(context, page);
  await page.getByRole("button", { name: "差异来源", exact: true }).click();
  const trigger = page.getByRole("menuitem", { name: "提交", exact: true });
  const menu = page.getByRole("menu", { name: "分支提交", exact: true });
  const clockStart = new Date("2026-11-06T08:00:00Z");
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000));
  await trigger.dispatchEvent("pointerover", { pointerType: "touch" });
  await page.clock.runFor(250);
  await expect(menu).toHaveCount(0);
  await trigger.dispatchEvent("pointerout", { pointerType: "touch" });
  await trigger.dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.clock.runFor(199);
  await expect(menu).toHaveCount(0);
  await trigger.dispatchEvent("pointerout", { pointerType: "mouse" });
  await page.clock.runFor(50);
  await expect(menu).toHaveCount(0);
  await trigger.dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.keyboard.press("Shift");
  await page.clock.runFor(250);
  await expect(menu).toHaveCount(0);
  await trigger.dispatchEvent("pointermove", { pointerType: "mouse" });
  await page.clock.runFor(199);
  await expect(menu).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(menu).toBeVisible();
  await expect(menu.locator("button[data-commit]")).toHaveCount(40);
  if (info.project.name === "desktop") {
    await expect(trigger).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitemradio", { name: "分支", exact: true }),
    ).toBeFocused();
    await expect(menu).toHaveCount(0);
    await trigger.press("Enter");
    await expect(menu.locator("button[data-commit]").first()).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.getByRole("button", { name: "差异来源", exact: true }).click();
  await page.clock.runFor(300);
  await expect(menu).toHaveCount(0);
  expect(state.posts).toEqual([]);
});

test("commit tooltip requires truncated subject, waits on hover, opens immediately by keyboard and never steals focus", async ({
  context,
  page,
}, info) => {
  const state = await fixture(context, page);
  state.commits = [
    {
      ...state.commits[0],
      subject: "短标题",
      message: "短标题\n\n不应弹出此说明",
    },
    state.commits[1],
    state.commits[2],
  ];
  const menu = await openCommits(page);
  const rows = menu.locator("button[data-commit]"),
    tooltip = page.getByRole("tooltip");
  await expect(rows).toHaveCount(3);
  const clockStart = new Date("2026-11-06T08:00:00Z");
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000));
  await rows.first().dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.clock.runFor(250);
  await expect(tooltip).toHaveCount(0);
  await rows.first().dispatchEvent("pointerout", { pointerType: "mouse" });
  await rows.nth(1).dispatchEvent("pointerover", { pointerType: "touch" });
  await page.clock.runFor(250);
  await expect(tooltip).toHaveCount(0);
  await rows.nth(1).dispatchEvent("pointerout", { pointerType: "touch" });
  await rows.nth(1).dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.clock.runFor(199);
  await expect(tooltip).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(tooltip).toHaveText(state.commits[1].message);
  await expect(rows.nth(1)).toHaveAttribute(
    "aria-describedby",
    (await tooltip.getAttribute("id")) as string,
  );
  expect(await tooltip.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe(
    "pre-wrap",
  );
  expect(
    await tooltip.evaluate((el) => getComputedStyle(el).pointerEvents),
  ).toBe("none");
  expect(
    await tooltip.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(false);
  const box = await tooltip.boundingBox(),
    viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(box!.y).toBeGreaterThanOrEqual(8);
  await rows.nth(1).dispatchEvent("pointerout", { pointerType: "mouse" });
  await expect(tooltip).toHaveCount(0);
  await expect(rows.nth(1)).not.toHaveAttribute("aria-describedby");
  if (info.project.name === "desktop")
    await page
      .getByRole("menuitem", { name: "提交", exact: true })
      .press("ArrowRight");
  await rows.first().press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await expect(tooltip).toHaveText(state.commits[1].message);
  await page.keyboard.press("ArrowDown");
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toHaveText(state.commits[2].message);
  await page.screenshot({
    path: `artifacts/anywork-review-tooltip-${info.project.name}.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  expect(state.posts).toEqual([]);
});

test("commit tooltip cancels pending hover on blur and cleans up after context menu, scroll or unmount", async ({
  context,
  page,
}) => {
  const state = await fixture(context, page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const menu = await openCommits(page),
    row = menu.locator("button[data-commit]").first();
  await expect(row).toBeVisible();
  await row.dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(250);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await row.dispatchEvent("pointerout", { pointerType: "mouse" });
  await row.dispatchEvent("pointerover", { pointerType: "mouse" });
  await expect(page.getByRole("tooltip")).toHaveText(state.commits[0].message);
  await row.dispatchEvent("contextmenu");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await row.dispatchEvent("pointerout", { pointerType: "mouse" });
  await row.dispatchEvent("pointerover", { pointerType: "mouse" });
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.locator(".review-commit-list").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const again = await openCommits(page);
  await again.locator("button[data-commit]").first().click();
  await page.keyboard.press("Escape");
  await page.mouse.move(10, 650);
  await page.getByLabel("选中的提交", { exact: true }).focus();
  await expect(page.getByRole("tooltip")).toHaveText(state.commits[0].message);
  await page.setViewportSize({ width: 390, height: 700 });
  await expect
    .poll(async () => {
      const box = await page.getByRole("tooltip").boundingBox();
      return box && box.x >= 8 && box.x + box.width <= 382;
    })
    .toBe(true);
  await page.getByRole("button", { name: "关闭侧面板", exact: true }).click();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.waitForTimeout(250);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(state.posts).toEqual([]);
});

const coloredPatch =
  'diff --git a/src/label.ts b/src/label.ts\n--- a/src/label.ts\n+++ b/src/label.ts\n@@ -1,3 +1,3 @@\n export function label() {\n-  return "before"; // old label\n+  return "after"; // new label\n }\n\\ No newline at end of file\n';

test("Pierre diff preserves Codex syntax colors, word emphasis and missing-newline markers across themes", async ({
  context,
  page,
}, info) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /theme|highlight|diffs|render/i.test(message.text())
    )
      failures.push(message.text());
  });
  await fixture(context, page, `${id}?view=review`, undefined, coloredPatch);
  const code = page.getByRole("region", {
    name: "src/label.ts 差异",
    exact: true,
  });
  await expect(
    code.locator("[data-line]", { hasText: 'return "after"' }),
  ).toBeVisible();
  const changed = code
    .locator("[data-line-type=change-addition] [data-diff-span]")
    .filter({ hasText: "after" })
    .first();
  await expect(changed).toHaveText("after");
  await expect(code.locator("[data-no-newline]").first()).toBeVisible();
  await expect(code.locator("[data-indicators=bars]")).toBeVisible();
  for (const [mode, color] of [
    ["light", "rgb(0, 136, 9)"],
    ["dark", "rgb(133, 223, 123)"],
  ] as const) {
    await page.emulateMedia({ colorScheme: mode });
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await expect(changed.locator("span")).toHaveCSS("color", color);
    await expect(code.locator("[data-line]").first()).toHaveCSS(
      "line-height",
      "21.6px",
    );
    await page.screenshot({
      path: `artifacts/anywork-pierre-${mode}-${info.project.name}.png`,
      fullPage: true,
    });
  }
  expect(failures).toEqual([]);
});

test("Pierre diff wraps long source lines and retains selected code through refresh", async ({
  context,
  page,
}) => {
  const line = `const message = "${"中文🙂 ".repeat(90)}";`;
  const longPatch = `diff --git a/long.ts b/long.ts\n--- a/long.ts\n+++ b/long.ts\n@@ -1 +1 @@\n-const message = "before";\n+${line}\n`;
  const state = await fixture(
    context,
    page,
    `${id}?view=review`,
    undefined,
    longPatch,
  );
  const code = page.getByRole("region", { name: "long.ts 差异", exact: true });
  const addition = code.locator("[data-line][data-line-type=change-addition]");
  await expect(addition).toContainText("中文🙂");
  const scroller = code.locator("[data-code]").first();
  expect(
    await scroller.evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  await option(page, "自动换行");
  await expect(code.locator("[data-overflow=wrap]")).toBeVisible();
  const box = await addition.boundingBox();
  expect(box!.height).toBeGreaterThan(43);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await addition.evaluate((node) => {
    const selection = document.getSelection()!,
      range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  });
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(
    line,
  );
  // Programmatic click keeps the user's source selection intact.
  await page
    .getByRole("button", { name: "刷新差异", exact: true })
    .evaluate((node: HTMLButtonElement) => node.click());
  await expect.poll(() => state.requests.length).toBeGreaterThan(1);
  await expect(page.locator(".review-content")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(
    line,
  );
});

test("malformed diff falls back to exact inert patch while the next file still renders", async ({
  context,
  page,
}) => {
  const broken =
    'diff --git a/broken.txt b/broken.txt\n--- a/broken.txt\n+++ b/broken.txt\n@@ -1 +1 @@\n-old\n+<img src=x onerror="globalThis.diffInjected=true">\n+unexpected extra line\n';
  await fixture(
    context,
    page,
    `${id}?view=review`,
    undefined,
    broken + coloredPatch,
  );
  const fallback = page.getByRole("region", {
    name: "broken.txt 差异",
    exact: true,
  });
  await expect(fallback.getByRole("status")).toHaveText(
    "无法解析这段差异，显示原始补丁。",
  );
  await expect(fallback.locator("pre")).toHaveText(broken);
  expect(await fallback.locator("pre").textContent()).toBe(broken);
  await expect(fallback.locator("img")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (globalThis as typeof globalThis & { diffInjected?: boolean })
          .diffInjected,
    ),
  ).toBeUndefined();
  await expect(
    page
      .getByRole("region", { name: "src/label.ts 差异", exact: true })
      .locator("[data-line]")
      .filter({ hasText: 'return "after"' }),
  ).toBeVisible();
});

test("unavailable syntax grammar shows plain diff with word emphasis instead of a stuck skeleton", async ({
  context,
  page,
}) => {
  let blocked = 0;
  await context.route("**/assets/typescript-*.js", async (route) => {
    blocked++;
    await route.abort("failed");
  });
  await fixture(context, page, `${id}?view=review`, undefined, coloredPatch);
  const code = page.getByRole("region", {
    name: "src/label.ts 差异",
    exact: true,
  });
  await expect(code.getByRole("status")).toHaveText(
    "语法着色暂不可用，已显示差异内容。",
  );
  await expect(
    code.locator("[data-line]").filter({ hasText: 'return "after"' }),
  ).toBeVisible();
  await expect(
    code.locator("[data-diff-span]").filter({ hasText: "after" }).first(),
  ).toBeVisible();
  expect(blocked).toBeGreaterThan(0);
});

test("large diffs retain every row while native threshold disables word emphasis", async ({
  context,
  page,
}) => {
  const count = 1001;
  const lines = Array.from(
    { length: count },
    (_, i) => `const value${i} = "before";`,
  );
  const patch = `diff --git a/large.ts b/large.ts\n--- a/large.ts\n+++ b/large.ts\n@@ -1,${count} +1,${count} @@\n${lines.map((line) => "-" + line).join("\n")}\n${lines.map((line) => "+" + line.replace("before", "after")).join("\n")}\n`;
  await fixture(context, page, `${id}?view=review`, undefined, patch);
  const code = page.getByRole("region", { name: "large.ts 差异", exact: true });
  await expect(code.locator("[data-line]")).toHaveCount(count * 2);
  await expect(code.locator("[data-diff-span]")).toHaveCount(0);
  await expect(code.locator("[data-line]").last()).toHaveText(
    'const value1000 = "after";',
  );
  await code.locator("[data-line]").last().scrollIntoViewIfNeeded();
  await expect(code.locator("[data-line]").last()).toBeInViewport();
});

test("syntax assets cache only after use and stay available when asset network is unavailable", async ({
  context,
  page,
}) => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const root = resolve(process.env.ANYWORK_E2E_WEB_DIR ?? "web/dist");
  const manifest = JSON.parse(
    await readFile(resolve(root, ".vite/manifest.json"), "utf8"),
  ) as Record<string, { file: string }>;
  const asset =
    "/" +
    manifest[
      Object.keys(manifest).find((key) =>
        key.endsWith("@shikijs/langs/dist/swift.mjs"),
      )!
    ].file;
  const unvisited =
    "/" +
    manifest[
      Object.keys(manifest).find((key) =>
        key.endsWith("@shikijs/langs/dist/lua.mjs"),
      )!
    ].file;
  const state = await fixture(
    context,
    page,
    `${id}?view=review`,
    undefined,
    "",
  );
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const cached = async (path: string) =>
    page.evaluate(async (path) => {
      const version = (await caches.keys()).find((key) =>
        key.startsWith("anywork-"),
      );
      if (!version) return false;
      const cache = await caches.open(version);
      return (await cache.keys()).some(
        (request) => new URL(request.url).pathname === path,
      );
    }, path);
  expect(await cached(asset)).toBe(false);
  expect(await cached(unvisited)).toBe(false);
  state.patch =
    'diff --git a/hello.swift b/hello.swift\n--- a/hello.swift\n+++ b/hello.swift\n@@ -1 +1 @@\n-let greeting = "before"\n+let greeting = "after"\n';
  await page.getByRole("button", { name: "刷新差异", exact: true }).click();
  const code = page.getByRole("region", {
    name: "hello.swift 差异",
    exact: true,
  });
  await expect(
    code.locator("[data-line]").filter({ hasText: 'let greeting = "after"' }),
  ).toBeVisible();
  await expect.poll(() => cached(asset)).toBe(true);
  expect(await cached(unvisited)).toBe(false);
  // Keep local cookie validation online; only static asset retrieval fails.
  // Offline local authentication intentionally returns to the desktop entry.
  await context.route("**/assets/**", (route) => route.abort());
  await page.reload();
  await expect(
    code.locator("[data-line]").filter({ hasText: 'let greeting = "after"' }),
  ).toBeVisible();
  await expect(code.getByRole("status")).toHaveCount(0);
  await context.unroute("**/assets/**");
});
