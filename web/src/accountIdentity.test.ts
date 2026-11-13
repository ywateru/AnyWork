import { describe, expect, it, vi } from "vitest";
import { accountIdentity, readAccountIdentity } from "./accountIdentity";

const subject = "private-subject-never-a-name";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("verified readable account identity", () => {
  it.each([
    [
      { name: "  陈 水  ", username: "water", email: "a@example.test" },
      "陈 水",
    ],
    [
      { username: "  username-only  ", email: "a@example.test" },
      "username-only",
    ],
    [{ preferred_username: "oidc-user" }, "oidc-user"],
    [
      { name: " \t ", username: " ", email: " a@example.test " },
      "a@example.test",
    ],
    [
      {
        name: {},
        username: 42,
        preferred_username: ["bad"],
        email: "a@example.test",
      },
      "a@example.test",
    ],
    [
      { name: "\u200b", username: "\u202eunsafe", email: "a@example.test" },
      "a@example.test",
    ],
  ])("selects only readable primitive profile fields: %j", (fields, label) => {
    expect(accountIdentity({ sub: subject, ...fields }, subject)?.label).toBe(
      label,
    );
  });
  it("does not use subject, custom data or a device name as identity", () => {
    expect(accountIdentity({ sub: subject }, subject)).toBeUndefined();
    expect(
      accountIdentity({ sub: subject, name: subject }, subject),
    ).toBeUndefined();
    const fields = {
      sub: subject,
      customData: { name: "Untrusted" },
      device: { name: "Host" },
    };
    expect(accountIdentity(fields, subject)).toBeUndefined();
  });
  it("retains the full Unicode name and email without truncating stored display data", () => {
    const name = "林🌊".repeat(160),
      email = "synthetic@example.test";
    expect(accountIdentity({ sub: subject, name, email }, subject)).toEqual({
      subject,
      label: name,
      email,
    });
  });
  it("rejects mismatched or missing subject instead of accepting a readable foreign name", () => {
    for (const sub of ["other", undefined])
      expect(() => accountIdentity({ sub, name: "Foreign" }, subject)).toThrow(
        "IDENTITY_CHANGED",
      );
  });
});

describe("profile backfill ownership", () => {
  const read = (fields: object = {}) => {
    const controller = new AbortController();
    const claims = vi.fn(async () => ({ sub: subject, ...fields }));
    const userInfo = vi.fn(async () => ({
      sub: subject,
      username: "backfilled",
    }));
    return { subject, claims, userInfo, signal: controller.signal, controller };
  };
  it("uses username claims directly without an unnecessary UserInfo request", async () => {
    const input = read({ username: "current-user" });
    expect((await readAccountIdentity(input))?.label).toBe("current-user");
    expect(input.userInfo).not.toHaveBeenCalled();
  });
  it("uses the current authorized UserInfo for existing grants missing display fields", async () => {
    const input = read();
    expect((await readAccountIdentity(input))?.label).toBe("backfilled");
    expect(input.userInfo).toHaveBeenCalledExactlyOnceWith(
      subject,
      input.signal,
    );
  });
  it("does not display expired ID-token fields without a current UserInfo response", async () => {
    const input = read({ name: "Expired name", exp: 1 });
    expect((await readAccountIdentity(input))?.label).toBe("backfilled");
    expect(input.userInfo).toHaveBeenCalledOnce();
  });
  it("rejects a foreign UserInfo subject", async () => {
    const input = read();
    input.userInfo.mockResolvedValue({ sub: "other", username: "Foreign" });
    await expect(readAccountIdentity(input)).rejects.toMatchObject({
      code: "IDENTITY_CHANGED",
    });
  });
  it("reports a missing profile after a successful but empty UserInfo response", async () => {
    const input = read();
    input.userInfo.mockResolvedValue({ sub: subject, username: " " });
    expect(await readAccountIdentity(input)).toBeUndefined();
  });
  it("leaves a network failure recoverable without a sign-in side effect", async () => {
    const input = read();
    input.userInfo.mockRejectedValueOnce(new Error("offline"));
    await expect(readAccountIdentity(input)).rejects.toThrow("offline");
    expect((await readAccountIdentity(input))?.label).toBe("backfilled");
  });
  it.each(["logout", "account switch", "unmount", "superseding retry"])(
    "drops a delayed response after %s",
    async () => {
      const input = read(),
        held = deferred<{ sub: string; username: string }>();
      input.userInfo.mockReturnValue(held.promise);
      const pending = readAccountIdentity(input);
      await vi.waitFor(() => expect(input.userInfo).toHaveBeenCalledOnce());
      input.controller.abort();
      held.resolve({ sub: subject, username: "Late old name" });
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    },
  );
  it("checks the SDK subject again after backfill, even without a storage notification", async () => {
    const input = read();
    input.claims
      .mockResolvedValueOnce({ sub: subject })
      .mockResolvedValueOnce({ sub: "other" });
    await expect(readAccountIdentity(input)).rejects.toMatchObject({
      code: "IDENTITY_CHANGED",
    });
  });
  it("rejects a delayed first claims read after the owner is invalidated", async () => {
    const input = read(),
      held = deferred<{ sub: string }>();
    input.claims.mockReturnValue(held.promise);
    const pending = readAccountIdentity(input);
    input.controller.abort();
    held.resolve({ sub: subject });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(input.userInfo).not.toHaveBeenCalled();
  });
});
