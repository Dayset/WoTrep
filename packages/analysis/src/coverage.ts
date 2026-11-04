import type { BattleTimeline } from "@wotrep/model";

/** How complete the replay data is (METRICS §3.14). Everything we show is only as good as this. */
export interface Coverage {
  damage: number | null;      // hits the replay reports ÷ official damage, all players
  shots: number | null;       // shot events ÷ official shots, all players (can exceed 1: see FINDINGS)
  ownSeen: number | null;     // share of alive seconds with a known position, own team
  enemySeen: number | null;   // same for the enemy team (only while visible to the recorder's side)
  killsDerived: boolean;      // kills rebuilt from results (time within +-0.5 s)
  level: "good" | "partial" | "low";
}

export function coverage(tl: BattleTimeline): Coverage {
  const team = new Map(tl.vehicles.map((v) => [v.vid, v.team])), end = Math.floor(tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0), deathT = new Map<number, number>();
  for (const e of tl.events) if (e.k === "kill") deathT.set(e.victim, e.t);
  let seen = 0, offD = 0, evShots = 0, offS = 0;
  for (const e of tl.events) { if (e.k === "damage" && e.amount > 0 && team.get(e.attacker) !== team.get(e.target)) seen += e.amount; if (e.k === "shot") evShots++; }
  if (tl.results) for (const p of Object.values(tl.results.players)) { offD += p.damageDealt || 0; offS += p.shots || 0; }
  const known = (tm: number) => {
    let have = 0, all = 0;
    for (const v of tl.vehicles) {
      if (v.team !== tm) continue; const tr = tl.tracks[v.vid], dEnd = Math.min(end, deathT.get(v.vid) ?? end);
      for (let s = 0; s <= dEnd; s += 2) { all++; if (tr && (tm === tl.recorder.team ? tr.t.some((x) => Math.abs(x - s) <= 2) : tr.visible.some(([a, b]) => s >= a && s <= b))) have++; }
    }
    return all ? have / all : null;
  };
  const ownSeen = known(tl.recorder.team), enemySeen = known(tl.recorder.team === 1 ? 2 : 1);
  const damage = offD > 0 ? Math.min(1, seen / offD) : null, killsDerived = tl.diagnostics.warnings.some((w) => w.startsWith("kills derived"));
  const level = damage == null || damage < 0.5 ? "low" : damage >= 0.85 && (enemySeen ?? 0) >= 0.4 ? "good" : "partial";
  const r2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
  return { damage: r2(damage), shots: offS > 0 ? r2(evShots / offS) : null, ownSeen: r2(ownSeen), enemySeen: r2(enemySeen), killsDerived, level };
}
