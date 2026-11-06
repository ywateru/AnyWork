import { describe, expect, it } from "vitest";
import { renderedUserText, userTextBody } from "./userText";

describe("native user text extraction", () => {
  it.each([
    ["  普通正文\n\n ", "  普通正文\n\n "],
    [
      "# Files mentioned by the user:\n- report.pdf\n## My request:\n  核对文件  \n",
      "核对文件",
    ],
    [
      "context ## My request for Codex:\n第一稿\n## My request:\n最终请求",
      "最终请求",
    ],
    ["inline## My request: 内联头也匹配", "内联头也匹配"],
    ["## My Request:\n区分大小写", "## My Request:\n区分大小写"],
    ["Attached local file: /report.pdf", "Attached local file: /report.pdf"],
    ["## My request:\uFEFF\u00A0正文\uFEFF", "正文"],
    [
      "<page-comment-context>\n评论\n</page-comment-context>\n## My request:\n第一段 ## My request: 第二段 ",
      "第一段 ## My request: 第二段",
    ],
    [
      "<page-comment-context>\n评论\n</page-comment-context>\n## My request for Codex:\n第一段 ## My request: 第二段",
      "第二段",
    ],
    [
      " <page-comment-context>\n评论\n</page-comment-context>\n## My request:\n第一段 ## My request: 第二段",
      "第二段",
    ],
    [
      "<page-comment-context>\r\n评论\r\n</page-comment-context>\r\n## My request:\r\n第一段 ## My request: 第二段",
      "第二段",
    ],
    [
      "<page-comment-context>\n没有关闭标签 ## My request: 最后正文",
      "最后正文",
    ],
  ])("extracts %j with the observed wrapper boundaries", (raw, expected) => {
    expect(userTextBody(raw)).toBe(expected);
  });

  it("keeps the native two-pass behavior when page-body text contains another request marker", () => {
    const raw =
      "<page-comment-context>\n引用\n</page-comment-context>\n## My request:\n前言 ## My request: 最终正文";
    expect(userTextBody(raw)).toBe("前言 ## My request: 最终正文");
    expect(renderedUserText(raw)).toBe("最终正文");
  });
});
