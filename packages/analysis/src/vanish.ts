import { stateAt, type BattleTimeline } from "@wotrep/model";
import cfg from "../config/vanish-v0.json";

/** Vanish events (docs/METRICS.md §3.17): an enemy of the recorder leaves the recorder team's vision while alive. A vanish is a clue to cover or a
 *  line-of-sight break, not proof (camouflage, range, a dead spotter and smoke look the same). Only the recorder's team is a known spotter set. */
export interface Vanish { t: number; vid: number; x: number; z: number; spotter: number | null; spotterM: number | null; speed: number; stopped: boolean }
const c = (k: keyof typeof cfg) => cfg[k].value;

export function vanishEvents(tl: BattleTimeline): Vanish[] {
  const rec = tl.recorder.team, killT = new Map<number, number>(); for (const e of tl.events) if (e.k === "kill") killT.set(e.victim, e.t);
  const out: Vanish[] = [];
  for (const v of tl.vehicles) {
    if (v.team === rec) continue; const tr = tl.tracks[v.vid]; if (!tr) continue;
    for (const [a, b] of tr.visible) {
      if (b - a < c("minVisibleS")) continue; const kt = killT.get(v.vid); if (kt != null && Math.abs(kt - b) <= c("deathGapS")) continue; if (b >= (tl.arena.durationS ?? Infinity) - 1) continue;
      const before = stateAt(tl, Math.max(a, b - 0.5)), after = stateAt(tl, Math.max(a, b - 3)), u = before.units.find((x) => x.vid === v.vid), w = after.units.find((x) => x.vid === v.vid);
      if (!u || u.known === "never") continue;
      const sp = before.units.filter((x) => x.team === rec && x.alive && x.known !== "never").map((x) => ({ vid: x.vid, d: Math.hypot(x.x - u.x, x.z - u.z) })).filter((x) => x.d >= c("minSpotterM") && x.d <= c("maxSpotterM")).sort((p, q) => p.d - q.d)[0];
      const speed = w && w.known !== "never" ? Math.hypot(u.x - w.x, u.z - w.z) / Math.max(0.5, Math.min(3, b - a)) : 0;
      out.push({ t: Math.round(b * 10) / 10, vid: v.vid, x: Math.round(u.x), z: Math.round(u.z), spotter: sp?.vid ?? null, spotterM: sp ? Math.round(sp.d) : null, speed: Math.round(speed * 10) / 10, stopped: speed < c("stillMps") });
    }
  }
  return out.sort((x, y) => x.t - y.t);
}
