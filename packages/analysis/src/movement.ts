import { stateAt, type BattleTimeline } from "@wotrep/model";
import cfg from "../config/movement-v0.json";

/** Movement, exposure and reaction per player (docs/METRICS.md §3.16). One sample per battle second.
 *  Positions of enemies are known only while spotted, so for the recorder's team the hostile counts are lower bounds. */
export interface Movement {
  vid: number; team: 1 | 2; seenS: number; mPerMin: number | null; stillShare: number | null;
  /** seconds with at least `multi` hostile tanks within range */
  multiS: number; multiShare: number | null; peakHostiles: number;
  /** median seconds from a new contact to the player's first shot; null if no contact led to a shot */
  acquireS: number | null; contacts: number;
}
export interface MovementSummary { players: Movement[]; medians: Record<1 | 2, { mPerMin: number | null; stillShare: number | null; multiShare: number | null; acquireS: number | null }> }
const c = (k: keyof typeof cfg) => cfg[k].value;
const med = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export function movement(tl: BattleTimeline, endS?: number): MovementSummary {
  const end = Math.floor(endS ?? tl.arena.durationS ?? 0), R = c("rangeM");
  const shots = new Map<number, number[]>(); for (const e of tl.events) if (e.k === "shot" && e.t >= 0) (shots.get(e.shooter) ?? shots.set(e.shooter, []).get(e.shooter)!).push(e.t);
  const acc = new Map(tl.vehicles.map((v) => [v.vid, { seen: 0, moved: 0, still: 0, multi: 0, peak: 0, lastIn: -1e9, inRange: false, contactT: null as number | null, acq: [] as number[], contacts: 0, px: NaN, pz: NaN }]));
  for (let t = 0; t <= end; t++) {
    const s = stateAt(tl, t);
    for (const u of s.units) {
      const a = acc.get(u.vid)!; if (!u.alive || u.known !== "live") { a.px = NaN; continue; }
      a.seen++; if (!Number.isNaN(a.px)) { const d = Math.hypot(u.x - a.px, u.z - a.pz); a.moved += d; if (d < c("stillMps")) a.still++; } a.px = u.x; a.pz = u.z;
      const n = s.units.filter((o) => o.team !== u.team && o.alive && o.known === "live" && Math.hypot(o.x - u.x, o.z - u.z) <= R).length;
      a.peak = Math.max(a.peak, n); if (n >= c("multi")) a.multi++;
      if (n > 0) { if (!a.inRange && t - a.lastIn >= c("quietS")) { a.contactT = t; a.contacts++; const f = (shots.get(u.vid) ?? []).find((x) => x >= t); if (f != null && f - t <= c("acquireMaxS")) a.acq.push(f - t); } a.inRange = true; a.lastIn = t; } else a.inRange = false;
    }
  }
  const players: Movement[] = tl.vehicles.map((v) => { const a = acc.get(v.vid)!; return { vid: v.vid, team: v.team as 1 | 2, seenS: a.seen, mPerMin: a.seen >= 20 ? Math.round((a.moved / a.seen) * 60) : null, stillShare: a.seen >= 20 ? Math.round((a.still / a.seen) * 100) / 100 : null, multiS: a.multi, multiShare: a.seen >= 20 ? Math.round((a.multi / a.seen) * 100) / 100 : null, peakHostiles: a.peak, acquireS: med(a.acq) == null ? null : Math.round(med(a.acq)! * 10) / 10, contacts: a.contacts }; });
  const m = (team: 1 | 2, k: "mPerMin" | "stillShare" | "multiShare" | "acquireS") => med(players.filter((p) => p.team === team && p[k] != null).map((p) => p[k] as number));
  return { players, medians: { 1: { mPerMin: m(1, "mPerMin"), stillShare: m(1, "stillShare"), multiShare: m(1, "multiShare"), acquireS: m(1, "acquireS") }, 2: { mPerMin: m(2, "mPerMin"), stillShare: m(2, "stillShare"), multiShare: m(2, "multiShare"), acquireS: m(2, "acquireS") } } };
}
