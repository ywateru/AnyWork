export interface FileTarget {
  path: string;
  line?: number;
  anchor?: string;
}
/** Classify local references without turning http(s) or application URLs into file reads. */
export function localFileTarget(
  href: string | undefined,
  cwd: string,
  basePath?: string,
): FileTarget | null {
  if (!href || href.startsWith("#") || href.startsWith("//")) return null;
  let value: string;
  try {
    value = decodeURIComponent(href);
  } catch {
    return null;
  }
  if (value.startsWith("file://")) {
    try {
      const url = new URL(value);
      if (url.hostname && url.hostname !== "localhost") return null;
      value = decodeURIComponent(url.pathname) + url.hash;
    } catch {
      return null;
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  const hash = value.indexOf("#");
  let anchor = hash < 0 ? undefined : value.slice(hash + 1);
  value = hash < 0 ? value : value.slice(0, hash);
  const suffix = value.match(/:(\d+)(?::\d+)?$/);
  const line = suffix
    ? Number(suffix[1])
    : anchor?.match(/^L(\d+)(?:-L?\d+)?$/)?.[1];
  if (suffix) value = value.slice(0, suffix.index);
  if (line) anchor = undefined;
  // A local reference must identify a path; bare words remain ordinary links.
  if (!value || (!value.includes("/") && !/\.[a-z0-9]{1,12}$/i.test(value)))
    return null;
  const base = basePath ? basePath.slice(0, basePath.lastIndexOf("/")) : cwd;
  const absolute = value.startsWith("/") ? value : `${base}/${value}`;
  const parts: string[] = [];
  for (const part of absolute.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return {
    path: "/" + parts.join("/"),
    ...(line ? { line: Number(line) } : {}),
    ...(anchor ? { anchor } : {}),
  };
}
export const isImagePath = (path: string) =>
  /\.(png|jpe?g|gif|webp)$/i.test(path);
