import { stateAt, type BattleTimeline } from "@wotrep/model";
import { estimateReload, heightAt, heightField, reloadStateAt, segmentBlocked, segmentTankBlocked, tankBlockers, EYE_HEIGHT_M, type HeightField, type ReloadEstimate } from "@wotrep/analysis";
import { ghostThreats } from "../player/viewConfig";

/** A live enemy can shoot the victim only inside the game maximum view range — the same
 *  rangeM as the blocking table (§3.21) and VIEW_RANGE_M. Beyond it a target cannot be seen
 *  to shoot. Range alone saturates (every living player has a live enemy within 445 m ~100%
 *  of the time), so range is only the first of four conditions — see liveCanShoot below. */
export const EXPOSURE_SHOT_RANGE_M = { value: 445, why: "game maximum view range, same as blocking rangeM and VIEW_RANGE_M; beyond it a target cannot be seen to shoot", n: 0, date: "2026-11-09" } as const;
/** A teammate of the shooter standing this close to the shot segment blocks it — the same
 *  blockRM as the blocking table (§3.21): tank half-width plus a small margin. */
export const EXPOSURE_BLOCK_M = { value: 3, why: "tank half-width plus a small margin, same as blocking blockRM", n: 0, date: "2026-11-09" } as const;

export interface ExposurePlayer {
  vid: number; team: 1 | 2; aliveS: number;
  /** seconds with the red threat ring: an unseen enemy ghost could reach a firing position within 30 s */
  ghostS: number;
  /** of ghostS: the ghost is already in a firing position (countdown 0 s) */
  ghostReadyS: number;
  /** seconds with a spotted live enemy able to shoot: within 445 m, clear line, gun loaded, no teammate in the way */
  liveS: number;
  /** ghostS or liveS: exposed to the ghost or an actual enemy available to shoot */
  exposedS: number;
  /** ghostReadyS or liveS: an enemy can shoot right now */
  nowS: number;
  /** of exposedS: no teammate exposed at the same second */
  soloS: number;
  /** of exposedS: at least one teammate exposed at the same second */
  sharedS: number;
}
export interface ExposureTeam {
  team: 1 | 2; players: ExposurePlayer[];
  /** player-seconds of exposure added up across the team (overlaps count twice) */
  sumExposed: number; sumNow: number;
  /** clock seconds with at least one teammate exposed (overlaps count once) */
  unionExposed: number; unionNow: number;
}
export interface ExposureSummary { teams: Record<1 | 2, ExposureTeam> }

/** True when the live enemy E can shoot the live victim V right now: E is spotted and within
 *  445 m, the eye-to-eye line is clear of terrain (estimated height field — no buildings or
 *  trees without loaded obstacles) and of other tanks, E's gun is loaded (ready or bursting
 *  by the reload estimator; enemies who never fired have no estimate and count for nothing),
 *  and no teammate of E stands within 3 m of the shot segment. The shooter and the victim
 *  are both excluded from the tank blockers — forgetting the shooter self-blocks every line
 *  at t = 0, since the eye starts inside its own tank's circle. Same four conditions as the
 *  blocking table's clean shot (§3.21), read from the victim's side and without its engaging
 *  condition (capability, not attention). */
function liveCanShoot(
  E: { vid: number; team: number; x: number; z: number }, V: { vid: number; x: number; z: number },
  live: { vid: number; team: number; x: number; z: number }[], tanks: { x: number; z: number; top: number; vid: number }[],
  ready: boolean, field: HeightField,
): boolean {
  if (!ready) return false;
  const dx = V.x - E.x, dz = V.z - E.z, dist = Math.hypot(dx, dz);
  if (dist > EXPOSURE_SHOT_RANGE_M.value || dist < 1e-6) return false;
  const eye = (u: { x: number; z: number }): [number, number, number] => [u.x, heightAt(field, u.x, u.z) + EYE_HEIGHT_M, u.z];
  if (segmentBlocked(eye(E), eye(V), field, []) !== null) return false;
  if (segmentTankBlocked(eye(E), eye(V), tanks, new Set([E.vid, V.vid])) !== null) return false;
  for (const B of live) {
    if (B.team !== E.team || B.vid === E.vid) continue;
    const f = ((B.x - E.x) * dx + (B.z - E.z) * dz) / (dist * dist);
    if (f <= 0 || f >= 1) continue;
    if (Math.hypot(B.x - (E.x + f * dx), B.z - (E.z + f * dz)) <= EXPOSURE_BLOCK_M.value) return false;
  }
  return true;
}

