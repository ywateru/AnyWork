import { expectPromptText, fillPromptText } from "./prompt-editor-helpers";
import { expect, test, type Page } from "@playwright/test";

const headers = { Authorization: "Bearer browser-integration-test-token" };
async function fixture(page: Page) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const { session } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: {
        cwd: workspace,
        agent: "fixture",
        title: `模型菜单验收 ${Date.now()}`,
      },
    })
  ).json();
  await page.addInitScript(() => {
    localStorage.setItem(
      "ra.connection",
      JSON.stringify({
        url: location.origin,
        token: "browser-integration-test-token",
      }),
    );
    localStorage.setItem("ra.sidebar-pinned", "false");
    localStorage.setItem("ra.theme", "system");
  });
  await page.goto(`/#${session.id}`);
  await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
  const picker = page.getByRole("button", {
      name: "模型与思考强度",
      exact: true,
    }),
    menu = page.getByRole("menu", { name: "模型与思考强度", exact: true });
  await expect(picker).toContainText("Fixture");
  return {
    session,
    picker,
    menu,
    read: async () =>
      (
        await page.request.get(`/api/sessions/${session.id}/composer`, {
          headers,
        })
      ).json(),
  };
}

test("service speed saves catalog IDs, clears native overrides and preserves rejected settings", async ({
  page,
}, info) => {
  const { picker, menu, read } = await fixture(page);
  await picker.click();
  const speed = menu.getByRole("menuitem", { name: "速度", exact: true });
  await speed.click();
  const flyout = page.getByRole("menu", { name: "速度", exact: true });
  const current = flyout.getByRole("menuitemradio", {
    name: /^fixture-standard /,
  });
  await expect(current).toBeFocused();
  // Font wrapping and focus can resize/reposition the portalled menu. Assert
  // the settled layout rather than measuring the first intermediate frame.
  await expect
    .poll(async () => {
      const bounds = await flyout.boundingBox();
      const viewport = page.viewportSize()!;
      return (
        !!bounds &&
        bounds.x >= 12 &&
        bounds.y >= 12 &&
        bounds.x + bounds.width <= viewport.width - 11 &&
        bounds.y + bounds.height <= viewport.height - 11
      );
    })
    .toBe(true);
  const rect = (await flyout.boundingBox())!;
  expect(rect.width).toBeCloseTo(233, 0);
  expect(rect.x).toBeGreaterThanOrEqual(12);
  expect(rect.x + rect.width).toBeLessThanOrEqual(
    page.viewportSize()!.width - 11,
  );
  expect(rect.y).toBeGreaterThanOrEqual(12);
  expect(rect.y + rect.height).toBeLessThanOrEqual(
    page.viewportSize()!.height - 11,
  );
  await page.screenshot({
    path: `artifacts/anywork-model-speed-${info.project.name}-light.png`,
    fullPage: true,
  });
  await flyout
    .getByRole("menuitemradio", { name: /^fixture-priority / })
    .click();
  await expect(speed).toBeFocused();
  expect(await read()).toMatchObject({ service_tier: "fixture-priority" });
  await speed.click();
  await expect(
    flyout.getByRole("menuitemradio", { name: /^fixture-priority / }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(flyout).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(speed).toBeFocused();
  await speed.click();
  await flyout
    .getByRole("menuitemradio", { name: /^fixture-policy-denied / })
    .click();
  await expect(menu.getByRole("alert")).toBeVisible();
  await expect(speed).toBeEnabled();
  expect(await read()).toMatchObject({ service_tier: "fixture-priority" });
  await speed.click();
  await flyout.getByRole("menuitemradio", { name: /^标准 / }).click();
  await expect(speed).toBeFocused();
  expect(await read()).toMatchObject({ service_tier: null });
  await expect(menu.getByRole("alert")).toHaveCount(0);
  await page.getByTitle("关闭错误", { exact: true }).click();
  await expect(menu).toHaveCount(0);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await picker.click();
  await speed.click();
  await page.screenshot({
    path: `artifacts/anywork-model-speed-${info.project.name}-dark.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(picker).toBeFocused();
  await page.reload();
  await expect(picker).toBeVisible();
  expect(await read()).toMatchObject({ service_tier: null });
});

test("slider serializes rapid changes and supports wheel, pointer and touch input", async ({
  page,
}, info) => {
  const { session, picker, menu, read } = await fixture(page);
  let release: (() => void) | undefined;
  const posted: string[] = [];
  await page.route(`**/api/sessions/${session.id}/composer`, async (route) => {
    if (route.request().method() === "POST") {
      const { effort } = route.request().postDataJSON();
      if (effort) {
        posted.push(effort);
        if (posted.length === 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      }
    }
    await route.continue();
  });
  await picker.click();
  const slider = menu.getByRole("slider", { name: "选择推理强度" });
  await slider.focus();
  await slider.press("End");
  await expect.poll(() => posted).toEqual(["high"]);
  await slider.press("Home");
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "1");
  release!();
  await expect.poll(() => posted).toEqual(["high", "medium"]);
  await expect(menu).toHaveAttribute("aria-busy", "false");
  expect(await read()).toMatchObject({ effort: "medium" });
  // Slow trackpad movements must not accumulate across unrelated gestures.
  await slider.evaluate(async (element) => {
    element.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 20, bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 180));
    element.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 20, bubbles: true, cancelable: true }),
    );
  });
  await expect(slider).toHaveAttribute("aria-valuenow", "1");
  // Reversing direction starts a new gesture rather than cancelling old deltas.
  await slider.evaluate((element) => {
    for (const deltaY of [-20, -20])
      element.dispatchEvent(
        new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }),
      );
  });
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  await expect(menu).toHaveAttribute("aria-busy", "false");
  await slider.press("ArrowRight");
  await expect(menu).toHaveAttribute("aria-busy", "false");
  const consumed = await slider.evaluate((element) => {
    const event = new WheelEvent("wheel", {
      deltaY: -30,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(consumed).toBe(true);
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  await expect(menu).toHaveAttribute("aria-busy", "false");
  const bounds = (await slider.boundingBox())!;
  if (info.project.name === "android-web") {
    await page.touchscreen.tap(bounds.x + bounds.width - 14, bounds.y + 14);
  } else {
    await page.mouse.move(bounds.x + 14, bounds.y + 14);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 14, bounds.y + 14, {
      steps: 8,
    });
    await page.mouse.up();
  }
  await expect(slider).toHaveAttribute("aria-valuenow", "2");
  await expect(menu).toHaveAttribute("aria-busy", "false");
  await expect.poll(read).toMatchObject({ effort: "high" });
  await slider.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(picker).toBeFocused();
});

test("single fast tier uses a checkbox and keeps focus after native saves", async ({
  page,
}) => {
  const { session, picker, menu, read } = await fixture(page);
  await page.route(`**/api/sessions/${session.id}/composer`, async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    // Exercise the native one-fast-tier branch with an actually advertised ID.
    data.models[0].serviceTiers = [
      {
        id: "fixture-priority",
        name: " Fast ",
        description: "Native fast tier",
      },
    ];
    await route.fulfill({ response, json: data });
  });
  await picker.click();
  const fast = menu.getByRole("menuitemcheckbox", {
    name: "快速",
    exact: true,
  });
  await expect(fast).toHaveAttribute("aria-checked", "false");
  await fast.click();
  await expect(fast).toHaveAttribute("aria-checked", "true");
  await expect(fast).toBeFocused();
  expect(await read()).toMatchObject({ service_tier: "fixture-priority" });
  await fast.press("Space");
  await expect(fast).toHaveAttribute("aria-checked", "false");
  await expect(fast).toBeFocused();
  expect(await read()).toMatchObject({ service_tier: null });
  await expect(
    page.getByRole("menu", { name: "速度", exact: true }),
  ).toHaveCount(0);
});

interface RenderTaskWindow extends Window {
  modelPickerTasks: {
    hold: boolean;
    pending: (() => void)[];
    pendingMicrotasks: number;
    decodedSaves: number;
    release: () => void;
  };
}

// Hold both native root-scheduling microtasks and MessageChannel work across
// two real frames after the save response. Holding only MessageChannel leaves
// React's root microtask free to synchronously flush work before task release.
// Focus APIs, requestAnimationFrame, React and the save request stay unchanged.
async function controlledRenderTasks(page: Page) {
  await page.addInitScript(() => {
    const pending: (() => void)[] = [];
    const state = {
      hold: false,
      pending,
      pendingMicrotasks: 0,
      decodedSaves: 0,
      release: () => {
        state.hold = false;
        for (const run of pending.splice(0)) run();
      },
    };
    Object.assign(window, { modelPickerTasks: state });
    // A response event signals headers, not consumption by the application.
    // Observe the real POST body's decode so the two frames cannot run before
    // the save continuation has even received its result.
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await nativeFetch(input, init);
      if (
        init?.method === "POST" &&
        new URL(response.url).pathname.endsWith("/composer")
      ) {
        const nativeJson = response.json.bind(response);
        response.json = async () => {
          const value = await nativeJson();
          state.decodedSaves++;
          return value;
        };
      }
      return response;
    };
    const nativeMicrotask = window.queueMicrotask.bind(window);
    window.queueMicrotask = (callback) => {
      nativeMicrotask(() => {
        if (state.hold) {
          state.pendingMicrotasks++;
          pending.push(() => {
            state.pendingMicrotasks--;
            nativeMicrotask(callback);
          });
        } else callback();
      });
    };
    const NativeChannel = window.MessageChannel;
    const onmessage = Object.getOwnPropertyDescriptor(
      MessagePort.prototype,
      "onmessage",
    )!;
    window.MessageChannel = class extends NativeChannel {
      constructor() {
        super();
        Object.defineProperty(this.port1, "onmessage", {
          set(handler: (event: MessageEvent) => void) {
            onmessage.set!.call(this, (event: MessageEvent) => {
              const run = () => handler.call(this, event);
              if (state.hold) pending.push(run);
              else run();
            });
          },
        });
      }
    };
  });
}

for (const rejected of [false, true]) {
  test(`fast-tier focus follows the enabled commit after ${rejected ? "rejected" : "successful"} saves`, async ({
    page,
  }) => {
    await controlledRenderTasks(page);
    const { session, picker, menu } = await fixture(page);
    let release: (() => void) | undefined;
    await page.route(
      `**/api/sessions/${session.id}/composer`,
      async (route) => {
        if (route.request().method() === "POST") {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          if (rejected) {
            await route.fulfill({
              status: 500,
              json: { error: "受控保存失败" },
            });
            return;
          }
        }
        const response = await route.fetch(),
          data = await response.json();
        data.models[0].serviceTiers = [
          {
            id: "fixture-priority",
            name: "Fast",
            description: "Native fast tier",
          },
        ];
        await route.fulfill({ response, json: data });
      },
    );
    await picker.click();
    const fast = menu.getByRole("menuitemcheckbox", {
      name: "快速",
      exact: true,
    });
    await fast.click();
    await expect(fast).toBeDisabled();
    await expect.poll(() => Boolean(release)).toBe(true);
    await page.evaluate(() => {
      (window as RenderTaskWindow).modelPickerTasks.hold = true;
    });
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/sessions/${session.id}/composer`) &&
        response.request().method() === "POST",
    );
    release!();
    await response;
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as RenderTaskWindow).modelPickerTasks.decodedSaves,
        ),
      )
      .toBe(1);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as RenderTaskWindow).modelPickerTasks.pendingMicrotasks,
        ),
      )
      .toBeGreaterThan(0);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(fast).toBeDisabled();
    await page.evaluate(() => {
      (window as RenderTaskWindow).modelPickerTasks.release();
    });
    await expect(fast).toBeEnabled();
    expect(
      await page.evaluate(() => {
        const state = (window as RenderTaskWindow).modelPickerTasks;
        return [state.hold, state.pendingMicrotasks, state.pending.length];
      }),
    ).toEqual([false, 0, 0]);
    await expect(fast).toHaveAttribute("aria-checked", String(!rejected));
    await expect(fast).toBeFocused();
    if (rejected)
      await expect(menu.getByRole("alert")).toHaveText("受控保存失败");
  });
}

