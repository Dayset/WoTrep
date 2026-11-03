import type { Track } from "@wotrep/model";
import type { Packet } from "./packets";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** 0x0A → columnar tracks in battle time, with honest visibility intervals (gap > 1.5 s = not visible). */
export function buildTracks(packets: Packet[], vehicleIds: Set<number>, t0: number): Record<number, Track> {
  const tr: Record<number, Track> = {};
  for (const p of packets) {
    if (p.type !== 0x0a || p.payload.byteLength < 44) continue;
    const dv = new DataView(p.payload.buffer, p.payload.byteOffset, p.payload.byteLength);
    const e = dv.getUint32(0, true);
    if (!vehicleIds.has(e) || dv.getUint32(4, true) !== 0) continue; // the Avatar's own packet carries the recorder's vid; skip
    const t = tr[e] ??= { t: [], x: [], z: [], y: [], yaw: [], visible: [] };
    t.t.push(r2(p.clock - t0)); t.x.push(r2(dv.getFloat32(8, true))); t.y.push(r2(dv.getFloat32(12, true)));
    t.z.push(r2(dv.getFloat32(16, true))); t.yaw.push(Math.round(dv.getFloat32(32, true) * 1000) / 1000);
  }
  for (const t of Object.values(tr)) {
    let s = t.t[0]!, prev = s;
    for (const x of t.t.slice(1)) { if (x - prev > 1.5) { t.visible.push([s, prev]); s = x; } prev = x; }
    t.visible.push([s, prev]);
  }
  return tr;
}
