import { expect, test, type Page } from "@playwright/test";

const headers = { Authorization: "Bearer browser-integration-test-token" };
async function fixture(page: Page, text: string) {
  const { workspace } = await (
    await page.request.get("/api/info", { headers })
  ).json();
  const { session } = await (
    await page.request.post("/api/sessions", {
      headers,
      data: { cwd: workspace, agent: "fixture", title: "审批协议验收" },
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
  });
  await page.goto(`/#${session.id}`);
  await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
  await page.getByLabel("消息", { exact: true }).fill(text);
  await page.getByTitle("发送", { exact: true }).click();
  const card = page.locator("[data-codex-approval-surface]");
  await expect(card).toBeVisible();
  return {
    session,
    card,
    read: async () =>
      (
        await page.request.get(`/api/sessions/${session.id}/export`, {
          headers,
        })
      ).json(),
  };
}

test("native scoped approval choices reach the agent unchanged without changing global policy", async ({
  page,
}, info) => {
  const cases = [
    {
      text: "approval file",
      label: "允许所有修改",
      result: { decision: "acceptForSession" },
    },
    {
      text: "approval exec",
      label: "允许类似命令",
      result: {
        decision: {
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: ["npm", "install"],
          },
        },
      },
    },
    {
      text: "approval network",
      label: "允许此对话",
      result: { decision: "acceptForSession" },
    },
    {
      text: "approval network",
      label: "始终允许",
      leading: true,
      result: {
        decision: {
          applyNetworkPolicyAmendment: {
            network_policy_amendment: { host: "example.com", action: "allow" },
          },
        },
      },
    },
    { text: "approval permissions", label: "允许此对话", permissions: true },
  ];
  for (const entry of cases) {
    const { session, card, read } = await fixture(page, entry.text);
    const before = await read();
    const pending = before.events.find(
      (event: any) => event.request_id === 700,
    );
    const expected = entry.permissions
      ? { permissions: pending.params.permissions, scope: "session" }
      : entry.result;
    if (entry.text === "approval file") {
      await card.locator(".request-file-change summary").click();
      await expect(card.locator(".request-file-diff")).toContainText(
        "+# Approved edit",
      );
    }
    if (entry.leading) {
      await card
        .getByRole("button", { name: entry.label, exact: true })
        .click();
    } else {
      await card.getByRole("button", { name: "审批选项", exact: true }).click();
      await page
        .getByRole("menuitem", { name: entry.label, exact: true })
        .click();
    }
    await expect(card).toHaveCount(0);
    await expect
      .poll(async () => {
        const data = await read();
        const completed = data.events
          .filter(
            (event: any) =>
              event.method === "item/completed" &&
              event.params.item?.type === "agentMessage",
          )
          .at(-1);
        return completed
          ? JSON.parse(completed.params.item.text.split("\n").at(-1))
              .approvalResult
          : null;
      })
      .toEqual(expected);
    const data = await read();
    expect(data.session).toMatchObject({
      id: session.id,
      policy: "manual",
      archived: false,
    });
    expect(
      data.events.filter(
        (event: any) =>
          event.method === "serverRequest/resolved" && !event.params.automatic,
      ).length,
    ).toBeGreaterThanOrEqual(1);
  }
  await page.screenshot({
    path: `artifacts/anywork-approval-protocol-${info.project.name}.png`,
    fullPage: true,
  });
});

test("restricted approvals cannot use keyboard or forged responses to grant once", async ({
  page,
}) => {
  const { session, card } = await fixture(page, "approval restricted");
  const responses: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/respond"))
      responses.push(request.postDataJSON());
  });
  await expect(
    card
      .locator("button.request-approve:not(:disabled)")
      .filter({ hasText: "允许一次" }),
  ).toHaveCount(0);
  await card.focus();
  await page.keyboard.press("Enter");
  expect(responses).toEqual([]);
  const forged = await page.request.post(
    `/api/sessions/${session.id}/respond`,
    {
      headers,
      data: { request_id: 700, result: { decision: "accept" } },
    },
  );
  expect(forged.status()).toBe(400);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "拒绝", exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(responses).toEqual([
    { request_id: 700, result: { decision: "decline" } },
  ]);
});
