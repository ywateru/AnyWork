import { describe, expect, it, vi } from "vitest";
import type { OverlayTcp } from "./cyberbus";
import { OverlayFrameChannel } from "./overlayChannel";

function channel(chunks: Uint8Array[]) {
  const reads = chunks.map((data) => ({ data, eof: false }));
  const overlay = {
    read: vi.fn(
      async () => reads.shift() ?? { data: new Uint8Array(), eof: true },
    ),
    writeAll: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  return {
    overlay,
    frames: new OverlayFrameChannel(overlay as unknown as OverlayTcp),
  };
}

function frame(bytes: number[]) {
  const output = new Uint8Array(bytes.length + 4);
  new DataView(output.buffer).setUint32(0, bytes.length, false);
  output.set(bytes, 4);
  return output;
}

describe("overlay length-prefixed frames", () => {
  it("accepts split prefix/payload and coalesced frames without losing bytes", async () => {
    const first = frame([1, 2, 3]),
      second = frame([4, 5]);
    const joined = new Uint8Array(first.length + second.length);
    joined.set(first);
    joined.set(second, first.length);
    const { frames } = channel([
      joined.subarray(0, 2),
      joined.subarray(2, 7),
      joined.subarray(7),
    ]);
    await expect(frames.readFrame()).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await expect(frames.readFrame()).resolves.toEqual(new Uint8Array([4, 5]));
  });

  it.each([0, 65536])("rejects frame length %i", async (length) => {
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, length, false);
    const { frames } = channel([prefix]);
    await expect(frames.readFrame()).rejects.toMatchObject({
      code: "INVALID_FRAME",
    });
  });

  it("writes exactly one prefix and payload and closes idempotently", async () => {
    const { overlay, frames } = channel([]);
    await frames.writeFrame(new Uint8Array([9, 8, 7]));
    expect(overlay.writeAll.mock.calls).toEqual([
      [new Uint8Array([0, 0, 0, 3])],
      [new Uint8Array([9, 8, 7])],
    ]);
    await frames.close();
    await frames.close();
    expect(overlay.close).toHaveBeenCalledOnce();
  });

  it("maps EOF and malformed empty frames to connection errors", async () => {
    const { frames } = channel([]);
    await expect(frames.readFrame()).rejects.toMatchObject({
      code: "CONNECTION_CLOSED",
    });
    const malformed = channel([new Uint8Array([0, 0, 0, 0])]);
    await expect(malformed.frames.readFrame()).rejects.toMatchObject({
      code: "INVALID_FRAME",
    });
  });
});
