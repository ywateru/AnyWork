import { invoke, listen } from "./bridge";
import { installPlatformServices, platformError } from "../platform";
const LIMIT = 22 * 1024 * 1024;
const CHUNK = 64 * 1024;
const active = new Set<string>();
let exportEpoch = 0;
export type DialogRequest = {
  message: string;
  value?: string;
  resolve(value: string | boolean | null): void;
};
type Edges = { top: number; right: number; bottom: number; left: number };
export interface Insets {
  unit: "cssPx";
  revision: number;
  systemBars: Edges;
  cutout: Edges;
  ime: Edges;
  imeVisible: boolean;
}
function encode(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export async function cancelExports() {
  exportEpoch++;
  const handles = [...active];
  for (const handle of handles) active.delete(handle);
  await Promise.allSettled(
    handles.map((handle) =>
      invoke("plugin:mobile-system|export_abort", { handle }),
    ),
  );
}
async function exportBlob(blob: Blob, name: string, purpose: "save" | "share") {
  if (blob.size > LIMIT) throw new Error("文件超过 22 MiB，无法导出");
  const epoch = exportEpoch;
  let handle: string | undefined;
  try {
    ({ handle } = await invoke<{ handle: string }>(
      "plugin:mobile-system|export_begin",
      {
        name: name.split(/[\\/]/).pop() || "AnyWork",
        mime: blob.type || "application/octet-stream",
        expectedBytes: blob.size,
        purpose,
      },
    ));
    active.add(handle);
    for (
      let offset = 0, sequence = 0;
      offset < blob.size;
      offset += CHUNK, sequence++
    ) {
      if (epoch !== exportEpoch) throw new Error("导出已取消");
      const bytes = new Uint8Array(
        await blob.slice(offset, offset + CHUNK).arrayBuffer(),
      );
      const ack = await invoke<{ received: number }>(
        "plugin:mobile-system|export_write",
        { handle, sequence, base64: encode(bytes) },
      );
      if (ack.received !== Math.min(offset + CHUNK, blob.size))
        throw new Error("文件写入确认不匹配");
    }
    if (epoch !== exportEpoch) throw new Error("导出已取消");
    const result = await invoke<{
      status: "saved" | "cancelled" | "chooserOpened";
    }>("plugin:mobile-system|export_finish", { handle });
    if (epoch !== exportEpoch) return;
    if (
      (purpose === "save" && result.status === "chooserOpened") ||
      (purpose === "share" && result.status === "saved")
    )
      throw new Error("系统返回了不匹配的导出结果");
    if (!["saved", "cancelled", "chooserOpened"].includes(result.status))
      throw new Error("系统未确认导出结果");
    window.dispatchEvent(
      new CustomEvent("anywork-platform-status", {
        detail:
          result.status === "saved"
            ? "已保存到所选位置"
            : result.status === "chooserOpened"
              ? "已打开系统分享面板"
              : "已取消保存",
      }),
    );
  } catch (error) {
    if (handle)
      await invoke("plugin:mobile-system|export_abort", { handle }).catch(
        () => {},
      );
    if (epoch !== exportEpoch) return;
    throw error;
  } finally {
    if (handle) active.delete(handle);
  }
}
export async function openExternal(value: string) {
  // The corresponding-source link is a public product URL, never the privileged asset origin.
  if (value === "/source" || value === "source")
    value = "https://anywork.aixgg.com/source";
  const url = new URL(value, location.href);
  if (url.origin === location.origin && url.hash) {
    if (url.pathname !== location.pathname)
      throw new Error("无法打开此内部页面");
    location.hash = url.hash;
    return;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.origin === location.origin
  )
    throw new Error("仅支持安全的 HTTPS 外部链接");
  await invoke("plugin:mobile-system|open_external", { url: url.href });
}
export async function startSystem(options: {
  back(): Promise<boolean>;
  foreground(): Promise<void>;
  dialog(request: DialogRequest): void;
}) {
  const cleanups: (() => void)[] = [];
  let stopped = false;
  let revision = -1;
  let backRevision = -1;
  let lifecycleRevision = -1;
  let appearanceTail = Promise.resolve();
  let requestedDark: boolean | undefined;
  const syncAppearance = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    if (requestedDark === dark) return appearanceTail;
    requestedDark = dark;
    appearanceTail = appearanceTail
      .catch(() => {})
      .then(async () => {
        if (stopped) return;
        const ack = await invoke<{ dark: boolean }>(
          "plugin:mobile-system|appearance_set",
          { dark },
        );
        if (ack.dark !== dark)
          throw new Error("系统栏外观未确认，请重新打开应用");
      });
    return appearanceTail;
  };
  function applyInsets(value: Insets) {
    if (stopped || value.revision <= revision) return;
    if (value.unit !== "cssPx") throw new Error("原生安全区单位不匹配");
    revision = value.revision;
    const root = document.documentElement;
    for (const side of ["top", "right", "bottom", "left"] as const)
      root.style.setProperty(
        `--mobile-${side}`,
        `${Math.max(0, Math.max(value.systemBars[side], value.cutout[side]))}px`,
      );
    root.style.setProperty(
      "--mobile-ime",
      `${Math.max(0, value.ime.bottom)}px`,
    );
    root.dataset.ime = String(value.imeVisible);
    window.dispatchEvent(new Event("resize"));
  }
  cleanups.push(
    installPlatformServices({
      save: (blob, name) => exportBlob(blob, name, "save"),
      share: (blob, name) => exportBlob(blob, name, "share"),
      open: openExternal,
      confirm: (message) =>
        new Promise((resolve) =>
          options.dialog({ message, resolve: (v) => resolve(v === true) }),
        ),
      prompt: (message, value) =>
        new Promise((resolve) =>
          options.dialog({
            message,
            value,
            resolve: (v) => resolve(typeof v === "string" ? v : null),
          }),
        ),
    }),
  );
  const click = (event: MouseEvent) => {
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
    if (!link || event.defaultPrevented) return;
    const href = link.getAttribute("href")!;
    if (href.startsWith("#")) return;
    event.preventDefault();
    if (link.hasAttribute("download") && href.startsWith("blob:")) {
      void fetch(href)
        .then((response) => response.blob())
        .then((blob) => exportBlob(blob, link.download || "AnyWork", "save"))
        .catch(platformError);
    } else void openExternal(href).catch(platformError);
  };
  // Bubble phase lets existing thread/file link handlers resolve their own destinations first.
  document.addEventListener("click", click);
  cleanups.push(() => document.removeEventListener("click", click));
  try {
    const appearanceObserver = new MutationObserver(() => {
      void syncAppearance().catch(platformError);
    });
    appearanceObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    cleanups.push(() => appearanceObserver.disconnect());
    await syncAppearance();
    cleanups.push(await listen<Insets>("mobile-system-insets", applyInsets));
    cleanups.push(
      await listen<{ eventId: number; revision: number }>(
        "mobile-system-back",
        (event) => {
          if (
            !Number.isSafeInteger(event.eventId) ||
            event.eventId <= backRevision
          )
            return;
          backRevision = event.eventId;
          // Acknowledge taking ownership immediately, including a still-open dirty-edit dialog.
          const result = options.back();
          void invoke("plugin:mobile-system|back_set_state", {
            ...backState,
            handledEventId: event.eventId,
          }).catch(platformError);
          void result.catch(platformError);
        },
      ),
    );
    cleanups.push(
      await listen<{ foreground: boolean; revision: number }>(
        "mobile-system-lifecycle",
        (event) => {
          if (event.revision <= lifecycleRevision) return;
          lifecycleRevision = event.revision;
          if (event.foreground) void options.foreground().catch(platformError);
        },
      ),
    );
    applyInsets(await invoke<Insets>("plugin:mobile-system|insets_get"));
  } catch (error) {
    stopped = true;
    for (const cleanup of cleanups.reverse()) cleanup();
    throw error;
  }
  return () => {
    stopped = true;
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
let backState = { canGoBack: false, blocking: false };
export function backSetState(canGoBack: boolean, blocking = false) {
  backState = { canGoBack, blocking };
  return invoke("plugin:mobile-system|back_set_state", backState);
}
