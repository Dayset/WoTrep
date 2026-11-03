import type { BattleTimeline, Track } from "@wotrep/model";
import cfgRaw from "../config/teamplay-v0.json";

const cfg = Object.fromEntries(Object.entries(cfgRaw).map(([k, v]) => [k, v.value])) as Record<keyof typeof cfgRaw, number>;

/** Teamplay v0, docs/METRICS.md §3.10. How a player fights *with* the team, from positions and hits.
 *  focusShare: damage on targets a teammate also hit within focusWindowS.  companyShare: hits fired with a living teammate within companyM.
 *  hangS: seconds in the rear third of the living team while a teammate was taking fire and the player was quiet.  frontRank: average place by progress from spawn (0 rear .. 1 front). */
export interface Teamplay {
  vid: number; hits: number; damage: number;
  focusShare: number | null; companyShare: number | null;
  aliveS: number; hangS: number | null; hangShare: number | null; frontRank: number | null;
}
export interface TeamShape { team: 1 | 2; spreadM: number | null; t: number[]; spread: (number | null)[] }

const at = (tr: Track | undefined, t: number): [number, number] | null => {
  if (!tr || !tr.t.length) return null;
  let lo = 0, hi = tr.t.length - 1; if (t < tr.t[0]! - cfg.maxGapS || t > tr.t[hi]! + cfg.maxGapS) return null;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tr.t[m]! < t) lo = m + 1; else hi = m; }
  if (Math.abs(tr.t[lo]! - t) > cfg.maxGapS && Math.abs(tr.t[Math.max(0, lo - 1)]! - t) > cfg.maxGapS) return null;
  return [tr.x[lo]!, tr.z[lo]!];
};

