import { describe, expect, it } from "vitest";
import { formatRunDuration } from "./message-chrome";
import { toolRowModel, toolGlyph } from "./toolRowModel";
import { splitTurn } from "../../transcript";

const units = {
  "duration.secondUnit": "s",
  "duration.minuteUnit": "m",
  "duration.hourUnit": "h",
};
describe("extracted Harness conversation adapter", () => {
  it("retains upstream clock boundaries, floors fractions and handles missing host timestamps separately", () => {
    const duration = (ms: number) =>
      formatRunDuration(ms, (key) => units[key])
        .map((p) => p.text)
        .join("");
    expect(duration(-1)).toBe("0s");
    expect(duration(59999)).toBe("59s");
    expect(duration(60000)).toBe("1m0s");
    expect(duration(3600123)).toBe("1h0m0s");
  });
  it("keeps tool descriptions separate from labels and never infers a shell command action", () => {
    expect(
      toolRowModel({
        type: "commandExecution",
        command: "cat file",
        description: "检查数据卷容量",
        status: "inProgress",
      }),
    ).toEqual({
      title: "运行命令",
      summary: "检查数据卷容量",
      state: "running",
    });
    expect(
      toolRowModel({
        type: "dynamicToolCall",
        tool: "read_task_output",
        title: "读取任务输出",
        description: "bash-42",
        status: "running",
      }),
    ).toEqual({ title: "读取任务输出", summary: "bash-42", state: "running" });
    expect(
      toolRowModel({
        type: "commandExecution",
        commandActions: [{ type: "read", path: "/tmp/report.txt" }],
        status: "completed",
      }),
    ).toEqual({ title: "读取", summary: "/tmp/report.txt", state: "ok" });
  });
  it("uses declared tool names for glyphs rather than shell source", () => {
    expect(
      toolGlyph({ type: "dynamicToolCall", tool: "bash", command: "cat file" }),
    ).toBe("command");
    expect(toolGlyph({ type: "dynamicToolCall", tool: "read" })).toBe("read");
    expect(toolGlyph({ type: "dynamicToolCall", tool: "job_output" })).toBe(
      "output",
    );
    expect(toolGlyph({ type: "commandExecution", command: "cat file" })).toBe(
      "command",
    );
  });
  it("settlement distinguishes failure, interruption, and preparation", () => {
    expect(toolRowModel({ status: "failed" }).state).toBe("error");
    expect(toolRowModel({ status: "completed", exitCode: 1 }).state).toBe(
      "error",
    );
    expect(
      toolRowModel({ status: "completed", result: { isError: true } }).state,
    ).toBe("error");
    expect(
      toolRowModel({ status: "interrupted", error: "cancelled" }).state,
    ).toBe("stopped");
    expect(toolRowModel({ status: "preparing" }).state).toBe("preparing");
  });
  it("reasoning requires explicit agent opt-in; Codex keeps existing hidden semantics", () => {
    const turn = {
      id: "t",
      status: "inProgress" as const,
      messages: [
        {
          id: "r",
          role: "reasoning" as const,
          text: "Harness public reasoning",
        },
        { id: "a", role: "assistant" as const, text: "Progress" },
      ],
    };
    expect(splitTurn(turn, true).activity.map((m) => m.id)).toEqual(["a"]);
    expect(splitTurn(turn, true, true).activity.map((m) => m.id)).toEqual([
      "r",
      "a",
    ]);
  });
});
