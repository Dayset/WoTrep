import { stateAt, type BattleTimeline, type Team } from "@wotrep/model";
import { wpOf } from "./wp";
import cfg from "../config/wp-v0.json";

export interface PlayerMetrics { vid: number; dpm: number; damage: number; lifeMin: number; share: number }
export interface RecorderHeuristics {
  damage: number; dpm: number; teamShare: number;
  /** damage weighted by how dangerous each target was ((target dpm × target hp) vs the foes' median at that moment, clamped to [threatMin, threatMax]); 1.0 = average target */
  threatWeighted: number; threatWeightedPerDamage: number; shareOnThreats: number;
  /** damage dealt while own win probability was already >= cleanupWp */
  cleanupShare: number;
  /** share of Impact earned while own win probability was < clutchWp (§3.6); 0 when Impact is 0 */
  clutchShare: number;
  /** sum of win-probability change credited to the recorder's damage, in percentage points */
  impactPts: number; impactPerKDamage: number;
  best: { t: number; targetVid: number; dWpPts: number } | null;
  /** every recorder hit with its threat weight and win-probability change; cum = running Impact */
  /** share of the player's official damage seen as per-hit events (1 = complete) */
  coverage: number;
  /** Impact points per minute alive (for comparing players with different life times) */
  impactPerMin: number;
  hits: { t: number; target: number; amount: number; threat: number; dWpPts: number; cumPts: number }[];
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2 : 0; };

export function playerMetrics(tl: BattleTimeline): PlayerMetrics[] {
  if (!tl.results) return [];
  const tot: Record<number, number> = { 1: 0, 2: 0 };
  for (const v of tl.vehicles) tot[v.team] = (tot[v.team] ?? 0) + (tl.results.players[v.vid]?.damageDealt ?? 0);
  return tl.vehicles.map((v) => {
    const r = tl.results!.players[v.vid]; const life = Math.max((r?.lifeTimeS ?? 0) / 60, 1 / 6);
    return { vid: v.vid, damage: r?.damageDealt ?? 0, lifeMin: life, dpm: Math.round((r?.damageDealt ?? 0) / life), share: tot[v.team] ? (r?.damageDealt ?? 0) / tot[v.team]! : 0 };
  });
}

/** Opposition-aware numbers for any player. Per-hit data exists for every attacker whose hits happened inside the recorder's
 *  area of interest, so `coverage` (observed hit damage / results damage) says how much of that player's battle we actually saw. */
export function playerHeuristics(tl: BattleTimeline, vid: number): RecorderHeuristics | null {
  if (!tl.results) return null;
  const me = vid, vi = tl.vehicles.find((v) => v.vid === vid); if (!vi) return null;
  const team = vi.team as Team, foe = (team === 1 ? 2 : 1) as Team;
  const teamOf = new Map(tl.vehicles.map((v) => [v.vid, v.team]));
  const pm = new Map(playerMetrics(tl).map((p) => [p.vid, p]));
  const hits: RecorderHeuristics["hits"] = [];
  let dmg = 0, tw = 0, onThreat = 0, clean = 0, impact = 0, clutch = 0; let best: RecorderHeuristics["best"] = null;
  for (const e of tl.events) {
    if (e.k !== "damage" || e.attacker !== me || teamOf.get(e.target) !== foe || e.amount <= 0) continue;
    const snap = stateAt(tl, e.t - 0.001);
    const before = wpOf(snap, team), after = wpOf(stateAt(tl, e.t), team);
    // §3.4 exactly: (target dpm × target hp_before) vs the median (dpm × hp) over foes alive at that moment.
    const med = median(snap.units.filter((u) => u.team === foe && u.alive).map((u) => (pm.get(u.vid)?.dpm ?? 0) * u.hp).filter((x) => x > 0)) || 1;
    const wv = Math.min(cfg.threatMax.value, Math.max(cfg.threatMin.value, ((pm.get(e.target)?.dpm ?? 0) * e.hpBefore) / med));
    dmg += e.amount; tw += e.amount * wv; if (wv >= 1) onThreat += e.amount;
    if (before >= cfg.cleanupWp.value) clean += e.amount;
    const d = (after - before) * 100; impact += d;
    if (before < cfg.clutchWp.value) clutch += d;
    hits.push({ t: e.t, target: e.target, amount: e.amount, threat: Math.round(wv * 100) / 100, dWpPts: Math.round(d * 100) / 100, cumPts: Math.round(impact * 100) / 100 });
    if (!best || d > best.dWpPts) best = { t: e.t, targetVid: e.target, dWpPts: Math.round(d * 100) / 100 };
  }
  const mine = pm.get(me)!, official = tl.results.players[me]?.damageDealt ?? 0;
  return {
    damage: dmg, dpm: mine.dpm, teamShare: mine.share, threatWeighted: Math.round(tw), threatWeightedPerDamage: dmg ? tw / dmg : 0,
    shareOnThreats: dmg ? onThreat / dmg : 0, cleanupShare: dmg ? clean / dmg : 0, clutchShare: impact !== 0 ? clutch / impact : 0, impactPts: Math.round(impact * 100) / 100,
    impactPerKDamage: dmg ? Math.round((impact / dmg) * 1000 * 100) / 100 : 0, best, hits,
    impactPerMin: Math.round((impact / mine.lifeMin) * 100) / 100,
    coverage: official > 0 ? Math.min(1, dmg / official) : dmg > 0 ? 1 : 0,
  };
}

export const recorderHeuristics = (tl: BattleTimeline) => playerHeuristics(tl, tl.recorder.vid);

export interface PlayerStats { vid: number; accuracy: number | null; penRate: number | null; lifeS: number; lifeShare: number | null }
/** Exact per-player numbers from the battle results (all players, no coverage caveat). Null when the denominator is zero. */
export function playerStats(tl: BattleTimeline): PlayerStats[] {
  const dur = tl.arena.durationS ?? 0;
  return tl.vehicles.map((v) => {
    const r = tl.results?.players[v.vid];
    return {
      vid: v.vid, accuracy: r && r.shots > 0 ? r.hits / r.shots : null, penRate: r && r.hits > 0 ? r.pens / r.hits : null,
      lifeS: r?.lifeTimeS ?? 0, lifeShare: r && dur > 0 ? Math.min(1, r.lifeTimeS / dur) : null,
    };
  });
}
