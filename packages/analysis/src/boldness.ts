import { stateAt, type BattleTimeline, type Team } from "@wotrep/model";
import { wpOf } from "./wp";
import { estimateReload, reloadStateAt, shotTimes } from "./reload";
import cfgRaw from "../config/boldness-v0.json";

const cfg = Object.fromEntries(Object.entries(cfgRaw).map(([k, v]) => [k, v.value])) as Record<keyof typeof cfgRaw, number>;

/** Boldness v0 — docs/METRICS.md §3.7. How often a player took the chance to fight when one was there.
 *  An *opening* is a second in which the player is alive and visible, an enemy is visible within `engageRangeM`, the game is
 *  not already decided (own win probability < maxWp) and the player's gun is not known to be reloading. Consecutive
 *  openings form an *episode*; it is *taken* if the player fired within `windowS` of it. rate = taken / episodes. */
export interface Boldness { vid: number; episodes: number; taken: number; rate: number | null; openSeconds: number }

export function boldnessAll(tl: BattleTimeline): Map<number, Boldness> {
  const end = Math.floor(tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0);
  const shots = new Map(tl.vehicles.map((v) => [v.vid, shotTimes(tl, v.vid)]));
  const est = new Map(tl.vehicles.map((v) => [v.vid, estimateReload(shots.get(v.vid)!)]));
  const open = new Map<number, number[]>(tl.vehicles.map((v) => [v.vid, []]));
  for (let t = 0; t <= end; t++) {
    const s = stateAt(tl, t), wp = { 1: wpOf(s, 1), 2: wpOf(s, 2) } as Record<Team, number>;
    for (const u of s.units) {
      if (!u.alive || u.known !== "live" || wp[u.team] >= cfg.maxWp) continue;
      let near = false;
      for (const e of s.units) if (e.team !== u.team && e.alive && e.known === "live" && Math.hypot(e.x - u.x, e.z - u.z) <= cfg.engageRangeM) { near = true; break; }
      if (!near) continue;
      const es = est.get(u.vid)!, st = reloadStateAt(shots.get(u.vid)!, es, t);
      if (st.state === "reloading" && st.confidence >= cfg.minReloadConfidence) continue;
      open.get(u.vid)!.push(t);
    }
  }
  const out = new Map<number, Boldness>();
  for (const v of tl.vehicles) {
    const secs = open.get(v.vid)!, sh = shots.get(v.vid)!, eps: [number, number][] = [];
    for (const t of secs) { const last = eps.at(-1); if (last && t - last[1] <= cfg.gapS) last[1] = t; else eps.push([t, t]); }
    const taken = eps.filter(([a, b]) => sh.some((x) => x >= a && x <= b + cfg.windowS)).length;
    out.set(v.vid, { vid: v.vid, episodes: eps.length, taken, rate: eps.length >= cfg.minEpisodes ? taken / eps.length : null, openSeconds: secs.length });
  }
  return out;
}
