import { stateAt, type BattleTimeline, type Snapshot, type Team } from "@wotrep/model";
import cfg from "../config/wp-v0.json";

/** Win probability v0 (docs/METRICS.md §3.1): Lanchester square-law material, logistic. Fog caveat: enemy HP is only known
 *  where the recorder saw damage events; otherwise full HP is assumed. Kills are global, so alive counts are exact.
 *  Gap vs §3.1: the specified b·capPressure + c·timeLeftTerm are NOT implemented — METRICS states no formula for either
 *  term, and the fixture has no capture events, so cap pressure is untestable here (see #63). Strength also omits DPM
 *  (needs gun data, #42); with HP-only strength the model still satisfies the §3.1 acceptance curve on the fixture. */
export function wpOf(s: Snapshot, team: Team): number {
  const str = (tm: Team) => { let a = 0; for (const u of s.units) if (u.team === tm && u.alive) a += Math.sqrt(Math.max(u.hp, 1)); return a * a; };
  const own = str(team), enemy = str(team === 1 ? 2 : 1);
  if (own === 0) return 0; if (enemy === 0) return 1;
  return 1 / (1 + Math.exp(-cfg.a.value * Math.log(own / enemy)));
}
export const wpSeries = (tl: BattleTimeline, team: Team, step = 1): { t: number[]; wp: number[] } => {
  const end = tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0; const t: number[] = [], wp: number[] = [];
  for (let x = 0; x <= end; x += step) { t.push(x); wp.push(wpOf(stateAt(tl, x), team)); }
  return { t, wp };
};