/** Fire exposure per player (docs/METRICS.md §3.22). One sample per battle second, while the
 *  tank is alive and live-visible. Ghost threats come from ghostThreats (range-only here: the
 *  report has no obstacles/height context, same as the player without loaded data), called once
 *  with the recorder's team — exactly the markers the player draws. The enemy team's Ghost
 *  column is 0 by that definition: the red ring is only ever computed for the recorder's team.
 *  (Own-team tanks do appear as ghosts in stateAt — track gaps, e.g. ValRom57 ~130 s on the
 *  fixture — but they are never shooters in the recorder-team call, and the symmetric call
 *  would mistake those gaps for fog the enemy team never had.) The live side uses the terrain
 *  height field estimated from the tracks (map bounds from the tracks ± 40 m, as in the
 *  player's fallback bounds) — hills only, no buildings or trees without loaded obstacles. */
export function exposure(tl: BattleTimeline, endS?: number): ExposureSummary {
  const end = Math.floor(endS ?? tl.arena.durationS ?? 0);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const tr of Object.values(tl.tracks)) for (let i = 0; i < tr.x.length; i++) { x0 = Math.min(x0, tr.x[i]!); x1 = Math.max(x1, tr.x[i]!); z0 = Math.min(z0, tr.z[i]!); z1 = Math.max(z1, tr.z[i]!); }
  const field = heightField(tl, { x0: x0 - 40, x1: x1 + 40, z0: z0 - 40, z1: z1 + 40 });
  const shots = new Map<number, number[]>();
  for (const e of tl.events) if (e.k === "shot") (shots.get(e.shooter) ?? shots.set(e.shooter, []).get(e.shooter)!).push(e.t);
  const est = new Map<number, ReloadEstimate>();
  for (const [vid, ts] of shots) est.set(vid, estimateReload(ts));
  const acc = new Map(tl.vehicles.map((v) => [v.vid, { alive: 0, ghost: 0, ghostReady: 0, live: 0, exposed: 0, now: 0, solo: 0, shared: 0 }]));
  const union: Record<1 | 2, { exposed: number; now: number }> = { 1: { exposed: 0, now: 0 }, 2: { exposed: 0, now: 0 } };
  for (let t = 0; t <= end; t++) {
    const s = stateAt(tl, t);
    const live = s.units.filter((u) => u.alive && u.known === "live");
    const ghosts = s.units.filter((u) => u.known === "ghost");
    const threats = ghostThreats(ghosts, s.units, tl.recorder.team);
    const tanks = tankBlockers(s.units, field);
    const ready = new Map(live.map((u) => {
      const e = est.get(u.vid);
      const st = e == null ? "unknown" : reloadStateAt(shots.get(u.vid) ?? [], e, t).state;
      return [u.vid, st === "ready" || st === "bursting"] as [number, boolean];
    }));
    const exposedNow = new Map<number, boolean>(), nowNow = new Map<number, boolean>();
    for (const u of live) {
      const a = acc.get(u.vid)!, th = threats.get(u.vid);
      const ghost = th !== undefined, gready = ghost && th.secs <= 0;
      const liveShot = live.some((o) => o.team !== u.team && liveCanShoot(o, u, live, tanks, ready.get(o.vid) ?? false, field));
      a.alive++; if (ghost) a.ghost++; if (gready) a.ghostReady++; if (liveShot) a.live++;
      const ex = ghost || liveShot, nw = gready || liveShot;
      if (ex) a.exposed++; if (nw) a.now++;
      exposedNow.set(u.vid, ex); nowNow.set(u.vid, nw);
    }
    for (const team of [1, 2] as const) {
      const ids = live.filter((u) => u.team === team && exposedNow.get(u.vid)).map((u) => u.vid);
      if (ids.length) union[team].exposed++;
      if (live.some((u) => u.team === team && nowNow.get(u.vid))) union[team].now++;
      for (const vid of ids) { const a = acc.get(vid)!; if (ids.length === 1) a.solo++; else a.shared++; }
    }
  }
  const teams = {} as Record<1 | 2, ExposureTeam>;
  for (const team of [1, 2] as const) {
    const players: ExposurePlayer[] = tl.vehicles.filter((v) => v.team === team).map((v) => {
      const a = acc.get(v.vid)!;
      return { vid: v.vid, team, aliveS: a.alive, ghostS: a.ghost, ghostReadyS: a.ghostReady, liveS: a.live, exposedS: a.exposed, nowS: a.now, soloS: a.solo, sharedS: a.shared };
    });
    teams[team] = { team, players, sumExposed: players.reduce((x, p) => x + p.exposedS, 0), sumNow: players.reduce((x, p) => x + p.nowS, 0), unionExposed: union[team].exposed, unionNow: union[team].now };
  }
  return { teams };
}