export function teamplayAll(tl: BattleTimeline): Map<number, Teamplay> {
  const end = Math.floor(tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0);
  const team = new Map(tl.vehicles.map((v) => [v.vid, v.team])), deathT = new Map<number, number>();
  for (const e of tl.events) if (e.k === "kill") deathT.set(e.victim, e.t);
  const alive = (v: number, t: number) => (deathT.get(v) ?? Infinity) > t;
  const hits = tl.events.filter((e): e is Extract<typeof e, { k: "damage" }> => e.k === "damage" && e.amount > 0 && team.get(e.attacker) !== team.get(e.target) && team.has(e.attacker));
  const byAttackerTarget = new Map<string, number[]>(); const shotsBy = new Map<number, number[]>(); const takenBy = new Map<number, number[]>();
  for (const h of hits) { const k = `${h.attacker}>${h.target}`; (byAttackerTarget.get(k) ?? byAttackerTarget.set(k, []).get(k)!).push(h.t); (shotsBy.get(h.attacker) ?? shotsBy.set(h.attacker, []).get(h.attacker)!).push(h.t); }
  for (const e of tl.events) if (e.k === "shot") (shotsBy.get(e.shooter) ?? shotsBy.set(e.shooter, []).get(e.shooter)!).push(e.t);
  for (const e of tl.events) if (e.k === "damage" && e.amount > 0) (takenBy.get(e.target) ?? takenBy.set(e.target, []).get(e.target)!).push(e.t);
  const near = (arr: number[] | undefined, a: number, b: number) => !!arr && arr.some((x) => x >= a && x <= b);
  // where each team started: mean of members' first positions inside the spawn window (needs most members tracked)
  const spawn = new Map<number, [number, number] | null>();
  for (const tm of [1, 2] as const) {
    const ps = tl.vehicles.filter((v) => v.team === tm).map((v) => { const tr = tl.tracks[v.vid]; const i = tr ? tr.t.findIndex((x) => x >= 0) : -1; return tr && i >= 0 && tr.t[i]! <= cfg.spawnWindowS ? ([tr.x[i]!, tr.z[i]!] as [number, number]) : null; }).filter((p): p is [number, number] => !!p);
    const n = tl.vehicles.filter((v) => v.team === tm).length;
    spawn.set(tm, ps.length >= 0.7 * n ? [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length] : null);
  }
  const out = new Map<number, Teamplay>();
  const progress = (v: number, t: number) => { const sp = spawn.get(team.get(v)!), p = at(tl.tracks[v], t); return sp && p ? Math.hypot(p[0] - sp[0], p[1] - sp[1]) : null; };
  for (const v of tl.vehicles) {
    const mine = hits.filter((h) => h.attacker === v.vid), dmg = mine.reduce((s, h) => s + h.amount, 0), mates = tl.vehicles.filter((m) => m.team === v.team && m.vid !== v.vid);
    let focus = 0, company = 0;
    for (const h of mine) {
      if (mates.some((m) => near(byAttackerTarget.get(`${m.vid}>${h.target}`), h.t - cfg.focusWindowS, h.t + cfg.focusWindowS))) focus += h.amount;
      const me = at(tl.tracks[v.vid], h.t);
      if (me && mates.some((m) => { if (!alive(m.vid, h.t)) return false; const p = at(tl.tracks[m.vid], h.t); return !!p && Math.hypot(p[0] - me[0], p[1] - me[1]) <= cfg.companyM; })) company++;
    }
    let aliveS = 0, hang = 0, rankSum = 0, rankN = 0;
    for (let s = 0; s <= end; s++) {
      if (!alive(v.vid, s)) continue; const mine0 = progress(v.vid, s); if (mine0 == null) continue; aliveS++;
      const others = mates.filter((m) => alive(m.vid, s)).map((m) => progress(m.vid, s)).filter((x): x is number => x != null);
      if (!others.length) continue;
      const behind = others.filter((x) => x < mine0).length, rank = behind / others.length; rankSum += rank; rankN++;
      const fighting = mates.some((m) => alive(m.vid, s) && near(takenBy.get(m.vid), s - cfg.allyHitWindowS, s));
      if (rank < cfg.rearFraction && fighting && !near(shotsBy.get(v.vid), s - cfg.quietWindowS, s + cfg.quietWindowS)) hang++;
    }
    const ok = spawn.get(v.team) != null;
    out.set(v.vid, {
      vid: v.vid, hits: mine.length, damage: dmg,
      focusShare: mine.length >= cfg.minHits && dmg > 0 ? focus / dmg : null, companyShare: mine.length >= cfg.minHits ? company / mine.length : null,
      aliveS, hangS: ok ? hang : null, hangShare: ok && aliveS > 0 ? hang / aliveS : null, frontRank: ok && rankN > 0 ? rankSum / rankN : null,
    });
  }
  return out;
}

/** How scattered a team is, every 5 s: mean distance of living, tracked members from their centroid (metres). Low = grouped, high = spread out. */
export function teamShape(tl: BattleTimeline, tm: 1 | 2): TeamShape {
  const end = Math.floor(tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0), deathT = new Map<number, number>();
  for (const e of tl.events) if (e.k === "kill") deathT.set(e.victim, e.t);
  const ids = tl.vehicles.filter((v) => v.team === tm).map((v) => v.vid), ts: number[] = [], sp: (number | null)[] = [];
  for (let s = 0; s <= end; s += 5) {
    const ps = ids.filter((v) => (deathT.get(v) ?? Infinity) > s).map((v) => at(tl.tracks[v], s)).filter((p): p is [number, number] => !!p);
    ts.push(s); if (ps.length < Math.max(3, ids.length * 0.5)) { sp.push(null); continue; }
    const cx = ps.reduce((a, p) => a + p[0], 0) / ps.length, cz = ps.reduce((a, p) => a + p[1], 0) / ps.length;
    sp.push(Math.round(ps.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cz), 0) / ps.length));
  }
  const vals = sp.filter((x): x is number => x != null);
  return { team: tm, spreadM: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null, t: ts, spread: sp };
}