for (const rejected of [false, true]) {
  for (const intent of [
    "another control",
    "outside",
    "Escape",
    "Escape then outside",
    "another session",
    "Escape then another session",
  ] as const) {
    test(`a ${rejected ? "rejected" : "successful"} speed save respects focus moved to ${intent}`, async ({
      page,
    }) => {
      const { session, picker, menu } = await fixture(page);
      const other =
        intent === "another session" || intent === "Escape then another session"
          ? (
              await (
                await page.request.post("/api/sessions", {
                  headers,
                  data: {
                    cwd: session.cwd,
                    agent: "fixture",
                    title: "焦点独立会话",
                  },
                })
              ).json()
            ).session
          : null;
      let release: (() => void) | undefined;
      await page.route(
        `**/api/sessions/${session.id}/composer`,
        async (route) => {
          if (route.request().method() === "POST") {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            if (rejected) {
              await route.fulfill({
                status: 500,
                json: { error: "受控保存失败" },
              });
              return;
            }
          }
          const response = await route.fetch(),
            data = await response.json();
          data.models[0].serviceTiers = [
            {
              id: "fixture-priority",
              name: "Fast",
              description: "Native fast tier",
            },
          ];
          await route.fulfill({ response, json: data });
        },
      );
      await picker.click();
      const fast = menu.getByRole("menuitemcheckbox", {
        name: "快速",
        exact: true,
      });
      await fast.click();
      await expect(fast).toBeDisabled();
      await expect.poll(() => Boolean(release)).toBe(true);
      const prompt = page.getByLabel("消息", { exact: true });
      const destination =
        intent === "another control" || other
          ? menu.getByRole("slider")
          : intent === "Escape"
            ? picker
            : prompt;
      if (intent === "another control") await destination.focus();
      else if (intent === "Escape") await page.keyboard.press("Escape");
      else {
        if (intent.startsWith("Escape then")) {
          await page.keyboard.press("Escape");
          await expect(menu).toHaveCount(0);
        }
        if (other) {
          await page.evaluate((id) => {
            location.hash = id;
          }, other.id);
          await expect(page).toHaveURL(new RegExp(`#${other.id}$`));
          await expect(picker).toHaveAttribute("title", /思考强度：中/);
          await fillPromptText(prompt, "保留焦点及独立草稿");
          await picker.click();
          await expect(menu).toHaveAttribute("aria-busy", "false");
          await destination.focus();
        } else {
          await prompt.focus();
          await expect(menu).toHaveCount(0);
        }
      }
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/sessions/${session.id}/composer`) &&
          response.request().method() === "POST",
      );
      release!();
      await saved;
      // Drain the old frame-based completion too, so a stale callback cannot
      // pass simply because the assertion ran before its scheduled focus.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      if (other) {
        await expect(menu.getByRole("alert")).toHaveCount(0);
        await expect(menu.getByRole("slider")).toHaveAttribute(
          "aria-valuenow",
          "1",
        );
        await expectPromptText(prompt, "保留焦点及独立草稿");
      } else {
        await expect(picker).toBeEnabled();
        if (intent === "another control") {
          await expect(menu).toHaveAttribute("aria-busy", "false");
          if (rejected)
            await expect(menu.getByRole("alert")).toHaveText("受控保存失败");
        } else await expect(menu).toHaveCount(0);
      }
      await expect(destination).toBeFocused();
    });
  }
}

test("a delayed model error cannot overwrite another session or its draft", async ({
  page,
}) => {
  const { session, picker, menu } = await fixture(page);
  const { session: other } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: {
        cwd: session.cwd,
        agent: "fixture",
        title: `保留独立设置 ${Date.now()}`,
      },
    })
  ).json();
  await page.goto(`/#${other.id}`);
  await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
  await fillPromptText(
    page.getByLabel("消息", { exact: true }),
    "另一会话的草稿",
  );
  const switchSession = async (target: { id: string; title: string }) => {
    const closed =
      page.viewportSize()!.width <= 720
        ? !(await page.locator(".sidebar.open").count())
        : !!(await page.locator(".app-shell.sidebar-collapsed").count());
    if (closed)
      await page.getByRole("button", { name: "会话列表", exact: true }).click();
    await page.getByLabel("搜索会话", { exact: true }).fill(target.title);
    await page.getByRole("button", { name: target.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${target.id}$`));
    await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
  };
  await switchSession(session);
  let release: (() => void) | undefined;
  await page.route(`**/api/sessions/${session.id}/composer`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      status: 500,
      json: { error: "旧会话迟到的设置失败" },
    });
  });
  await picker.click();
  await menu.getByRole("slider").press("End");
  await expect.poll(() => Boolean(release)).toBe(true);
  await switchSession(other);
  release!();
  await expectPromptText(
    page.getByLabel("消息", { exact: true }),
    "另一会话的草稿",
  );
  await expect(picker).toHaveAttribute("title", /思考强度：中/);
  await picker.click();
  await expect(menu.getByRole("slider")).toHaveAttribute("aria-valuenow", "1");
  await expect(menu).toHaveAttribute("aria-busy", "false");
  await expect(
    page.getByText("旧会话迟到的设置失败", { exact: true }),
  ).toHaveCount(0);
});
