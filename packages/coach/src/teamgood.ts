import type { BattleTimeline } from "@wotrep/model";
import { engagements } from "./detectors/trades";
import wonCfg from "../config/won-trade.json";
import tgCfg from "../config/team-good.json";

/** Good plays for every player, and who made them possible (docs/METRICS.md §3.11).
 *  A good play = a won trade (same rule as the `won-trade` detector, same thresholds) by any player.
 *  Enabled-by: how much of the enemy fire that the play faced was absorbed by teammates (damage the same enemies dealt to teammates in the
 *  `lookbackS` before and during it) and which teammates those enemies destroyed. Luck cannot be separated yet (needs gun data, #42). */
export type Enabled = "carried" | "shared" | "solo";
export interface GoodPlay {
  vid: number; team: 1 | 2; tStart: number; tEnd: number; dealt: number; got: number; wpDelta: number;
  absorbedHp: number; sacrificed: number[]; enabledShare: number; enabled: Enabled;
  /** Share of the player's own damage that the replay reports; plays by players we see less of are less certain. */
  coverage: number;
}
export interface Alignment { team: 1 | 2; plays: number; aligned: number; share: number | null }

const LOOKBACK_S = tgCfg.lookbackS.value, ALIGN_S = tgCfg.alignS.value, MIN_ABSORB_SHARE = tgCfg.minAbsorbShare.value;
const cfgv = (k: string) => (wonCfg as Record<string, { value: number }>)[k]!.value;

export function goodPlaysAll(tl: BattleTimeline): GoodPlay[] {
  const team = new Map(tl.vehicles.map((v) => [v.vid, v.team]));
  const seen = new Map<number, number>(); for (const e of tl.events) if (e.k === "damage" && e.amount > 0 && team.get(e.attacker) !== team.get(e.target)) seen.set(e.attacker, (seen.get(e.attacker) ?? 0) + e.amount);
  const out: GoodPlay[] = [];
  for (const v of tl.vehicles) {
    const official = tl.results?.players[v.vid]?.damageDealt ?? 0, coverage = official > 0 ? Math.min(1, (seen.get(v.vid) ?? 0) / official) : 1;
    const mates = new Set(tl.vehicles.filter((m) => m.team === v.team && m.vid !== v.vid).map((m) => m.vid));
    for (const g of engagements(tl, cfgv("gapS"), v.vid)) {
      if (!(g.dealt >= cfgv("minDealtShare") * v.maxHealth && g.dealt >= cfgv("minRatio") * Math.max(g.got, 1))) continue;
      const foes = new Set(g.foes), a = g.t0 - LOOKBACK_S, b = g.t1 + 1;
      const absorbed = tl.events.reduce((s, e) => (e.k === "damage" && e.amount > 0 && e.t >= a && e.t <= b && foes.has(e.attacker) && mates.has(e.target) ? s + e.amount : s), 0);
      const sacrificed = [...new Set(tl.events.flatMap((e) => (e.k === "kill" && e.t >= g.t0 - 20 && e.t <= g.t1 + 3 && mates.has(e.victim) && foes.has(e.killer) ? [e.victim] : [])))];
      const share = absorbed / Math.max(1, absorbed + g.got);
      out.push({ vid: v.vid, team: v.team as 1 | 2, tStart: g.t0, tEnd: g.t1, dealt: g.dealt, got: g.got, wpDelta: g.wp, absorbedHp: absorbed, sacrificed, enabledShare: Math.round(share * 100) / 100, enabled: sacrificed.length > 0 || share >= MIN_ABSORB_SHARE ? "carried" : absorbed > 0 ? "shared" : "solo", coverage: Math.round(coverage * 100) / 100 });
    }
  }
  return out.sort((x, y) => x.tStart - y.tStart);
}

/** Team alignment: share of a team's good plays that overlap (within 10 s) with a good play by a different teammate. */
export function alignment(plays: GoodPlay[], team: 1 | 2): Alignment {
  const mine = plays.filter((p) => p.team === team);
  const aligned = mine.filter((p) => mine.some((q) => q.vid !== p.vid && q.tStart <= p.tEnd + ALIGN_S && q.tEnd >= p.tStart - ALIGN_S)).length;
  return { team, plays: mine.length, aligned, share: mine.length >= 2 ? Math.round((aligned / mine.length) * 100) / 100 : null };
}
