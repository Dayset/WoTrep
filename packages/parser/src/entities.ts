import type { Manifest } from "@wotrep/defs";
import type { Packet } from "./packets";

export interface Call { clock: number; entity: number; kind: "avatar" | "vehicle"; name: string | null; idx: number; args: Uint8Array }
export interface EntityIndex { avatarId: number; recorderVid: number; vehicleIds: Set<number> }

const u32 = (p: Uint8Array, o: number) => new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(o, true);

/** Avatar entity = the 0x0A position packet whose attachedVehicleId ≠ 0 (docs/REPLAY_FORMAT.md §4). */
export function findAvatar(packets: Packet[], vehicleIds: Set<number>): { avatarId: number; recorderVid: number } | null {
  for (const p of packets) {
    if (p.type !== 0x0a || p.payload.byteLength < 8) continue;
    const attached = u32(p.payload, 4);
    if (attached && vehicleIds.has(attached)) return { avatarId: u32(p.payload, 0), recorderVid: attached };
  }
  return null;
}

/** Turn 0x08 entity-method packets into named calls via the manifest. Unknown methods are counted, never thrown. */
export function dispatchCalls(packets: Packet[], idx: EntityIndex, m: Manifest | null, unknown: Record<string, number>): Call[] {
  const names = (t: Record<string, { idx: number }>) => new Map(Object.entries(t).map(([n, e]) => [e.idx, n]));
  const av = m ? names(m.avatar) : new Map<number, string>(), ve = m ? names(m.vehicle) : new Map<number, string>();
  const out: Call[] = [];
  for (const p of packets) {
    if (p.type !== 0x08 || p.payload.byteLength < 12) continue;
    const entity = u32(p.payload, 0), mid = u32(p.payload, 4), len = u32(p.payload, 8);
    const kind = entity === idx.avatarId ? "avatar" : idx.vehicleIds.has(entity) ? "vehicle" : null;
    if (!kind) continue;
    const name = (kind === "avatar" ? av : ve).get(mid) ?? null;
    if (!name) { const k = `method:${kind}:${mid}`; unknown[k] = (unknown[k] ?? 0) + 1; }
    out.push({ clock: p.clock, entity, kind, name, idx: mid, args: p.payload.subarray(12, Math.min(12 + len, p.payload.byteLength)) });
  }
  return out;
}
