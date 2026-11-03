import type { BattleTimeline } from "@wotrep/model";

/** Per-second running curves for one vehicle, built only from observed events (METRICS.md §3.9).
 *  Index i = battle second i. Values are "so far at the end of second i". */
export interface Series {
  vid: number;
  dmg: number[];      // cumulative damage dealt to enemies (observed hits)
  dpm: number[];      // dmg ÷ minutes of battle elapsed (or of life, once dead)
  shots: number[];    // cumulative shots fired
  hitRate: (number | null)[]; // damaging hits ÷ shots so far; null before the 3rd shot
  /** Final values from the event stream next to the official ones, so the UI can show how complete the curves are. */
  finalDmg: number; officialDmg: number | null; finalShots: number; officialShots: number | null;
}

export function seriesFor(tl: BattleTimeline, vid: number): Series {
  const end = Math.max(1, Math.ceil(tl.arena.durationS ?? Math.max(...tl.events.map((e) => e.t), 1)));
  const team = new Map(tl.vehicles.map((v) => [v.vid, v.team]));
  const mine = team.get(vid);
  const dmgAt = new Array<number>(end + 1).fill(0), shotAt = new Array<number>(end + 1).fill(0), hitAt = new Array<number>(end + 1).fill(0);
  let death = end;
  for (const e of tl.events) {
    const i = Math.min(end, Math.max(0, Math.ceil(e.t)));
    if (e.k === "shot" && e.shooter === vid) shotAt[i]!++;
    else if (e.k === "damage") {
      if (e.attacker === vid && team.get(e.target) !== mine && e.amount > 0) { dmgAt[i]! += e.amount; hitAt[i]!++; }
      if (e.target === vid && e.hpAfter <= 0) death = Math.min(death, e.t);
    }
  }
  const dmg: number[] = [], dpm: number[] = [], shots: number[] = [], hitRate: (number | null)[] = [];
  let d = 0, s = 0, h = 0;
  for (let i = 0; i <= end; i++) {
    d += dmgAt[i]!; s += shotAt[i]!; h += hitAt[i]!;
    dmg.push(d); shots.push(s); dpm.push(i > 0 ? d / (Math.min(i, death) / 60) : 0); hitRate.push(s >= 3 ? Math.min(1, h / s) : null);
  }
  const r = tl.results?.players[vid];
  return { vid, dmg, dpm, shots, hitRate, finalDmg: d, officialDmg: r?.damageDealt ?? null, finalShots: s, officialShots: r?.shots ?? null };
}
