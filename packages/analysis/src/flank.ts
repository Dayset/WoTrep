import { stateAt, type BattleTimeline, type Team } from "@wotrep/model";
import cfgRaw from "../config/flank-v0.json";

const cfg = Object.fromEntries(Object.entries(cfgRaw).map(([k, v]) => [k, v.value])) as Record<keyof typeof cfgRaw, number>;

/** Flank model v0, docs/METRICS.md §3.13. Force distribution across the map from one team's point of view.
 *  Axis = from the team's spawn to the enemy's (its spawn if tracked, else the centre of where it was first seen). Lateral position splits the
 *  map into left / centre / right thirds (percentiles of everything tracked). Every `stepS` we add up living HP of both teams per flank
 *  (enemies only while seen: live, or ghost younger than `ghostMaxS`). */
export const FLANKS = ["left", "centre", "right"] as const;
export interface FlankModel {
  team: Team; t: number[];
  own: [number[], number[], number[]]; foe: [number[], number[], number[]];
  /** own / (own + foe) per flank and step; null where fewer than `minForce` HP are there. */
  ratio: [(number | null)[], (number | null)[], (number | null)[]];
  /** Average share of the team's HP on each flank, and the same for the enemy HP that was seen. */
  ownShare: [number, number, number]; foeShare: [number, number, number];
}

export function flankModel(tl: BattleTimeline, team: Team = tl.recorder.team): FlankModel | null {
  const foeTeam = (team === 1 ? 2 : 1) as Team, end = Math.floor(tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0);
  const first = (tm: Team, within: number) => { const ps: [number, number][] = []; for (const v of tl.vehicles) { if (v.team !== tm) continue; const tr = tl.tracks[v.vid]; if (!tr) continue; const i = tr.t.findIndex((x) => x >= 0 && x <= within); if (i >= 0) ps.push([tr.x[i]!, tr.z[i]!]); } return ps; };
  const mean = (ps: [number, number][]) => [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length] as const;
  const ownPs = first(team, 10), foePs = first(foeTeam, cfg.refWindowS);
  if (ownPs.length < 3 || foePs.length < 3) return null;
  const [ox, oz] = mean(ownPs), [fx, fz] = mean(foePs), L = Math.hypot(fx - ox, fz - oz); if (L < 100) return null;
  const ax = (fx - ox) / L, az = (fz - oz) / L;
  // lateral coordinate, positive = to the left when looking along the axis (x east, z north)
  const lat = (x: number, z: number) => -(x - ox) * az + (z - oz) * ax;
  const all: number[] = []; for (const tr of Object.values(tl.tracks)) for (let i = 0; i < tr.x.length; i += 4) if (tr.t[i]! >= 0) all.push(lat(tr.x[i]!, tr.z[i]!));
  if (all.length < 30) return null; all.sort((a, b) => a - b);
  const lo = all[Math.floor(all.length / 3)]!, hi = all[Math.floor((2 * all.length) / 3)]!;
  const band = (x: number, z: number) => { const l = lat(x, z); return l >= hi ? 0 : l >= lo ? 1 : 2; };
  const ts: number[] = [], own: FlankModel["own"] = [[], [], []], foe: FlankModel["foe"] = [[], [], []], ratio: FlankModel["ratio"] = [[], [], []];
  for (let s = 0; s <= end; s += cfg.stepS) {
    const snap = stateAt(tl, s), o = [0, 0, 0], f = [0, 0, 0];
    for (const u of snap.units) {
      if (!u.alive || u.known === "never" || u.hp <= 0) continue;
      if (u.team === team) o[band(u.x, u.z)]! += u.hp; else if (u.known === "live" || (u.ageS ?? 0) <= cfg.ghostMaxS) f[band(u.x, u.z)]! += u.hp;
    }
    ts.push(s); for (let b = 0; b < 3; b++) { own[b]!.push(Math.round(o[b]!)); foe[b]!.push(Math.round(f[b]!)); const tot = o[b]! + f[b]!; ratio[b]!.push(tot >= cfg.minForce ? Math.round((o[b]! / tot) * 100) / 100 : null); }
  }
  const share = (a: [number[], number[], number[]]): [number, number, number] => { const sums = a.map((x) => x.reduce((p, q) => p + q, 0)); const tot = sums.reduce((p, q) => p + q, 0) || 1; return [sums[0]! / tot, sums[1]! / tot, sums[2]! / tot].map((x) => Math.round(x * 100) / 100) as [number, number, number]; };
  return { team, t: ts, own, foe, ratio, ownShare: share(own), foeShare: share(foe) };
}

/** Even-fight band around 50%: returns "ahead" | "even" | "behind" for a ratio. */
export const flankState = (r: number | null): "ahead" | "even" | "behind" | null => (r == null ? null : r > 0.5 + cfg.even ? "ahead" : r < 0.5 - cfg.even ? "behind" : "even");
