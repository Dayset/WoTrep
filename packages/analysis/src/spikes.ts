import type { BattleTimeline, Team } from "@wotrep/model";
import { impactEvents } from "./impact";
import cfg from "../config/spikes-v0.json";

/** Biggest win-probability swings (docs/METRICS.md §3.2 credit, see impact.ts). Events within `bucketS` seconds form one swing;
 *  a swing's points go to the team of each credited attacker, and each player's share is listed. The top swing for a team is
 *  its largest single raise. Points are percentage points of win probability. */
export interface Swing {
  t0: number; t1: number;
  /** points credited to each team in this swing (team 1 and team 2 sum to ~0) */
  team: Record<1 | 2, number>;
  /** per-player points in this swing, largest absolute first */
  players: { vid: number; team: Team; pts: number }[];
}

export function impactSwings(tl: BattleTimeline): Swing[] {
  const ev = impactEvents(tl).slice().sort((a, b) => a.t - b.t);
  const out: Swing[] = [];
  let cur: Swing | null = null;
  const bucket = cfg.bucketS.value;
  const teamOf = new Map(tl.vehicles.map((v) => [v.vid, v.team]));
  for (const e of ev) {
    if (!cur || e.t - cur.t1 > bucket) { cur = { t0: e.t, t1: e.t, team: { 1: 0, 2: 0 }, players: [] }; out.push(cur); }
    cur.t1 = e.t;
    const team = teamOf.get(e.attacker); if (team === undefined) continue;
    cur.team[team as 1 | 2] += e.dw;
    const p = cur.players.find((x) => x.vid === e.attacker);
    if (p) p.pts += e.dw; else cur.players.push({ vid: e.attacker, team, pts: e.dw });
  }
  for (const s of out) {
    s.team[1] = Math.round(s.team[1] * 100) / 100; s.team[2] = Math.round(s.team[2] * 100) / 100;
    s.players = s.players.map((p) => ({ ...p, pts: Math.round(p.pts * 100) / 100 })).sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
  }
  return out;
}

/** The largest single raise for a team (its biggest positive swing), or null when it never gained. */
export function largestRaise(tl: BattleTimeline, team: 1 | 2): Swing | null {
  let best: Swing | null = null;
  for (const s of impactSwings(tl)) if (s.team[team] > 0 && (!best || s.team[team] > best.team[team])) best = s;
  return best;
}

/** The biggest single loss for a team (its most negative swing), or null when it never lost ground. */
export function largestDrop(tl: BattleTimeline, team: 1 | 2): Swing | null {
  let worst: Swing | null = null;
  for (const s of impactSwings(tl)) if (s.team[team] < 0 && (!worst || s.team[team] < worst.team[team])) worst = s;
  return worst;
}
