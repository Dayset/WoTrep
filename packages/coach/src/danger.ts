import { stateAt, type BattleTimeline } from "@wotrep/model";
import { engagements } from "./detectors/trades";
import { isRamming } from "./detectors/util";
import cfg from "../config/danger.json";

/** Danger spots for every player (docs/METRICS.md §3.15): the engagements where a player lost the most, why, and what to do instead.
 *  Mirror of good plays: same engagement rule as `bad-trade`, applied to everyone. Causes are checked in priority order. */
export type DangerCause = "alone" | "crossfire" | "early" | "outtraded";
export interface DangerSpot {
  vid: number; team: 1 | 2; tStart: number; tEnd: number; got: number; dealt: number; lossShare: number;
  cause: DangerCause; foes: number[]; nearestAllyM: number | null; died: boolean; x: number | null; z: number | null; coverage: number;
}
const v = (k: keyof typeof cfg) => cfg[k].value;

export function dangerSpots(tl: BattleTimeline): DangerSpot[] {
  const seen = new Map<number, number>(); for (const e of tl.events) if (e.k === "damage" && e.amount > 0 && !isRamming(e)) seen.set(e.attacker, (seen.get(e.attacker) ?? 0) + e.amount);
  const out: DangerSpot[] = [];
  for (const me of tl.vehicles) {
    const official = tl.results?.players[me.vid]?.damageDealt ?? 0, coverage = official > 0 ? Math.min(1, (seen.get(me.vid) ?? 0) / official) : 1;
    for (const g of engagements(tl, v("gapS"), me.vid)) {
      if (!(g.got >= v("minLossShare") * me.maxHealth && g.dealt / g.got < v("maxRatio"))) continue;
      const s = stateAt(tl, g.t0), u = s.units.find((x) => x.vid === me.vid), known = !!u && u.known !== "never";
      const allies = s.units.filter((x) => x.team === me.team && x.vid !== me.vid && x.alive && x.known !== "never");
      const nearest = known && allies.length ? Math.min(...allies.map((a) => Math.hypot(a.x - u!.x, a.z - u!.z))) : null;
      const cause: DangerCause = nearest != null && nearest > v("allyDistM") ? "alone" : g.foes.length >= v("crossfireFoes") ? "crossfire" : g.t0 < v("earlyS") ? "early" : "outtraded";
      const died = tl.events.some((e) => e.k === "kill" && e.victim === me.vid && e.t >= g.t0 && e.t <= g.t1 + 3);
      out.push({ vid: me.vid, team: me.team as 1 | 2, tStart: g.t0, tEnd: g.t1, got: g.got, dealt: g.dealt, lossShare: Math.round((g.got / me.maxHealth) * 100) / 100, cause, foes: g.foes, nearestAllyM: nearest == null ? null : Math.round(nearest), died, x: known ? Math.round(u!.x) : null, z: known ? Math.round(u!.z) : null, coverage });
    }
  }
  return out.sort((a, b) => a.tStart - b.tStart);
}
