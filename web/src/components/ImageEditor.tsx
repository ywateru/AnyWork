import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Check,
  Hand,
  Minus,
  Pencil,
  Plus,
  Redo2,
  Slash,
  Type,
  Undo2,
  X,
} from "lucide-react";
import {
  appendAnnotation,
  blobDataURL,
  imagePoint,
  moveHistory,
  paintAnnotation,
  type ImageAnnotation,
  type ImageEdit,
  type ImagePoint,
} from "../imageAnnotations";
import "./image-editor.css";

type Tool = ImageAnnotation["tool"] | "pan";
export default function ImageEditor({
  source,
  name,
  initial,
  onSave,
  onClose,
}: {
  source: string;
  name: string;
  initial?: ImageEdit;
  onSave: (edit: ImageEdit, blob: Blob, preview: string) => Promise<void>;
  onClose: () => void;
}) {
  const [edit, setEdit] = useState<ImageEdit>(
    initial || { source: "", operations: [], cursor: 0 },
  );
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#ef4444");
  const [width, setWidth] = useState(4);
  const [fontSize, setFontSize] = useState(28);
  const [zoom, setZoom] = useState(1);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [stroke, setStroke] = useState<ImageAnnotation | null>(null);
  const [text, setText] = useState<{ point: ImagePoint; value: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    stroke: ImageAnnotation | null;
  } | null>(null);
  const actions = useRef({ onClose, saving, text });
  actions.current = { onClose, saving, text };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void (async () => {
      const original =
        initial?.source ||
        (await blobDataURL(
          await (await fetch(source, { signal: controller.signal })).blob(),
        ));
      const loaded = new Image();
      loaded.src = original;
      await loaded.decode();
      if (loaded.naturalWidth * loaded.naturalHeight > 40_000_000)
        throw new Error("图片分辨率过大，请使用不超过 4000 万像素的图片");
      if (!controller.signal.aborted) {
        setEdit(initial || { source: original, operations: [], cursor: 0 });
        setImage(loaded);
      }
    })().catch((e) => {
      if (!controller.signal.aborted) setError(e.message || "图片加载失败");
    });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [source, initial]);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      setBounds({
        width: node.clientWidth - 32,
        height: node.clientHeight - 32,
      }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (e: KeyboardEvent) => {
      const input = (e.target as HTMLElement)?.matches(
        "input,textarea,select,[contenteditable=true]",
      );
      if (e.key === "Escape" && !actions.current.saving) {
        e.preventDefault();
        if (actions.current.text) setText(null);
        else actions.current.onClose();
      }
      if (
        !input &&
        !actions.current.saving &&
        (e.metaKey || e.ctrlKey) &&
        ["z", "y"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        setEdit((old) =>
          moveHistory(old, e.shiftKey || e.key.toLowerCase() === "y" ? 1 : -1),
        );
      }
      if (e.key === "Tab") {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".image-editor button:not(:disabled), .image-editor input:not(:disabled), .image-editor textarea:not(:disabled), .image-editor select:not(:disabled)",
          ),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = before;
      previousFocus?.focus();
    };
  }, []);
  function render(target: HTMLCanvasElement, operations: ImageAnnotation[]) {
    if (!image) return;
    const ctx = target.getContext("2d");
    if (!ctx) throw new Error("浏览器无法创建图片画布");
    target.width = image.naturalWidth;
    target.height = image.naturalHeight;
    ctx.drawImage(image, 0, 0);
    operations.forEach((op) => paintAnnotation(ctx, op));
  }
  const textAnnotation = (): ImageAnnotation | null =>
    text?.value.trim()
      ? {
          tool: "text",
          points: [text.point],
          text: text.value,
          fontSize,
          color,
          width,
        }
      : null;
  useEffect(() => {
    if (!canvas.current || !image) return;
    const preview = textAnnotation();
    render(canvas.current, [
      ...edit.operations.slice(0, edit.cursor),
      ...(stroke ? [stroke] : []),
      ...(preview ? [preview] : []),
    ]);
  }, [image, edit, stroke, text, color, width, fontSize]);
  const commitText = () => {
    const annotation = textAnnotation();
    if (annotation) setEdit((old) => appendAnnotation(old, annotation));
    setText(null);
  };
  const save = async () => {
    if (!image || saving || pointer.current) return;
    const annotation = textAnnotation();
    const next = annotation ? appendAnnotation(edit, annotation) : edit;
    setSaving(true);
    setError("");
    try {
      const output = document.createElement("canvas");
      render(output, next.operations.slice(0, next.cursor));
      const blob = await new Promise<Blob>((resolve, reject) =>
        output.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("图片导出失败，请重试"))),
          "image/png",
        ),
      );
      if (blob.size > 20 * 1024 * 1024)
        throw new Error("编辑后的图片超过 20 MiB，请缩小原图后重试");
      const preview = await blobDataURL(blob);
      if (!alive.current) return;
      await onSave(next, blob, preview);
      if (alive.current) onClose();
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "保存失败，编辑内容已保留，请重试",
        );
    } finally {
      if (alive.current) setSaving(false);
    }
  };
  const fit = image
    ? Math.min(
        1,
        bounds.width / image.naturalWidth,
        bounds.height / image.naturalHeight,
      )
    : 1;
  const tools = [
    ["pan", Hand, "移动"],
    ["pen", Pencil, "画笔"],
    ["line", Slash, "直线"],
    ["arrow", ArrowUpRight, "箭头"],
    ["text", Type, "文字"],
  ] as const;
  return createPortal(
    <div
      className="image-editor"
      role="dialog"
      aria-modal="true"
      aria-label="编辑图片"
      aria-busy={saving}
    >
      <header className="image-editor-header">
        <button
          type="button"
          aria-label="取消编辑"
          title="取消编辑"
          onClick={onClose}
          disabled={saving}
          autoFocus
        >
          <X size={20} />
        </button>
        <span title={name}>{name}</span>
        <button
          type="button"
          className="image-editor-done"
          onClick={() => void save()}
          disabled={!image || saving}
        >
          <Check size={17} />
          {saving ? "正在保存…" : "完成"}
        </button>
      </header>
      <div
        className="image-editor-tools"
        role="toolbar"
        aria-label="图片批注工具"
      >
        <div className="image-editor-tool-group">
          {tools.map(([value, Icon, label]) => (
            <button
              type="button"
              key={value}
              aria-label={label}
              title={label}
              aria-pressed={tool === value}
              disabled={saving}
              onClick={() => {
                commitText();
                setTool(value);
              }}
            >
              <Icon size={19} />
            </button>
          ))}
        </div>
        <label className="image-editor-color" title="批注颜色">
          <input
            type="color"
            aria-label="批注颜色"
            value={color}
            disabled={saving}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label className="image-editor-size">
          {tool === "text" ? "字号" : "粗细"}
          <select
            aria-label={tool === "text" ? "文字大小" : "线条粗细"}
            value={tool === "text" ? fontSize : width}
            disabled={saving}
            onChange={(e) =>
              tool === "text"
                ? setFontSize(Number(e.target.value))
                : setWidth(Number(e.target.value))
            }
          >
            {(tool === "text"
              ? [16, 24, 28, 36, 48, 64]
              : [2, 4, 8, 12, 20]
            ).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className="image-editor-tool-group">
          <button
            type="button"
            aria-label="撤销批注"
            title="撤销 (⌘/Ctrl Z)"
            disabled={saving || edit.cursor === 0 || !!text}
            onClick={() => setEdit((old) => moveHistory(old, -1))}
          >
            <Undo2 size={19} />
          </button>
          <button
            type="button"
            aria-label="重做批注"
            title="重做 (⌘/Ctrl Shift Z)"
            disabled={
              saving || edit.cursor === edit.operations.length || !!text
            }
            onClick={() => setEdit((old) => moveHistory(old, 1))}
          >
            <Redo2 size={19} />
          </button>
        </div>
      </div>
      <div className="image-editor-viewport" ref={viewport}>
        {image ? (
          <div
            className="image-editor-stage"
            style={{
              width: Math.max(1, image.naturalWidth * fit * zoom),
              height: Math.max(1, image.naturalHeight * fit * zoom),
            }}
          >
            <canvas
              ref={canvas}
              aria-label="图片批注画布"
              style={{
                cursor:
                  tool === "pan"
                    ? "grab"
                    : tool === "text"
                      ? "text"
                      : "crosshair",
              }}
              onPointerDown={(e) => {
                if (saving || e.button !== 0 || !e.isPrimary || pointer.current)
                  return;
                if (text) {
                  commitText();
                  return;
                }
                e.preventDefault();
                const point = imagePoint(
                  e.clientX,
                  e.clientY,
                  e.currentTarget.getBoundingClientRect(),
                  image.naturalWidth,
                  image.naturalHeight,
                );
                if (tool === "text") {
                  setText({ point, value: "" });
                  return;
                }
                e.currentTarget.setPointerCapture(e.pointerId);
                const next: ImageAnnotation | null =
                  tool === "pan"
                    ? null
                    : { tool, points: [point], color, width };
                pointer.current = {
                  id: e.pointerId,
                  x: e.clientX,
                  y: e.clientY,
                  stroke: next,
                };
                setStroke(next);
              }}
              onPointerMove={(e) => {
                const active = pointer.current;
                if (!active || active.id !== e.pointerId) return;
                if (!active.stroke) {
                  viewport.current?.scrollBy(
                    active.x - e.clientX,
                    active.y - e.clientY,
                  );
                  active.x = e.clientX;
                  active.y = e.clientY;
                  return;
                }
                const point = imagePoint(
                  e.clientX,
                  e.clientY,
                  e.currentTarget.getBoundingClientRect(),
                  image.naturalWidth,
                  image.naturalHeight,
                );
                active.stroke = {
                  ...active.stroke,
                  points:
                    active.stroke.tool === "pen"
                      ? [...active.stroke.points, point]
                      : [active.stroke.points[0], point],
                };
                setStroke(active.stroke);
              }}
              onPointerUp={(e) => {
                const active = pointer.current;
                if (active?.id !== e.pointerId) return;
                if (active.stroke)
                  setEdit((old) => appendAnnotation(old, active.stroke!));
                pointer.current = null;
                setStroke(null);
              }}
              onPointerCancel={() => {
                pointer.current = null;
                setStroke(null);
              }}
              onLostPointerCapture={() => {
                pointer.current = null;
                setStroke(null);
              }}
            />
          </div>
        ) : (
          <div role="status">
            {error ? "无法打开编辑画布" : "正在加载图片…"}
          </div>
        )}
      </div>
      {text && (
        <form
          className="image-editor-text"
          onSubmit={(e) => {
            e.preventDefault();
            commitText();
          }}
        >
          <textarea
            autoFocus
            aria-label="批注文字"
            placeholder="输入文字批注"
            value={text.value}
            disabled={saving}
            onChange={(e) => setText({ ...text, value: e.target.value })}
          />
          <button type="submit" disabled={saving || !text.value.trim()}>
            添加文字
          </button>
          <button
            type="button"
            aria-label="取消文字"
            disabled={saving}
            onClick={() => setText(null)}
          >
            <X size={18} />
          </button>
        </form>
      )}
      {error && (
        <div className="image-editor-error" role="alert">
          {error}
        </div>
      )}
      <footer className="image-editor-footer">
        <span>
          {text
            ? "文字将添加到刚才点击的位置"
            : tool === "text"
              ? "点击图片放置文字"
              : "完成后返回输入框，可再次打开撤销修改"}
        </span>
        <div>
          <button
            type="button"
            aria-label="缩小画布"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            aria-label="画布适应窗口"
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="放大画布"
            disabled={zoom >= 5}
            onClick={() => setZoom((z) => Math.min(5, z * 1.25))}
          >
            <Plus size={16} />
          </button>
        </div>
      </footer>
    </div>,
    document.body,
  );
}
