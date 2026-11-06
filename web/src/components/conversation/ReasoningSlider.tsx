import { useEffect, useRef, type KeyboardEvent } from "react";

export interface ReasoningOption {
  reasoningEffort: string;
  description?: string;
}
export const effortLabel = (effort: string): string =>
  ({
    none: "无",
    minimal: "极低",
    low: "轻度",
    medium: "中",
    high: "高",
    xhigh: "极高",
    max: "Max",
    ultra: "Ultra",
  })[effort] || effort;

/** The explicit-model branch uses the catalog's ordering, including future efforts. */
export default function ReasoningSlider({
  options,
  value,
  disabled,
  onChange,
  onConfirm,
}: {
  options: ReasoningOption[];
  value: string;
  disabled: boolean;
  onChange: (effort: string) => void;
  onConfirm: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    pointer = useRef<number | null>(null),
    wheel = useRef(0),
    lastWheelAt = useRef(-Infinity);
  const selected = Math.max(
    0,
    options.findIndex((option) => option.reasoningEffort === value),
  );
  function select(index: number) {
    const option = options[Math.max(0, Math.min(options.length - 1, index))];
    if (!disabled && option && option.reasoningEffort !== value)
      onChange(option.reasoningEffort);
  }
  function at(clientX: number) {
    const bounds = root.current?.getBoundingClientRect();
    if (!bounds) return;
    const space = Math.max(1, bounds.width - 28);
    select(
      Math.round(((clientX - bounds.left - 14) / space) * (options.length - 1)),
    );
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      return;
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "Enter",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    if (event.key === "Enter") onConfirm();
    else
      select(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : selected +
              (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1),
      );
  }
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const scroll = (event: WheelEvent) => {
      if (disabled || document.activeElement !== element) return;
      event.preventDefault();
      event.stopPropagation();
      const now = performance.now();
      if (
        now - lastWheelAt.current >= 160 ||
        (wheel.current !== 0 &&
          Math.sign(event.deltaY) !== Math.sign(wheel.current))
      )
        wheel.current = 0;
      lastWheelAt.current = now;
      wheel.current += event.deltaY;
      if (Math.abs(wheel.current) >= 30) {
        select(selected + (wheel.current > 0 ? 1 : -1));
        wheel.current = 0;
      }
    };
    // React's delegated wheel listener is passive; this control must consume
    // focused wheel gestures without scrolling the surrounding conversation.
    element.addEventListener("wheel", scroll, { passive: false });
    return () => element.removeEventListener("wheel", scroll);
  });
  const progress = (selected / Math.max(1, options.length - 1)) * 100;
  return (
    <div className="reasoning-slider-container" data-reasoning-slider>
      <div
        ref={root}
        className="reasoning-slider"
        role="slider"
        aria-label="选择推理强度"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.max(1, options.length - 1)}
        aria-valuenow={selected}
        aria-valuetext={`${effortLabel(value)}${options[selected]?.description ? ` · ${options[selected].description}` : ""}`}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={keys}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          at(event.clientX);
        }}
        onPointerMove={(event) => {
          if (pointer.current === event.pointerId) at(event.clientX);
        }}
        onPointerUp={(event) => {
          if (pointer.current !== event.pointerId) return;
          pointer.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          pointer.current = null;
        }}
        onLostPointerCapture={() => {
          pointer.current = null;
        }}
        onBlur={() => {
          wheel.current = 0;
        }}
      >
        <div className="reasoning-slider-track">
          <div
            className="reasoning-slider-range"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="reasoning-slider-ticks" aria-hidden="true">
          {options.map((option, index) => (
            <span
              key={option.reasoningEffort}
              className={index <= selected ? "is-selected" : ""}
              title={effortLabel(option.reasoningEffort)}
              style={{
                left: `${(index / Math.max(1, options.length - 1)) * 100}%`,
              }}
            />
          ))}
        </div>
        <div
          className="reasoning-slider-thumb"
          aria-hidden="true"
          style={{ left: `calc(14px + (100% - 28px) * ${progress / 100})` }}
        />
      </div>
    </div>
  );
}
