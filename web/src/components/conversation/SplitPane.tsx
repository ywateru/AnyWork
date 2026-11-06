import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const MIN_PANE = 160;

function savedWidth(key: string): number | null {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value >= MIN_PANE ? value : null;
  } catch {
    return null;
  }
}

/** The desktop split keeps the conversation mounted, including its draft and scroll anchor. */
export default function SplitPane({
  children,
  panel,
  header,
  panelHeader,
  label,
  storageKey,
}: {
  children: ReactNode;
  panel: ReactNode;
  header: ReactNode;
  panelHeader: ReactNode;
  label: string;
  storageKey: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const id = useId();
  const key = `anywork.split.${storageKey}:split-left-width`;
  const [width, setWidth] = useState(() => savedWidth(key));
  const [available, setAvailable] = useState(0);
  const [dragging, setDragging] = useState(false);
  const max = Math.max(MIN_PANE, available - MIN_PANE);
  const left = Math.max(MIN_PANE, Math.min(max, width ?? available / 2));
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailable(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setWidth(savedWidth(key)), [key]);
  function resize(value: number | null) {
    setWidth(value);
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch {
      /* A blocked storage area must not prevent resizing. */
    }
  }
  return (
    <div
      ref={host}
      className={`workbench anywork-workbench${panel ? " has-inspector" : ""}${dragging ? " is-resizing" : ""}`}
      style={{ "--split-left": `${left}px` } as CSSProperties}
    >
      <div id={`${id}-conversation`} className="split-conversation">
        {header}
        {children}
      </div>
      {panel && (
        <>
          <div
            className="split-handle inspector-resizer"
            role="separator"
            tabIndex={0}
            aria-label="调整侧栏宽度"
            aria-orientation="vertical"
            aria-controls={`${id}-conversation conversation-panel`}
            aria-valuemin={MIN_PANE}
            aria-valuemax={Math.round(max)}
            aria-valuenow={Math.round(left)}
            onDoubleClick={() => resize(null)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowLeft"
                  ? left - 10
                  : event.key === "ArrowRight"
                    ? left + 10
                    : event.key === "Home"
                      ? MIN_PANE
                      : event.key === "End"
                        ? max
                        : null;
              if (next === null) return;
              event.preventDefault();
              resize(Math.max(MIN_PANE, Math.min(max, next)));
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(true);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId))
                return;
              const origin = host.current!.getBoundingClientRect().left;
              resize(Math.max(MIN_PANE, Math.min(max, event.clientX - origin)));
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              setDragging(false);
            }}
            onLostPointerCapture={() => setDragging(false)}
          />
          <aside
            id="conversation-panel"
            className="workspace-inspector"
            aria-label={label}
          >
            {panelHeader}
            {panel}
          </aside>
        </>
      )}
    </div>
  );
}
