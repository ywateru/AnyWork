import { test as base, expect, type BrowserContext } from "@playwright/test";
export * from "@playwright/test";
/** Real isolated service handoff, never a production token or persisted connection. */
export async function authorizeLocalContext(
  context: BrowserContext,
  origin: string,
) {
  const response = await context.request.post(
    origin + "/api/service/browser-ticket",
    {
      headers: {
        Authorization: "Bearer browser-integration-test-token",
        "X-AnyWork-Service-Control": "desktop",
      },
      data: {},
    },
  );
  expect(
    response.status(),
    "isolated server supports local browser handoff",
  ).toBe(200);
  const { ticket } = await response.json();
  const session = await context.request.post(origin + "/api/local/session", {
    headers: { Origin: origin },
    data: { ticket },
  });
  expect(session.status()).toBe(200);
}
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    await authorizeLocalContext(context, baseURL!);
    await use(context);
  },
});
