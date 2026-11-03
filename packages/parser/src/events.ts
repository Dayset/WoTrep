import { unzlibSync } from "fflate";
import type { BattleEvent } from "@wotrep/model";
import type { Manifest } from "@wotrep/defs";
import type { Call } from "./entities";
import { readBwString, unpickle } from "./pickle";
import type { Packet } from "./packets";

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface Decoded { events: BattleEvent[]; t0: number | null }

function updateArena(a: Uint8Array): { type: number; value: any } | null {
  try {
    const [s] = readBwString(a, 1);
    return { type: a[0]!, value: unpickle(s[0] === 0x78 ? unzlibSync(s) : s) };
  } catch { return null; }
}

/** First pass: find battle start (arena period 3). Everything else is converted to battle time. */
export function findBattleStart(calls: Call[], m: Manifest): number | null {
  const PERIOD = m.arenaUpdateTypes.period;
  for (const c of calls) {
    if (c.name !== "updateArena") continue;
    const u = updateArena(c.args);
    if (u && u.type === PERIOD && Array.isArray(u.value) && u.value[0] === 3) return c.clock;
  }
  return null;
}

export function decodeEvents(calls: Call[], m: Manifest, t0: number): BattleEvent[] {
  const ev: BattleEvent[] = []; const T = (c: number) => r2(c - t0);
  ev.push({ k: "period", t: 0, period: 3, lengthS: 900 });
  for (const c of calls) {
    const dv = new DataView(c.args.buffer, c.args.byteOffset, c.args.byteLength);
    switch (c.name) {
      case "onHealthChanged": if (c.args.byteLength >= 9) {
        const nh = dv.getInt16(0, true), oh = dv.getInt16(2, true);
        ev.push({ k: "damage", t: T(c.clock), target: c.entity, attacker: dv.getUint32(4, true), amount: oh - Math.max(nh, 0), hpBefore: oh, hpAfter: Math.max(nh, 0), reason: c.args[8]! });
      } break;
      case "showTracer": if (c.args.byteLength >= 8) ev.push({ k: "shot", t: T(c.clock), shooter: dv.getUint32(0, true), shotId: dv.getUint32(4, true) }); break;
      case "stopTracer": if (c.args.byteLength >= 16) ev.push({ k: "projectileEnd", t: T(c.clock), shotId: dv.getUint32(0, true), x: dv.getFloat32(4, true), y: dv.getFloat32(8, true), z: dv.getFloat32(12, true) }); break;
      case "updateArena": {
        const u = updateArena(c.args);
        if (u && u.type === m.arenaUpdateTypes.vehicleKilled && Array.isArray(u.value))
          ev.push({ k: "kill", t: T(c.clock), victim: u.value[0], killer: u.value[1], equipment: u.value[2], reason: u.value[3] });
      } break;
    }
  }
  return ev;
}

const stripTags = (h: string) => h.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\0/g, "").trim();
export function decodeChat(packets: Packet[], t0: number): BattleEvent[] {
  const out: BattleEvent[] = [];
  for (const p of packets) if (p.type === 0x23 && p.payload.byteLength > 4) {
    const text = stripTags(new TextDecoder().decode(p.payload.subarray(4)));
    const i = text.indexOf(" : "); const j = text.indexOf(": ");
    const cut = i >= 0 ? i : j;
    out.push({ k: "chat", t: r2(p.clock - t0), team: "all", ...(cut > 0 ? { sender: text.slice(0, cut) } : {}), text: cut > 0 ? text.slice(cut + (i >= 0 ? 3 : 2)) : text });
  }
  return out;
}

export function decodeCamera(packets: Packet[], t0: number): { t: number[]; mode: string[] } {
  const t: number[] = [], mode: string[] = [];
  for (const p of packets) if (p.type === 0x1b && p.payload.byteLength >= 4) {
    const dv = new DataView(p.payload.buffer, p.payload.byteOffset, p.payload.byteLength); const n = dv.getUint32(0, true);
    t.push(r2(p.clock - t0)); mode.push(new TextDecoder().decode(p.payload.subarray(4, 4 + n)));
  }
  return { t, mode };
}
