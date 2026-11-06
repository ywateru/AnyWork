/** The reference's grapheme-aware middle truncation, preserving a file suffix. */
export function truncatePromptFileName(
  title: string,
  fits: (text: string) => boolean,
) {
  if (typeof Intl.Segmenter !== "function") return title;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const dot = title.lastIndexOf(".");
  const extension =
    dot > 0 && dot < title.length - 1 && !/\s/u.test(title.slice(dot))
      ? title.slice(dot)
      : "";
  const segments = Array.from(
    segmenter.segment(title),
    (entry) => entry.segment,
  );
  const tailLength = extension
    ? Array.from(segmenter.segment(extension)).length + 1
    : 0;
  const tail = extension ? segments.slice(-tailLength).join("") : "";
  const minimal = `${segments[0] ?? ""}…${extension}`;
  let result = extension;
  if (fits(`…${tail}`)) result = `…${tail}`;
  else if (fits(minimal)) result = minimal;
  let from = extension ? tailLength + 1 : 1;
  let to = segments.length - 1;
  while (from <= to) {
    const count = Math.floor((from + to) / 2);
    const end = extension ? Math.max(tailLength, Math.floor(count / 2)) : 0;
    const candidate = `${segments.slice(0, count - end).join("")}…${end > 0 ? segments.slice(-end).join("") : ""}`;
    if (fits(candidate)) {
      result = candidate;
      from = count + 1;
    } else to = count - 1;
  }
  return result;
}

/** Live-only measurement. Schema clipboard DOM keeps the entire title. */
export function mountPromptFileName(label: HTMLElement, title: string) {
  const document = label.ownerDocument;
  const root = document.createElement("span");
  root.className = "prompt-file-name";
  root.setAttribute("aria-hidden", "true");
  const full = document.createElement("span");
  full.className = "prompt-file-name-full";
  full.dataset.fileName = title;
  const display = document.createElement("span");
  display.className = "prompt-file-name-display";
  display.textContent = title;
  const measurement = document.createElement("span");
  measurement.className = "prompt-file-name-measurement";
  const text = document.createTextNode("");
  measurement.append(text);
  root.append(full, display, measurement);
  label.replaceChildren(root);
  const range = document.createRange();
  let previousWidth: number | undefined, previousFullWidth: number | undefined;
  const update = (force = false) => {
    const width = root.getBoundingClientRect().width,
      fullWidth = full.getBoundingClientRect().width;
    if (!force && width === previousWidth && fullWidth === previousFullWidth)
      return;
    previousWidth = width;
    previousFullWidth = fullWidth;
    const value =
      width <= 0 || fullWidth <= width
        ? title
        : truncatePromptFileName(title, (candidate) => {
            text.data = candidate;
            range.selectNodeContents(measurement);
            return range.getBoundingClientRect().width <= width;
          });
    text.data = "";
    if (display.textContent !== value) display.textContent = value;
  };
  const observer = new ResizeObserver(() => update());
  observer.observe(root);
  observer.observe(full);
  update();
  const fontLoaded = () => update(true);
  document.fonts?.addEventListener("loadingdone", fontLoaded);
  return () => {
    observer.disconnect();
    document.fonts?.removeEventListener("loadingdone", fontLoaded);
  };
}
