import { test, expect, type Page, type Route } from "@playwright/test";

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
      localStorage.setItem(
        "ra.connection",
        JSON.stringify({ url: location.origin, token }),
      );
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
  await expect(page.getByRole("alert")).toContainText("保存结果未包含文件版本");
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
