import { ParseError } from "./errors";

export interface Packet { type: number; clock: number; payload: Uint8Array }
export interface PacketWalk { packets: Packet[]; warnings: string[] }
export const END_MARKER = 0xffffffff;

/** Walk the decompressed stream: `u32 len, u32 type, f32 clock, payload` (docs/REPLAY_FORMAT.md §3). Zero-copy slices. */
export function walkPackets(buf: Uint8Array): PacketWalk {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const packets: Packet[] = []; const warnings: string[] = [];
  let off = 0;
  while (off + 12 <= buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), clock = dv.getFloat32(off + 8, true);
    if (off + 12 + len > buf.byteLength) throw new ParseError("Truncated", "packets", `packet at ${off} claims ${len} bytes`);
    packets.push({ type, clock, payload: buf.subarray(off + 12, off + 12 + len) });
    off += 12 + len;
    if (type === END_MARKER) break;
  }
  if (off < buf.byteLength) warnings.push(`${buf.byteLength - off} trailing bytes after the last packet`);
  return { packets, warnings };
}
