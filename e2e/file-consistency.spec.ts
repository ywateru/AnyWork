import { test, expect, type Page, type Route } from "./local-fixture";

const token = "browser-integration-test-token";
const headers = { Authorization: `Bearer ${token}` };

async function setup(page: Page, suffix: string) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const sessions = [];
  for (const label of ["A", "B"]) {
    const { session } = await (
      await page.request.post("/api/sessions", {
        headers,
        data: {
          agent: "fixture",
          cwd: workspace,
          title: `File ${suffix} ${label}`,
        },
      })
    ).json();
    sessions.push(session);
  }
  const names = [`file-${suffix}-a.txt`, `file-${suffix}-b.txt`];
  for (const name of names) {
    const result = await page.request.put(
      `/api/sessions/${sessions[0].id}/files`,
      {
        headers,
        data: {
          path: name,
          content: `${name} baseline`,
          expected_revision: null,
        },
      },
    );
    expect(result.status()).toBe(200);
  }
  await page.addInitScript(
    ({ token }) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as any).copiedDraft = text;
          },
        },
      });
    },
    { token },
  );
  await page.goto(`/#${sessions[0].id}`);
  await openFilePanel(page);
  await page.getByRole("treeitem", { name: names[0], exact: true }).click();
  await expect(page.getByLabel("文件内容", { exact: true })).toHaveValue(
    `${names[0]} baseline`,
  );
  return { sessions, names };
}

async function openFilePanel(page: Page) {
  await page.getByLabel("打开子窗口", { exact: true }).click();
  await page.getByRole("button", { name: "文件", exact: true }).click();
}

async function read(page: Page, id: string, name: string) {
  return (
    await page.request.get(
      `/api/sessions/${id}/files?path=${encodeURIComponent(name)}`,
      { headers },
    )
  ).json();
}

