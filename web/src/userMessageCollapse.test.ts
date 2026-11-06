import { describe, expect, it } from "vitest";
import {
  registerFullUserMessageContent,
  USER_MESSAGE_PRECUT_LIMIT,
  userMessagePreview,
  withFullUserMessageContent,
} from "./userMessageCollapse";

describe("native long user message pre-cut", () => {
  it("preserves the strict 10,240 UTF-16-unit threshold", () => {
    expect(USER_MESSAGE_PRECUT_LIMIT).toBe(10_240);
    const exact = "中".repeat(10_240);
    expect(userMessagePreview(exact)).toBe(exact);
    expect(userMessagePreview(exact + "尾部")).toBe(exact);
  });

  it("keeps the native literal slice even inside Markdown and a surrogate pair", () => {
    const prefix = "开头\n```ts\n";
    const code = prefix + "x".repeat(10_240 - prefix.length - 1) + "😀\n```";
    const preview = userMessagePreview(code);
    expect(preview.length).toBe(10_240);
    expect(preview).toBe(code.slice(0, 10_240));
    expect(preview.charCodeAt(10_239)).toBe(0xd83d);
    expect(preview.slice(prefix.length)).not.toContain("\n```");
  });

  it("reveals full content for a snapshot and restores it when reading throws", () => {
    const element = {} as HTMLElement;
    let visible = "preview";
    const unregister = registerFullUserMessageContent(element, () => {
      visible = "full";
      return () => {
        visible = "preview";
      };
    });
    expect(withFullUserMessageContent(element, () => visible)).toBe("full");
    expect(visible).toBe("preview");
    expect(() =>
      withFullUserMessageContent(element, () => {
        expect(visible).toBe("full");
        throw new Error("snapshot failed");
      }),
    ).toThrow("snapshot failed");
    expect(visible).toBe("preview");
    unregister();
    expect(withFullUserMessageContent(element, () => visible)).toBe("preview");
  });
});
