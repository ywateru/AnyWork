/** Optional host services. The browser keeps its own download and navigation behavior. */
export interface PlatformServices {
  save(blob: Blob, name: string): Promise<void>;
  share(blob: Blob, name: string): Promise<void>;
  open(url: string): Promise<void>;
  confirm(message: string): Promise<boolean>;
  prompt(message: string, value: string): Promise<string | null>;
}
let services: PlatformServices | undefined;
export const isNativeClient = () => !!services;
export function installPlatformServices(next: PlatformServices) {
  services = next;
  return () => {
    if (services === next) services = undefined;
  };
}
export function platformError(error: unknown) {
  window.dispatchEvent(
    new CustomEvent("anywork-platform-error", {
      detail: error instanceof Error ? error.message : String(error),
    }),
  );
}
export async function saveBlob(blob: Blob, name: string) {
  if (services) return services.save(blob, name);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function shareBlob(blob: Blob, name: string) {
  if (!services) throw new Error("当前环境不支持系统分享");
  return services.share(blob, name);
}
export function openPlatformLink(url: string) {
  if (services) void services.open(url).catch(platformError);
  else window.open(url, "_blank", "noopener,noreferrer");
}
export const confirmPlatform = (message: string) =>
  services
    ? services.confirm(message)
    : Promise.resolve(window.confirm(message));
export const promptPlatform = (message: string, value: string) =>
  services
    ? services.prompt(message, value)
    : Promise.resolve(window.prompt(message, value));
