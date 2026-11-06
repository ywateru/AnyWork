import { describe, expect, it, vi } from "vitest";
import {
  appendAnnotation,
  imagePoint,
  moveHistory,
  paintAnnotation,
  type ImageAnnotation,
  type ImageEdit,
} from "./imageAnnotations";
const line: ImageAnnotation = {
  tool: "line",
  points: [
    { x: 10, y: 10 },
    { x: 90, y: 90 },
  ],
  color: "#ef4444",
  width: 4,
};
const original: ImageEdit = { source: "original", operations: [], cursor: 0 };
describe("reversible attachment annotations", () => {
  it("retains original and redo history across save/reopen, replacing only the undone branch", () => {
    const edited = appendAnnotation(appendAnnotation(original, line), {
      ...line,
      tool: "arrow",
    });
    const reopened = structuredClone(moveHistory(edited, -1));
    expect(reopened.operations).toHaveLength(2);
    expect(moveHistory(reopened, 1)).toEqual(edited);
    const branch = appendAnnotation(reopened, {
      ...line,
      tool: "text",
      text: "批注",
    });
    expect(branch.cursor).toBe(2);
    expect(branch.operations.map((o) => o.tool)).toEqual(["line", "text"]);
    expect(branch.source).toBe(original.source);
    expect(edited.operations[1].tool).toBe("arrow");
    expect(moveHistory(original, -1).cursor).toBe(0);
    expect(moveHistory(branch, 100).cursor).toBe(2);
  });
  it("maps scaled and scrolled pointer coordinates to original pixels and clamps to bounds", () => {
    const rect = { left: -100, top: 80, width: 320, height: 200 };
    expect(imagePoint(60, 180, rect, 1280, 800)).toEqual({ x: 640, y: 400 });
    expect(imagePoint(-200, 1000, rect, 1280, 800)).toEqual({ x: 0, y: 800 });
  });
  it("renders two arrow heads, multiline text and pen taps through the same export renderer", () => {
    const ctx = Object.fromEntries(
      [
        "save",
        "restore",
        "beginPath",
        "moveTo",
        "lineTo",
        "stroke",
        "fillText",
      ].map((key) => [key, vi.fn()]),
    ) as unknown as CanvasRenderingContext2D;
    paintAnnotation(ctx, { ...line, tool: "arrow" });
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.lineTo).toHaveBeenCalledTimes(3);
    paintAnnotation(ctx, {
      ...line,
      tool: "text",
      text: "中文\nsecond",
      fontSize: 24,
    });
    expect(ctx.fillText).toHaveBeenCalledWith("中文", 10, 10);
    expect(ctx.fillText).toHaveBeenCalledWith("second", 10, 41.2);
    paintAnnotation(ctx, { ...line, tool: "pen", points: [{ x: 5, y: 5 }] });
    expect(ctx.lineTo).toHaveBeenLastCalledWith(5.01, 5);
  });
});
