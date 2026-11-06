export type ImagePoint = { x: number; y: number };
export type ImageAnnotation = {
  tool: "pen" | "line" | "arrow" | "text";
  points: ImagePoint[];
  color: string;
  width: number;
  text?: string;
  fontSize?: number;
};
export type ImageEdit = {
  // The original image and vector history survive flattening and reopening.
  source: string;
  operations: ImageAnnotation[];
  cursor: number;
};
export type ComposerAttachment = {
  name: string;
  path: string;
  preview?: string;
  pending?: boolean;
  uploadKey?: string;
  imageEdit?: ImageEdit;
};
export function appendAnnotation(
  edit: ImageEdit,
  operation: ImageAnnotation,
): ImageEdit {
  return {
    ...edit,
    operations: [...edit.operations.slice(0, edit.cursor), operation],
    cursor: edit.cursor + 1,
  };
}
export function moveHistory(edit: ImageEdit, offset: number): ImageEdit {
  return {
    ...edit,
    cursor: Math.max(0, Math.min(edit.operations.length, edit.cursor + offset)),
  };
}
export function imagePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
): ImagePoint {
  return {
    x: Math.max(
      0,
      Math.min(width, ((clientX - rect.left) * width) / rect.width),
    ),
    y: Math.max(
      0,
      Math.min(height, ((clientY - rect.top) * height) / rect.height),
    ),
  };
}
export function paintAnnotation(
  ctx: CanvasRenderingContext2D,
  op: ImageAnnotation,
) {
  const first = op.points[0];
  if (!first) return;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = op.color;
  ctx.lineWidth = op.width;
  ctx.lineCap = ctx.lineJoin = "round";
  if (op.tool === "text") {
    const size = op.fontSize || 28;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    (op.text || "")
      .split("\n")
      .forEach((line, i) =>
        ctx.fillText(line, first.x, first.y + i * size * 1.3),
      );
  } else {
    const last = op.points.at(-1)!;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const point of op.tool === "pen" ? op.points.slice(1) : [last])
      ctx.lineTo(point.x, point.y);
    // A tap with the pen still leaves a dot.
    if (op.points.length === 1) ctx.lineTo(first.x + 0.01, first.y);
    ctx.stroke();
    if (op.tool === "arrow") {
      const angle = Math.atan2(last.y - first.y, last.x - first.x);
      const length = Math.max(12, op.width * 4);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(
        last.x - length * Math.cos(angle - Math.PI / 6),
        last.y - length * Math.sin(angle - Math.PI / 6),
      );
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(
        last.x - length * Math.cos(angle + Math.PI / 6),
        last.y - length * Math.sin(angle + Math.PI / 6),
      );
      ctx.stroke();
    }
  }
  ctx.restore();
}
export function blobDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片无法读取，请重试"));
    reader.readAsDataURL(blob);
  });
}
