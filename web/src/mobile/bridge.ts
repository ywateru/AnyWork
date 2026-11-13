/** Public withGlobalTauri API only. No private Tauri internals or browser auth fallback. */
type Unlisten = () => void;
interface PublicTauri {
  core: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  event: {
    listen<T>(
      name: string,
      callback: (event: { payload: T }) => void,
    ): Promise<Unlisten>;
  };
}
const publicApi = () =>
  (window as Window & { __TAURI__?: PublicTauri }).__TAURI__;
export function invoke<T>(command: string, request?: object): Promise<T> {
  if (!publicApi())
    return Promise.reject(new Error("请在 AnyWork Android 应用中打开此界面"));
  return publicApi()!.core.invoke<T>(
    command,
    request === undefined ? undefined : { request },
  );
}
export function listen<T>(event: string, callback: (payload: T) => void) {
  if (!publicApi()) return Promise.reject(new Error("原生事件接口不可用"));
  return publicApi()!.event.listen<T>(event, ({ payload }) =>
    callback(payload),
  );
}
