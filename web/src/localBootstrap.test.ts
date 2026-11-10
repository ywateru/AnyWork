import { expect, it, vi } from "vitest";
vi.stubGlobal("location", new URL("http://127.0.0.1:3219/"));
vi.stubGlobal("history", { replaceState: vi.fn() });
const { takeLocalTicket } = await import("./localBootstrap");
it("clears fragment synchronously before parsing, including malformed or untrusted handoffs", () => {
  const navigation = { replaceState: vi.fn() } as unknown as History;
  const secret = "a".repeat(32);
  expect(
    takeLocalTicket(
      new URL(
        `http://127.0.0.1:3219/#local-ticket=${secret}`,
      ) as unknown as Location,
      navigation,
    ),
  ).toBe(secret);
  expect(navigation.replaceState).toHaveBeenLastCalledWith(null, "", "/");
  for (const url of [
    `https://host.invalid/#local-ticket=${secret}`,
    `http://127.0.0.1:3219/app/#local-ticket=${secret}`,
    "http://127.0.0.1:3219/#local-ticket=bad%value",
  ]) {
    expect(
      takeLocalTicket(new URL(url) as unknown as Location, navigation),
    ).toBeUndefined();
  }
  expect(navigation.replaceState).toHaveBeenCalledTimes(4);
});
it("preserves legitimate conversation hashes", () => {
  const navigation = { replaceState: vi.fn() } as unknown as History;
  expect(
    takeLocalTicket(
      new URL("http://127.0.0.1:3219/#conversation-id") as unknown as Location,
      navigation,
    ),
  ).toBeUndefined();
  expect(navigation.replaceState).not.toHaveBeenCalled();
});
