import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Plus,
  Minus,
  RotateCcw,
  Download,
  Pencil,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Api } from "../api";

export default function ImagePreview({
  api,
  sessionId,
  path,
  compact = false,
  thumbnail = false,
  autoLoad = false,
  gallery = [],
  localSources,
  displayName,
  galleryNames,
  onLoaded,
  onEdit,
}: {
  api: Api;
  sessionId: string;
  path: string;
  compact?: boolean;
  thumbnail?: boolean;
  autoLoad?: boolean;
  gallery?: string[];
  localSources?: Record<string, string>;
  displayName?: string;
  galleryNames?: Record<string, string>;
  onLoaded?: (path: string, src: string) => void;
  onEdit?: (path: string, src: string) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (autoLoad) setRequested(true);
  }, [autoLoad]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [requested, setRequested] = useState(false);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const zoomAtRef = useRef<(amount: number, x?: number, y?: number) => void>(
    () => {},
  );
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [viewerPath, setViewerPath] = useState(path);
  const activePath = open ? viewerPath : path;
  const urls = useRef(new Map<string, string>());
  const invalidSources = useRef(new Set<string>());
  const galleryPaths = [...new Set(gallery.length ? gallery : [path])];
  const index = galleryPaths.indexOf(viewerPath);
  const changeImage = (offset: number) => {
    if (galleryPaths.length > 1) {
      setViewerPath(
        galleryPaths[
          Math.max(0, Math.min(galleryPaths.length - 1, index + offset))
        ],
      );
      setZoom(1);
    }
  };
  useEffect(
    () => () => {
      for (const url of urls.current.values()) URL.revokeObjectURL(url);
      urls.current.clear();
    },
    [],
  );
  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const backdropClick = useRef(false);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const fit =
    natural.width && natural.height
      ? Math.min(
          1,
          bounds.width / natural.width,
          bounds.height / natural.height,
        )
      : 1;
  const zoomAt = (amount: number, x?: number, y?: number) => {
    const node = viewport.current;
    const px = x ?? (node?.clientWidth || 0) / 2;
    const py = y ?? (node?.clientHeight || 0) / 2;
    const before = zoomRef.current;
    const next = Math.max(0.25, Math.min(5, before * amount));
    const imageWidth = natural.width * fit * before;
    const imageHeight = natural.height * fit * before;
    const ix =
      ((node?.scrollLeft || 0) +
        px -
        Math.max(0, ((node?.clientWidth || 0) - imageWidth) / 2)) /
      (imageWidth || 1);
    const iy =
      ((node?.scrollTop || 0) +
        py -
        Math.max(0, ((node?.clientHeight || 0) - imageHeight) / 2)) /
      (imageHeight || 1);
    setZoom(next);
    requestAnimationFrame(() => {
      if (!node) return;
      const width = natural.width * fit * next,
        height = natural.height * fit * next;
      node.scrollLeft =
        Math.max(0, (node.clientWidth - width) / 2) + ix * width - px;
      node.scrollTop =
        Math.max(0, (node.clientHeight - height) / 2) + iy * height - py;
    });
  };
  zoomAtRef.current = zoomAt;
  const changeZoom = (amount: number) => zoomAtRef.current(amount);
  useEffect(() => {
    if (!open || !viewport.current) return;
    const node = viewport.current;
    const observer = new ResizeObserver(() =>
      setBounds({ width: node.clientWidth, height: node.clientHeight }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [open]);
  useEffect(() => {
    if (open) {
      setNatural({ width: 0, height: 0 });
      viewport.current?.scrollTo(0, 0);
    }
  }, [viewerPath, open]);
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    const saved = localSources?.[activePath] || urls.current.get(activePath);
    if (saved && !invalidSources.current.has(saved)) {
      setSrc(saved);
      setError("");
      return;
    }
    let url = "";
    setError("");
    setSrc("");
    const load = async () => {
      // Data images from Codex input content contain no remote network address.
      const response = await fetch(
        activePath.startsWith("data:image/")
          ? activePath
          : api.url(
              `/api/sessions/${sessionId}/image?path=${encodeURIComponent(activePath)}`,
            ),
        {
          headers: activePath.startsWith("data:")
            ? {}
            : { Authorization: `Bearer ${api.connection.token}` },
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("图片无法读取或已被移动");
      const blob = await response.blob();
      if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type))
        throw new Error("不支持此图片格式");
      if (blob.size > 20 * 1024 * 1024) throw new Error("图片超过 20 MiB");
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      urls.current.set(activePath, url);
      setSrc(url);
      onLoaded?.(activePath, url);
    };
    void load().catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => {
      controller.abort();
    };
  }, [
    api,
    sessionId,
    activePath,
    requested,
    retry,
    localSources?.[activePath],
  ]);
  useEffect(() => {
    if (!open) return;
    pointers.current.clear();
    pinch.current = 0;
    const previousFocus =
      trigger.current || (document.activeElement as HTMLElement | null);
    const close = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        if (
          (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
          galleryPaths.length > 1
        ) {
          setViewerPath((previous) => {
            const at = galleryPaths.indexOf(previous);
            return galleryPaths[
              Math.max(
                0,
                Math.min(
                  galleryPaths.length - 1,
                  at + (e.key === "ArrowLeft" ? -1 : 1),
                ),
              )
            ];
          });
          setZoom(1);
          return;
        }
        const dx =
          e.key === "ArrowLeft" ? -60 : e.key === "ArrowRight" ? 60 : 0;
        const dy = e.key === "ArrowUp" ? -60 : e.key === "ArrowDown" ? 60 : 0;
        viewport.current?.scrollBy(dx, dy);
      }
      if (e.key === "+" || e.key === "=") changeZoom(1.25);
      if (e.key === "-") changeZoom(1 / 1.25);
      if (e.key === "0") setZoom(1);
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab") {
        const buttons = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            ".image-viewer button:not(:disabled)",
          ),
        );
        const first = buttons[0],
          last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const node = viewport.current;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = node!.getBoundingClientRect();
      zoomAtRef.current(
        Math.exp(-e.deltaY / 200),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    node?.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("keydown", close);
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = before;
      node?.removeEventListener("wheel", wheel);
      previousFocus?.focus();
    };
  }, [open]);
  const imageName = (value: string) =>
    value.startsWith("data:") ? "消息图片" : value.split("/").pop() || "图片";
  const name = displayName || imageName(path);
  const viewerName =
    galleryNames?.[viewerPath] ||
    (viewerPath === path ? name : imageName(viewerPath));
  return (
    <div
      className={`inline-image${compact ? " compact" : ""}${thumbnail && requested ? " thumbnail-image" : ""}`}
    >
      <button
        className="image-load-trigger"
        ref={trigger}
        aria-label="查看图片"
        title={name}
        onClick={() => {
          setRequested(true);
          setViewerPath(path);
          if (error) setRetry((n) => n + 1);
          setZoom(1);
          setOpen(true);
        }}
      >
        {thumbnail && requested && !src ? (
          <span
            className="thumbnail-placeholder"
            role={error ? "alert" : "status"}
          >
            {error ? (
              "加载失败，点击重试"
            ) : (
              <span className="loading-spinner" />
            )}
          </span>
        ) : thumbnail && src ? (
          <img
            className="loaded-image-thumbnail"
            src={localSources?.[path] || urls.current.get(path) || src}
            alt={name}
          />
        ) : (
          <>
            <ImageIcon size={compact ? 20 : 16} />
            {!compact && <span>查看图片</span>}
          </>
        )}
      </button>
      {open &&
        createPortal(
          <div
            className="image-viewer"
            role="dialog"
            aria-modal="true"
            aria-label="图片查看器"
          >
            <header>
              <span title={viewerName}>{viewerName}</span>
              {onEdit && (
                <button
                  type="button"
                  aria-label="编辑图片"
                  title="编辑图片"
                  disabled={!src || !!error}
                  onClick={() => {
                    setOpen(false);
                    onEdit(
                      viewerPath,
                      localSources?.[viewerPath] ||
                        urls.current.get(viewerPath) ||
                        src,
                    );
                  }}
                >
                  <Pencil size={20} />
                </button>
              )}
              <button
                aria-label="下载图片"
                disabled={!src}
                onClick={() => {
                  const link = document.createElement("a");
                  link.href = src;
                  link.download = viewerName;
                  link.click();
                }}
              >
                <Download size={20} />
              </button>
              <button
                aria-label="关闭图片查看器"
                autoFocus
                onClick={() => setOpen(false)}
              >
                <X size={20} />
              </button>
            </header>
            {galleryPaths.length > 1 && (
              <nav className="image-gallery-nav" aria-label="图片浏览">
                <button
                  aria-label="上一张图片"
                  disabled={index <= 0}
                  onClick={() => changeImage(-1)}
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  aria-label="下一张图片"
                  disabled={index >= galleryPaths.length - 1}
                  onClick={() => changeImage(1)}
                >
                  <ChevronRight size={20} />
                </button>
              </nav>
            )}
            <div
              className="image-viewport"
              ref={viewport}
              onClick={() => {
                if (backdropClick.current) setOpen(false);
              }}
              onPointerDown={(e) => {
                backdropClick.current =
                  e.target === e.currentTarget ||
                  (e.target as HTMLElement).classList.contains("image-canvas");
                pointers.current.set(e.pointerId, {
                  x: e.clientX,
                  y: e.clientY,
                });
                e.currentTarget.setPointerCapture(e.pointerId);
                if (pointers.current.size === 2) {
                  const [a, b] = [...pointers.current.values()];
                  pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
                }
              }}
              onPointerMove={(e) => {
                if (!pointers.current.has(e.pointerId)) return;
                const previous = pointers.current.get(e.pointerId)!;
                if (
                  Math.hypot(previous.x - e.clientX, previous.y - e.clientY) > 2
                )
                  backdropClick.current = false;
                if (pointers.current.size === 1 && zoom > 1) {
                  e.currentTarget.scrollLeft += previous.x - e.clientX;
                  e.currentTarget.scrollTop += previous.y - e.clientY;
                }
                pointers.current.set(e.pointerId, {
                  x: e.clientX,
                  y: e.clientY,
                });
                if (pointers.current.size === 2) {
                  const [a, b] = [...pointers.current.values()];
                  const distance = Math.hypot(a.x - b.x, a.y - b.y);
                  if (pinch.current) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    zoomAtRef.current(
                      distance / pinch.current,
                      (a.x + b.x) / 2 - rect.left,
                      (a.y + b.y) / 2 - rect.top,
                    );
                  }
                  pinch.current = distance;
                }
              }}
              onPointerUp={(e) => {
                pointers.current.delete(e.pointerId);
                pinch.current = 0;
              }}
              onPointerCancel={(e) => {
                pointers.current.delete(e.pointerId);
                pinch.current = 0;
              }}
            >
              {src ? (
                <div
                  className="image-canvas"
                  style={{
                    width: Math.max(bounds.width, natural.width * fit * zoom),
                    height: Math.max(
                      bounds.height,
                      natural.height * fit * zoom,
                    ),
                  }}
                >
                  <img
                    src={src}
                    alt={viewerName}
                    onLoad={(e) =>
                      setNatural({
                        width: e.currentTarget.naturalWidth,
                        height: e.currentTarget.naturalHeight,
                      })
                    }
                    onError={() => {
                      invalidSources.current.add(src);
                      const bad = urls.current.get(activePath);
                      if (bad) URL.revokeObjectURL(bad);
                      urls.current.delete(activePath);
                      setSrc("");
                      setError("图片解码失败");
                    }}
                    draggable={false}
                    style={{
                      width: natural.width
                        ? natural.width * fit * zoom
                        : undefined,
                      height: natural.height
                        ? natural.height * fit * zoom
                        : undefined,
                    }}
                  />
                </div>
              ) : error ? (
                <div className="viewer-placeholder" role="alert">
                  {error}
                  <button onClick={() => setRetry((n) => n + 1)}>
                    重试图片
                  </button>
                </div>
              ) : (
                <div className="viewer-placeholder" role="status">
                  <span className="loading-spinner" />
                  正在加载图片…
                </div>
              )}
            </div>
            <footer>
              {galleryPaths.length > 1 && (
                <output aria-label="图片序号">
                  {index + 1} / {galleryPaths.length}
                </output>
              )}
              <div className="image-zoom-controls">
                <button
                  aria-label="缩小图片"
                  onClick={() => changeZoom(1 / 1.25)}
                >
                  <Minus size={18} />
                </button>
                <output aria-label="图片缩放比例">
                  {Math.round(zoom * 100)}%
                </output>
                <button aria-label="放大图片" onClick={() => changeZoom(1.25)}>
                  <Plus size={18} />
                </button>
                <button aria-label="适应窗口" onClick={() => setZoom(1)}>
                  <RotateCcw size={18} />
                </button>
              </div>
            </footer>
          </div>,
          document.body,
        )}
    </div>
  );
}
