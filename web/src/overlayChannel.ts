import type { OverlayTcp } from "./cyberbus";
import { RemoteError, type RemoteChannel } from "./remoteTransport";

const MAX_FRAME = 65_535;

function append(left: Uint8Array, right: Uint8Array) {
  const output = new Uint8Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
}

/** Persistent prefix decoder: a cancelled consumer cannot lose a half frame. */
export class OverlayFrameChannel implements RemoteChannel {
  private buffer = new Uint8Array();
  private closed = false;
  constructor(private readonly overlay: OverlayTcp) {}
  async readFrame(): Promise<Uint8Array> {
    for (;;) {
      if (this.closed) throw new RemoteError("CONNECTION_CLOSED");
      if (this.buffer.length >= 4) {
        const length = new DataView(
          this.buffer.buffer,
          this.buffer.byteOffset,
          4,
        ).getUint32(0, false);
        if (length === 0 || length > MAX_FRAME)
          throw new RemoteError("INVALID_FRAME");
        if (this.buffer.length >= length + 4) {
          const frame = this.buffer.slice(4, length + 4);
          this.buffer = this.buffer.slice(length + 4);
          return frame;
        }
      }
      let result: { data: Uint8Array; eof: boolean };
      try {
        result = await this.overlay.read();
      } catch {
        throw new RemoteError("CONNECTION_CLOSED");
      }
      if (result.data.length) {
        this.buffer = append(this.buffer, result.data);
        if (this.buffer.length > MAX_FRAME * 2 + 8)
          throw new RemoteError("INVALID_FRAME");
      }
      if (result.eof) throw new RemoteError("CONNECTION_CLOSED");
    }
  }
  async writeFrame(bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new RemoteError("CONNECTION_CLOSED");
    if (bytes.length === 0 || bytes.length > MAX_FRAME)
      throw new RemoteError("INVALID_FRAME");
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, bytes.length, false);
    try {
      await this.overlay.writeAll(prefix);
      await this.overlay.writeAll(bytes);
    } catch {
      throw new RemoteError("CONNECTION_CLOSED");
    }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.overlay.close().catch(() => {});
  }
}
