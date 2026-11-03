import { stateAt, type BattleTimeline, type Team } from "@wotrep/model";
import { wpOf } from "./wp";
import cfg from "../config/wp-v0.json";

export interface PlayerMetrics { vid: number; dpm: number; damage: number; lifeMin: number; share: number }
export interface RecorderHeuristics {
  damage: number; dpm: number; teamShare: number;
  /** damage weighted by how dangerous each target was (its own damage per minute vs its team's median), 1.0 = average target */
  threatWeighted: number; threatWeightedPerDamage: number; shareOnThreats: number;
  /** damage dealt while own win probability was already >= cleanupWp */
  cleanupShare: number;
  /** sum of win-probability change credited to the recorder's damage, in percentage points */
  impactPts: number; impactPerKDamage: number;
  best: { t: number; targetVid: number; dWpPts: number } | null;
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

/** Opposition-aware numbers for the recorder. Needs per-hit data, which only the recorder's own hits have in full. */
export function recorderHeuristics(tl: BattleTimeline): RecorderHeuristics | null {
  if (!tl.results) return null;
  const me = tl.recorder.vid, team = tl.recorder.team;
  const pm = new Map(playerMetrics(tl).map((p) => [p.vid, p]));
  const enemyDpm = (tm: Team) => median(tl.vehicles.filter((v) => v.team === tm).map((v) => pm.get(v.vid)!.dpm).filter((x) => x > 0));
  const med = enemyDpm(team === 1 ? 2 : 1) || 1;
  const w = (vid: number) => Math.min(cfg.threatMax.value, Math.max(cfg.threatMin.value, (pm.get(vid)?.dpm ?? 0) / med));
  let dmg = 0, tw = 0, onThreat = 0, clean = 0, impact = 0; let best: RecorderHeuristics["best"] = null;
  for (const e of tl.events) {
    if (e.k !== "damage" || e.attacker !== me || e.target === me || e.amount <= 0) continue;
    const before = wpOf(stateAt(tl, e.t - 0.001), team), after = wpOf(stateAt(tl, e.t), team);
    dmg += e.amount; tw += e.amount * w(e.target); if (w(e.target) >= 1) onThreat += e.amount;
    if (before >= cfg.cleanupWp.value) clean += e.amount;
    const d = (after - before) * 100; impact += d;
    if (!best || d > best.dWpPts) best = { t: e.t, targetVid: e.target, dWpPts: Math.round(d * 100) / 100 };
  }
  const mine = pm.get(me)!;
  return {
    damage: dmg, dpm: mine.dpm, teamShare: mine.share, threatWeighted: Math.round(tw), threatWeightedPerDamage: dmg ? tw / dmg : 0,
    shareOnThreats: dmg ? onThreat / dmg : 0, cleanupShare: dmg ? clean / dmg : 0, impactPts: Math.round(impact * 100) / 100,
    impactPerKDamage: dmg ? Math.round((impact / dmg) * 1000 * 100) / 100 : 0, best,
  };
}
