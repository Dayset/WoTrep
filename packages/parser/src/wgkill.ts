import type { BattleEvent } from "@wotrep/model";
import type { Packet } from "./packets";

/** Kill records inside 0x37 packets (Wargaming 2.4.x; docs/REPLAY_FORMAT.md). Layout found by comparing 203 deaths over 8 replays with the results block:
 *  `78 01 <victim u32> <killer u32> <reason u8> ...` (u32 little endian = vehicle entity id; killer and reason matched the results 203/203, and the
 *  number of distinct victims equalled the number of deaths in the results in 7 of 8 replays). The same record can be repeated in later packets,
 *  so the earliest one per victim wins. Untrusted bytes: nothing is read outside the packet, ids must be known vehicles. */
export function killsFromPackets(packets: Packet[], vehicleIds: Set<number>, T0: number): BattleEvent[] {
  const seen = new Map<number, BattleEvent>();
  for (const p of packets) {
    if (p.type !== 0x37) continue;
    const b = p.payload, d = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let o = 0; o + 11 <= b.length; o++) {
      if (b[o] !== 0x78 || b[o + 1] !== 0x01) continue;
      const victim = d.getUint32(o + 2, true), killer = d.getUint32(o + 6, true);
      if (!vehicleIds.has(victim) || !vehicleIds.has(killer) || seen.has(victim)) continue;
      seen.set(victim, { k: "kill", t: Math.round((p.clock - T0) * 100) / 100, victim, killer, reason: b[o + 10]!, equipment: 0 });
    }
  }
  return [...seen.values()].filter((e) => e.t >= 0).sort((a, b) => a.t - b.t);
}
