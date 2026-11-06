import { useLayoutEffect, useRef, useState } from "react";

/** Measure actual nodes so the diagram keeps its connections when text or windows resize. */
export function NetworkLines() {
  const svg = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  useLayoutEffect(() => {
    const root = svg.current?.parentElement;
    if (!root) return;
    const node = (name: string) =>
      root.querySelector<HTMLElement>(`[data-node="${name}"]`);
    function measure() {
      const box = root!.getBoundingClientRect();
      const bounds = (name: string) => {
        const rect = node(name)?.getBoundingClientRect();
        return rect
          ? {
              left: rect.left - box.left,
              right: rect.right - box.left,
              top: rect.top - box.top,
              bottom: rect.bottom - box.top,
              x: rect.left - box.left + rect.width / 2,
              y: rect.top - box.top + rect.height / 2,
            }
          : null;
      };
      const hub = bounds("hub"),
        agent = bounds("agent"),
        lan = bounds("lan");
      if (!hub || !agent || !lan) return;
      const next: string[] = [];
      const horizontal = (
        from: NonNullable<typeof hub>,
        to: NonNullable<typeof hub>,
      ) => {
        if (to.left > from.right) {
          const middle = (from.right + to.left) / 2;
          return `M${from.right + 2},${from.y} C${middle},${from.y} ${middle},${to.y} ${to.left - 5},${to.y}`;
        }
        return `M${from.x},${from.bottom + 2} L${from.x},${(from.bottom + to.top) / 2} L${to.x},${(from.bottom + to.top) / 2} L${to.x},${to.top - 5}`;
      };
      next.push(horizontal(agent, hub));
      for (const name of ["quick", "named", "relay"]) {
        const route = bounds(name);
        if (route) next.push(horizontal(hub, route));
      }
      const controls = bounds("controls") || hub;
      next.push(
        `M${controls.x},${controls.bottom + 2} L${lan.x},${lan.top - 5}`,
      );
      setPaths((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root
      .querySelectorAll<HTMLElement>("[data-node]")
      .forEach((element) => observer.observe(element));
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return (
    <svg ref={svg} className="network-lines" aria-hidden="true">
      <defs>
        <marker
          id="connection-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M1 1L5 4L1 7" fill="none" />
        </marker>
      </defs>
      {paths.map((d, index) => (
        <path key={index} d={d} markerEnd="url(#connection-arrow)" />
      ))}
    </svg>
  );
}
