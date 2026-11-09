import { stateAt, type BattleTimeline } from "@wotrep/model";
import { estimateReload, reloadStateAt } from "./reload";
import cfg from "../config/blocking-v0.json";

/** Teammate line-of-fire blocks per player (docs/METRICS.md §3.21). One sample per battle second.
 *  A teammate T has a clean shot at an enemy E when E is spotted (live-visible) within rangeM, T's reload
 *  state is known and not reloading (ready or bursting; players with no usable estimate contribute no
 *  opportunities), and no enemy other than E damaged T in the last engageWindowS. A teammate B blocks that
 *  shot when B is alive and stands within blockRM of the segment T->E, strictly between them.
 *  "Line of view" is spotted + in range: the replay knows an enemy is spotted by the team, not that T
 *  personally sees them, and there is no cover data, so "in range" is geometric. Compare within a team only,
 *  since enemy positions are known only while spotted. */
export interface Blocking {
  vid: number; team: 1 | 2;
  /** seconds alive while at least one teammate had a clean-shot opportunity */
  oppS: number;
  /** seconds standing in the way of at least one teammate's clean shot */
  blockedS: number;
  /** blocked (shooter, target) pairs across all samples; one sample can hold several */
  blockedPairs: number;
  /** blockedS / oppS; null when no teammate ever had a clean shot while this player was alive */
  rate: number | null;
}
export interface BlockingSummary { players: Blocking[] }

const c = (k: keyof typeof cfg) => cfg[k].value;

export function blocking(tl: BattleTimeline, endS?: number): BlockingSummary {
  const end = Math.floor(endS ?? tl.arena.durationS ?? 0);
  const R = c("rangeM"), BR = c("blockRM"), W = c("engageWindowS");
  const teamOf = new Map(tl.vehicles.map((v) => [v.vid, v.team]));
  const shots = new Map<number, number[]>();
  for (const e of tl.events) if (e.k === "shot") (shots.get(e.shooter) ?? shots.set(e.shooter, []).get(e.shooter)!).push(e.t);
  const est = new Map<number, ReturnType<typeof estimateReload>>();
  for (const [vid, ts] of shots) est.set(vid, estimateReload(ts));
  const dmg = new Map<number, { t: number; attacker: number }[]>();
  for (const e of tl.events) if (e.k === "damage") (dmg.get(e.target) ?? dmg.set(e.target, []).get(e.target)!).push({ t: e.t, attacker: e.attacker });
  for (const a of dmg.values()) a.sort((x, y) => x.t - y.t);
  const acc = new Map(tl.vehicles.map((v) => [v.vid, { opp: 0, blocked: 0, pairs: 0 }]));
  for (let t = 0; t <= end; t++) {
    const live = stateAt(tl, t).units.filter((u) => u.alive && u.known === "live");
    const opp = new Set<number>(), blocked = new Set<number>(), pairs = new Map<number, number>();
    for (const T of live) {
      const e = est.get(T.vid);
      const st = e == null ? "unknown" : reloadStateAt(shots.get(T.vid) ?? [], e, t).state;
      if (st !== "ready" && st !== "bursting") continue;
      const engaging = new Set<number>();
      for (const d of dmg.get(T.vid) ?? []) {
        if (d.t > t - W && d.t <= t) { const at = teamOf.get(d.attacker); if (at !== undefined && at !== T.team) engaging.add(d.attacker); }
      }
      for (const E of live) {
        if (E.team === T.team) continue;
        const dx = E.x - T.x, dz = E.z - T.z, dist = Math.hypot(dx, dz);
        if (dist > R || dist < 1e-6) continue;
        if ([...engaging].some((a) => a !== E.vid)) continue;
        for (const B of live) {
          if (B.team !== T.team || B.vid === T.vid) continue;
          opp.add(B.vid);
          const f = ((B.x - T.x) * dx + (B.z - T.z) * dz) / (dist * dist);
          if (f <= 0 || f >= 1) continue;
          const perp = Math.hypot(B.x - (T.x + f * dx), B.z - (T.z + f * dz));
          if (perp <= BR) { blocked.add(B.vid); pairs.set(B.vid, (pairs.get(B.vid) ?? 0) + 1); }
        }
      }
    }
    for (const vid of opp) acc.get(vid)!.opp++;
    for (const vid of blocked) acc.get(vid)!.blocked++;
    for (const [vid, n] of pairs) acc.get(vid)!.pairs += n;
  }
  return {
    players: tl.vehicles.map((v) => {
      const a = acc.get(v.vid)!;
      return { vid: v.vid, team: v.team, oppS: a.opp, blockedS: a.blocked, blockedPairs: a.pairs, rate: a.opp > 0 ? Math.round((a.blocked / a.opp) * 100) / 100 : null };
    }),
  };
}
