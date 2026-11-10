import {
  test as base,
  expect,
  type Route,
  type BrowserContext,
} from "@playwright/test";
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
    try {
      await use(context);
    } finally {
      await context.request
        .delete(baseURL! + "/api/local/session", {
          headers: { Origin: baseURL! },
        })
        .catch(() => {});
    }
  },
});

/** Playwright's Node route.fetch omits browser Fetch Metadata. Explicit exact
 * Origin preserves the real cookie boundary for delayed/modified HTTP fixtures. */
export function fetchLocalRoute(route: Route) {
  return route.fetch({
    headers: {
      ...route.request().headers(),
      Origin: new URL(route.request().url()).origin,
    },
  });
}
