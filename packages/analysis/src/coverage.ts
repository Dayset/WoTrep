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

/** Grid points (2 s steps, 0 to min(duration, death)) with a known position, for one vehicle.
 *  Allies count a point when a track sample falls within ±2 s; enemies count when inside a
 *  visible interval. A vehicle with no track scores 0 everywhere. */
function knownShare(tl: BattleTimeline, vid: number, team: number, end: number, deathT: Map<number, number>): { have: number; all: number } {
  const v = tl.vehicles.find((x) => x.vid === vid);
  if (!v) return { have: 0, all: 0 };
  const tr = tl.tracks[vid], dEnd = Math.min(end, deathT.get(vid) ?? end);
  let have = 0, all = 0;
  const own = team === tl.recorder.team;
  for (let s = 0; s <= dEnd; s += 2) {
    all++;
    if (tr && (own ? tr.t.some((x) => Math.abs(x - s) <= 2) : tr.visible.some(([a, b]) => s >= a && s <= b))) have++;
  }
  return { have, all };
}

function battleEnd(tl: BattleTimeline): number { return Math.floor(tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0); }
function deathTimes(tl: BattleTimeline): Map<number, number> {
  const deathT = new Map<number, number>();
  for (const e of tl.events) if (e.k === "kill") deathT.set(e.victim, e.t);
  return deathT;
}

/** Per-player version of the known-position share: how much of this player's alive time the
 *  replay has position data for (0–1, raw share; format with Math.round(x * 100) + "%").
 *  Null only for an unknown vid or no alive time to score. This is the number shown next to
 *  each name in the Stats/Coach player picker, so a thin sample reads as a small number. */
export function playerCoverage(tl: BattleTimeline, vid: number): number | null {
  const v = tl.vehicles.find((x) => x.vid === vid);
  if (!v) return null;
  const { have, all } = knownShare(tl, vid, v.team, battleEnd(tl), deathTimes(tl));
  return all ? have / all : null;
}

export function coverage(tl: BattleTimeline): Coverage {
  const team = new Map(tl.vehicles.map((v) => [v.vid, v.team])), end = battleEnd(tl), deathT = deathTimes(tl);
  let seen = 0, offD = 0, evShots = 0, offS = 0;
  for (const e of tl.events) { if (e.k === "damage" && e.amount > 0 && team.get(e.attacker) !== team.get(e.target)) seen += e.amount; if (e.k === "shot") evShots++; }
  if (tl.results) for (const p of Object.values(tl.results.players)) { offD += p.damageDealt || 0; offS += p.shots || 0; }
  const known = (tm: number) => {
    let have = 0, all = 0;
    for (const v of tl.vehicles) {
      if (v.team !== tm) continue;
      const s = knownShare(tl, v.vid, tm, end, deathT);
      have += s.have; all += s.all;
    }
    return all ? have / all : null;
  };
  const ownSeen = known(tl.recorder.team), enemySeen = known(tl.recorder.team === 1 ? 2 : 1);
  const damage = offD > 0 ? Math.min(1, seen / offD) : null, killsDerived = tl.diagnostics.warnings.some((w) => w.startsWith("kills derived"));
  const level = damage == null || damage < 0.5 ? "low" : damage >= 0.85 && (enemySeen ?? 0) >= 0.4 ? "good" : "partial";
  const r2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
  return { damage: r2(damage), shots: offS > 0 ? r2(evShots / offS) : null, ownSeen: r2(ownSeen), enemySeen: r2(enemySeen), killsDerived, level };
}
