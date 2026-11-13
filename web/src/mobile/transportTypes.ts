/** Public mobile IPC DTOs. No credential or arbitrary endpoint fields. */
export const TRANSPORT_CHUNK = 32_768;
export const TRANSPORT_MAX_BODY = 22 * 1024 * 1024;
export const TRANSPORT_CLOSED_EVENT = "mobile-transport-closed";
export interface ConnectionRef { connectionId: string; generation: number }
export interface ConnectionInfo extends ConnectionRef { scopeId: string }
export interface OperationRef { connection: ConnectionRef; operationId: string }
export interface ConnectRequest {
  deviceRef: string;
  expectedEpoch: number;
  expectedRevision: number;
  keyConfirmation?: string; // Exact displayed base64url public key; native revalidates its snapshot.
}
export interface ResponseHead { status: number; contentType?: string | null; size: number }
export interface ResponseChunk { base64: string; done: boolean }
export type Delivery = "not_sent" | "outcome_unknown" | "response_complete";
export interface TransportFailure { code: string; delivery: Delivery }
export type PtyEvent = OperationRef & { sequence: number } & (
  | { type: "ready" }
  | { type: "data"; base64: string }
  | { type: "closed"; code?: string }
);
export interface ConnectionEnded { code: string }
export interface ClosedEvent { connection: ConnectionRef; code: string }
export interface PublicChannel<T> { onmessage: (event: T) => void }
export interface PublicTauri {
  core: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    Channel: new <T>() => PublicChannel<T>;
  };
  event: {
    listen<T>(name: string, handler: (event: { payload: T }) => void): Promise<() => void>;
  };
}
export function publicTauri(): PublicTauri {
  const api = (window as unknown as { __TAURI__?: PublicTauri }).__TAURI__;
  if (!api?.core?.invoke || !api.core.Channel || !api.event?.listen)
    throw new Error("NATIVE_TRANSPORT_UNAVAILABLE");
  return api;
}
