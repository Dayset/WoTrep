import { stateAt, type BattleTimeline, type Team } from "@wotrep/model";
import { wpOf } from "./wp";
import { playerHeuristics } from "./heuristics";
import { estimateReload, reloadStateAt, shotTimes } from "./reload";
import cfgRaw from "../config/boldness-v0.json";

const cfg = Object.fromEntries(Object.entries(cfgRaw).map(([k, v]) => [k, v.value])) as Record<keyof typeof cfgRaw, number>;

/** Boldness v0 — docs/METRICS.md §3.7. How often a player took the chance to fight when one was there.
 *  An *opening* is a second in which the player is alive and visible, an enemy is visible within `engageRangeM`, the game is
 *  not already decided (own win probability < maxWp) and the player's gun is not known to be reloading. Consecutive
 *  openings form an *episode*; it is *taken* if the player fired within `windowS` of it. rate = taken / episodes. */
export type BoldStyle = "safe" | "balanced" | "bold-rewarded" | "bold-costly";
export interface Boldness {
  vid: number; episodes: number; taken: number; rate: number | null; openSeconds: number;
  /** v1: how the taken chances went (see METRICS.md §3.7). rewarded + costly + flat = taken. */
  rewarded: number; costly: number; flat: number;
  rewardedShare: number | null; costlyShare: number | null; style: BoldStyle | null;
}

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
    const takenEps = eps.filter(([a, b]) => sh.some((x) => x >= a && x <= b + cfg.windowS));
    const hits = playerHeuristics(tl, v.vid)?.hits ?? [];
    const lossEvents = tl.events.flatMap((e) => (e.k === "damage" && e.target === v.vid && e.amount > 0 ? [e] : []));
    const kills = tl.events.flatMap((e) => (e.k === "kill" && e.killer === v.vid ? [e.t] : []));
    let rewarded = 0, costly = 0;
    for (const [a, b] of takenEps) {
      const hi = b + cfg.windowS;
      const dealt = hits.filter((h) => h.t >= a && h.t <= hi).reduce((s, h) => s + h.amount * h.threat, 0);
      const lost = lossEvents.filter((e) => e.t >= a && e.t <= hi).reduce((s, e) => s + e.amount, 0);
      const killed = kills.some((t) => t >= a && t <= hi);
      if (lost >= cfg.minLossShare * v.maxHealth && dealt < cfg.rewardRatio * lost && !killed) costly++;
      else if (dealt > 0 && dealt >= cfg.rewardRatio * lost) rewarded++;
      else if (killed) rewarded++;
    }
    const taken = takenEps.length, rate = eps.length >= cfg.minEpisodes ? taken / eps.length : null;
    const judged = rate != null && taken >= cfg.minTaken;
    const rs = judged ? rewarded / taken : null, cs = judged ? costly / taken : null;
    const style: BoldStyle | null = rate == null ? null : rate < cfg.safeBelow ? "safe" : cs != null && cs >= cfg.costlyShare ? "bold-costly" : rate >= cfg.boldFrom && rs != null && rs >= cfg.rewardedShare ? "bold-rewarded" : "balanced";
    out.set(v.vid, { vid: v.vid, episodes: eps.length, taken, rate, openSeconds: secs.length, rewarded, costly, flat: taken - rewarded - costly, rewardedShare: rs, costlyShare: cs, style });
  }
  return out;
}