// Process the real request, then hold delivery to exercise React's late-result handling.
async function holdPut(page: Page, id: string) {
  let received!: () => void;
  let release!: () => void;
  let delivered!: () => void;
  const pending = new Promise<void>((resolve) => {
    received = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  const pattern = `**/api/sessions/${id}/files`;
  const handler = async (route: Route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const response = await route.fetch();
    received();
    await gate;
    try {
      await route.fulfill({ response });
    } finally {
      delivered();
    }
  };
  await page.route(pattern, handler);
  return {
    pending,
    release: async () => {
      release();
      await done;
      await page.unroute(pattern, handler);
    },
  };
}

test("conflict preserves draft, compares latest, explicitly rebases or reloads", async ({
  page,
}, info) => {
  const { sessions, names } = await setup(
    page,
    `conflict-${info.project.name}`,
  );
  const id = sessions[0].id,
    name = names[0];
  const editor = page.getByLabel("文件内容", { exact: true });
  const baseline = await read(page, id, name);
  await editor.fill("local unsaved draft");
  expect(
    (
      await page.request.put(`/api/sessions/${id}/files`, {
        headers,
        data: {
          path: name,
          content: "external update",
          expected_revision: baseline.revision,
        },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("草稿已保留");
  const toolbar = await page.locator(".file-save-actions").boundingBox();
  const banner = await page.getByRole("alert").boundingBox();
  expect(toolbar).not.toBeNull();
  expect(banner).not.toBeNull();
  expect(banner!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height);
  await expect(editor).toHaveValue("local unsaved draft");
  await page.getByRole("button", { name: "复制当前草稿", exact: true }).click();
  expect(await page.evaluate(() => (window as any).copiedDraft)).toBe(
    "local unsaved draft",
  );
  await page.getByRole("button", { name: "比较最新文件", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "最新文件比较" }),
  ).toContainText("external update");
  await expect(editor).toHaveValue("local unsaved draft");
  await page
    .getByRole("button", {
      name: "使用此版本作为保存基线，保留草稿",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  expect((await read(page, id, name)).content).toBe("local unsaved draft");
  const current = await read(page, id, name);
  await editor.fill("discard this draft");
  await page.request.put(`/api/sessions/${id}/files`, {
    headers,
    data: {
      path: name,
      content: "new disk version",
      expected_revision: current.revision,
    },
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "比较最新文件", exact: true }).click();
  await page
    .getByRole("button", { name: "放弃草稿并载入最新文件", exact: true })
    .click();
  await expect(editor).toHaveValue("new disk version");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
});

test("typing during save remains dirty against captured submission", async ({
  page,
}, info) => {
  const { sessions, names } = await setup(page, `pending-${info.project.name}`);
  const editor = page.getByLabel("文件内容", { exact: true });
  await editor.fill("submitted");
  const held = await holdPut(page, sessions[0].id);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await held.pending;
  await editor.fill("typed while saving");
  await held.release();
  const save = page.getByRole("button", { name: "保存", exact: true });
  await expect(save).toBeEnabled();
  await expect(editor).toHaveValue("typed while saving");
  expect((await read(page, sessions[0].id, names[0])).content).toBe(
    "submitted",
  );
  await save.click();
  await expect(save).toBeDisabled();
  expect((await read(page, sessions[0].id, names[0])).content).toBe(
    "typed while saving",
  );
});

for (const kind of ["file", "session"] as const) {
  test(`late save response cannot replace ${kind} baseline`, async ({
    page,
  }, info) => {
    const { sessions, names } = await setup(
      page,
      `late-${kind}-${info.project.name}`,
    );
    const editor = page.getByLabel("文件内容", { exact: true });
    await editor.fill("old view submission");
    const held = await holdPut(page, sessions[0].id);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await held.pending;
    if (kind === "file") {
      await page.getByRole("treeitem", { name: names[1], exact: true }).click();
      await expect(editor).toHaveValue(`${names[1]} baseline`);
    } else {
      await page.evaluate((id) => {
        location.hash = id;
      }, sessions[1].id);
      await openFilePanel(page);
      await page.getByRole("treeitem", { name: names[1], exact: true }).click();
      await expect(editor).toHaveValue(`${names[1]} baseline`);
    }
    await editor.fill("new view draft");
    await held.release();
    await expect(editor).toHaveValue("new view draft");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "保存", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect((await read(page, sessions[1].id, names[1])).content).toBe(
      "new view draft",
    );
  });
}

test("unknown result and transport failure retain draft without blind retry", async ({
  page,
}, info) => {
  const { sessions, names } = await setup(page, `failure-${info.project.name}`);
  const editor = page.getByLabel("文件内容", { exact: true });
  const pattern = `**/api/sessions/${sessions[0].id}/files`;
  await editor.fill("keep uncertain draft");
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fetch();
    await route.fulfill({ json: { ok: true } });
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存结果无效");
  await expect(editor).toHaveValue("keep uncertain draft");
  await page.unroute(pattern);
  await page.getByRole("button", { name: "比较最新文件", exact: true }).click();
  await page
    .getByRole("button", {
      name: "使用此版本作为保存基线，保留草稿",
      exact: true,
    })
    .click();
  await editor.fill("keep disconnected draft");
  await page.route(pattern, (route) =>
    route.request().method() === "PUT"
      ? route.abort("failed")
      : route.continue(),
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("草稿已保留");
  await expect(editor).toHaveValue("keep disconnected draft");
  expect((await read(page, sessions[0].id, names[0])).content).toBe(
    "keep uncertain draft",
  );
});

for (const kind of ["file", "session"] as const) {
  test(`late comparison cannot leak into a new ${kind} view`, async ({
    page,
  }, info) => {
    const { sessions, names } = await setup(
      page,
      `compare-${kind}-${info.project.name}`,
    );
    const editor = page.getByLabel("文件内容", { exact: true });
    const id = sessions[0].id;
    const original = await read(page, id, names[0]);
    await editor.fill("stale draft");
    await page.request.put(`/api/sessions/${id}/files`, {
      headers,
      data: {
        path: names[0],
        content: "external comparison snapshot",
        expected_revision: original.revision,
      },
    });
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    let arrived!: () => void, release!: () => void, delivered!: () => void;
    const pending = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    let captured = false;
    const pattern = `**/api/sessions/${id}/files?path=*`;
    const handler = async (route: Route) => {
      if (
        captured ||
        !new URL(route.request().url()).searchParams
          .get("path")
          ?.endsWith(names[0])
      )
        return route.continue();
      captured = true;
      const response = await route.fetch();
      arrived();
      await gate;
      try {
        await route.fulfill({ response });
      } finally {
        delivered();
      }
    };
    await page.route(pattern, handler);
    await page
      .getByRole("button", { name: "比较最新文件", exact: true })
      .click();
    await pending;
    if (kind === "session") {
      await page.evaluate((id) => {
        location.hash = id;
      }, sessions[1].id);
      await openFilePanel(page);
    }
    await page.getByRole("treeitem", { name: names[1], exact: true }).click();
    await expect(editor).toHaveValue(`${names[1]} baseline`);
    // Return to the same path as well: path equality alone cannot identify a request generation.
    await page.getByRole("treeitem", { name: names[0], exact: true }).click();
    await expect(editor).toHaveValue("external comparison snapshot");
    await editor.fill("current view draft");
    release();
    await done;
    await page.unroute(pattern, handler);
    await expect(
      page.getByRole("region", { name: "最新文件比较" }),
    ).toHaveCount(0);
    await expect(editor).toHaveValue("current view draft");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "保存", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("malformed success and comparison revisions never establish a saved baseline", async ({
  page,
}, info) => {
  const { sessions, names } = await setup(page, `schema-${info.project.name}`);
  const id = sessions[0].id;
  const editor = page.getByLabel("文件内容", { exact: true });
  const original = await read(page, id, names[0]);
  const pattern = `**/api/sessions/${id}/files`;
  let response: unknown;
  await page.route(pattern, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ json: response })
      : route.continue(),
  );
  const malformed = [
    { ok: false, revision: "invalid-but-truthy" },
    { ok: false, revision: original.revision },
    { ok: "true", revision: original.revision },
    { revision: original.revision },
    { ok: true, revision: "invalid-but-truthy" },
    { ok: true, revision: 42 },
    { ok: true, revision: { value: original.revision } },
    { ok: true, revision: `sha256:${"A".repeat(64)}` },
    null,
  ];
  for (const [index, invalid] of malformed.entries()) {
    response = invalid;
    const draft = `unsaved schema draft ${index}`;
    await editor.fill(draft);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("保存结果无效");
    await expect(
      page.getByRole("button", { name: "保存", exact: true }),
    ).toBeEnabled();
    await expect(editor).toHaveValue(draft);
    expect((await read(page, id, names[0])).content).toBe(original.content);
  }
  await page.unroute(pattern);
  const comparePattern = `**/api/sessions/${id}/files?path=*`;
  for (const invalid of [
    "invalid-but-truthy",
    42,
    { hash: original.revision },
    null,
  ]) {
    await page.route(comparePattern, (route) =>
      route.fulfill({
        json: { content: "untrusted comparison", revision: invalid },
      }),
    );
    await page
      .getByRole("button", { name: "比较最新文件", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("服务未提供文件版本");
    await expect(
      page.getByRole("region", { name: "最新文件比较" }),
    ).toHaveCount(0);
    await expect(editor).toHaveValue("unsaved schema draft 8");
    await page.unroute(comparePattern);
  }
  // Rejected responses never replace the original digest used for a valid retry.
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  expect((await read(page, id, names[0])).content).toBe(
    "unsaved schema draft 8",
  );
});

test("uncertain post-publication response retains draft and requires explicit comparison", async ({
  page,
}, info) => {
  const { sessions, names } = await setup(page, `sync-${info.project.name}`);
  const editor = page.getByLabel("文件内容", { exact: true });
  await editor.fill("published but durability uncertain");
  const pattern = `**/api/sessions/${sessions[0].id}/files`;
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    expect((await route.fetch()).status()).toBe(200);
    await route.fulfill({
      status: 503,
      json: {
        error: "文件已替换，但无法确认目录持久化，请重新读取并比较",
        code: "file_save_uncertain",
        delivery_state: "uncertain",
      },
    });
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("无法确认目录持久化");
  await expect(editor).toHaveValue("published but durability uncertain");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  await page.unroute(pattern);
  expect((await read(page, sessions[0].id, names[0])).content).toBe(
    "published but durability uncertain",
  );
  await page.getByRole("button", { name: "比较最新文件", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "最新文件比较" }),
  ).toContainText("published but durability uncertain");
  await page
    .getByRole("button", {
      name: "使用此版本作为保存基线，保留草稿",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
});
