/** Trainer view cones. Values are game-wide, not per tank, so a tank with a shorter view range is drawn too far out.
 *  Thresholds live here with provenance, per AGENTS.md §8. */
import type { Unit } from "@wotrep/model";
import { heightAt, segmentBlocked, segmentTankBlocked, tankBlockers, EYE_HEIGHT_M, type BlockerIndex, type HeightField, type SightBlocker, type TankBlocker, type Vec3 } from "@wotrep/analysis";

export const VIEW_RANGE_M = { value: 445, why: "game maximum view range, same as packages/analysis maxSpotterM", n: 0, date: "2026-11-04" } as const;
export const VIEW_FOV_DEG = { value: 65, why: "horizontal field of view used by the POV camera and minimap", n: 0, date: "2026-11-04" } as const;
export const VIEW_ALPHA = { value: 0.2, why: "trainer cones drawn at 20% visibility so overlaps stay readable", n: 0, date: "2026-11-04" } as const;
/** Proximity spotting: a vehicle within this many metres of a living enemy is spotted automatically,
 *  camouflage and bushes aside. Beyond this range a tank *can* sit unspotted (bush, camo), so the
 *  full 445 m view range is NOT carved — only this unconditional rule is. */
export const PROXIMITY_SPOT_M = { value: 50, why: "WoT proximity-spotting rule: under 50 m a vehicle is always detected", n: 0, date: "2026-11-05" } as const;

/** Who the trainer cones are drawn for: everyone, one side, or one vehicle id. */
export type TrainerSel = "all" | "ally" | "enemy" | number;
export function trainerMatch(sel: TrainerSel, vid: number, team: number, recorderTeam: number): boolean {
  return sel === "all" || (sel === "ally" && team === recorderTeam) || (sel === "enemy" && team !== recorderTeam) || sel === vid;
}

/** Living teammates of the recorder whose proximity bubble overlaps an enemy ghost's reach disc:
 *  the ghost cannot be inside any of these 50 m discs, or it would be spotted right now.
 *  Only for enemy ghosts — a friendly ghost sitting near its own team is normal, and a dead or
 *  stale-position teammate spots nothing. */
export function reachBlockers(units: Unit[], ghost: Unit, recorderTeam: number): Unit[] {
  if (!ghost.alive || ghost.known !== "ghost" || !ghost.reachM || ghost.team === recorderTeam) return [];
  const r = ghost.reachM + PROXIMITY_SPOT_M.value;
  return units.filter((o) => o.team === recorderTeam && o.vid !== ghost.vid && o.alive && o.known === "live" && Math.hypot(o.x - ghost.x, o.z - ghost.z) <= r);
}

/** Shadow rule: the ghost cannot have driven THROUGH a friendly's proximity bubble, so the ground
 *  behind a bubble — as seen from where the ghost vanished — is reachable only by going around it.
 *  This is an approximation twice over: it uses the friendly's CURRENT position (the bubble moves),
 *  and it ignores the detour — points near the shadow's edges may still be reachable by a short way
 *  around the bubble. The hard cut stays the 50 m hole; the shadow is the path-aware cut on top. */

/** True when the straight line from the vanish point V to P crosses the bubble around F.
 *  False when V itself is inside the bubble (then the shadow is undefined for this friendly). */
export function isShadowed(vx: number, vz: number, px: number, pz: number, fx: number, fz: number): boolean {
  const r = PROXIMITY_SPOT_M.value;
  const ax = vx - fx, az = vz - fz;
  if (ax * ax + az * az <= r * r) return false; // V inside the bubble: no shadow
  const dx = px - vx, dz = pz - vz, a = dx * dx + dz * dz;
  if (a === 0) return false;
  const b = 2 * (ax * dx + az * dz), c = ax * ax + az * az - r * r, disc = b * b - 4 * a * c;
  if (disc <= 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0 && t < 1;
}

/** The shadow as a polyline in game coords: [tangent point, points along the reach circle, tangent
 *  point]. Close it with a straight chord — the chord lies inside the bubble, already cut by the
 *  hole, so the chord-vs-arc difference is invisible. Null when there is no shadow: the vanish point
 *  inside the bubble, or the bubble clear of the reach disc. */
export function shadowPolygon(vx: number, vz: number, R: number, fx: number, fz: number): { x: number; z: number }[] | null {
  const r = PROXIMITY_SPOT_M.value;
  const dx = fx - vx, dz = fz - vz, d = Math.hypot(dx, dz);
  if (d <= r || d >= R + r) return null;
  const base = Math.atan2(dz, dx), alpha = Math.asin(r / d), t = Math.sqrt(d * d - r * r);
  const a1 = base - alpha, a2 = base + alpha;
  const pts: { x: number; z: number }[] = [{ x: vx + t * Math.cos(a1), z: vz + t * Math.sin(a1) }];
  const n = Math.max(4, Math.ceil((a2 - a1) / (Math.PI / 12)));
  for (let i = 0; i <= n; i++) { const a = a1 + ((a2 - a1) * i) / n; pts.push({ x: vx + R * Math.cos(a), z: vz + R * Math.sin(a) }); }
  pts.push({ x: vx + t * Math.cos(a2), z: vz + t * Math.sin(a2) });
  return pts;
}

/** Line-of-sight context for threat checks: the HeightField plus the sight blockers.
 *  The same shape as the Player's `los` memo. Null means no LOS data (obstacles not
 *  loaded) — threats then fall back to the old range-only rule, exactly as before. */
export interface LosContext { field: HeightField; blockers: SightBlocker[]; index: BlockerIndex }

/** Threat markers: for each living friendly, the soonest an enemy ghost could be in firing range.
 *  Firing range is the game max view range (445 m) — the actual tank's view range may be shorter,
 *  so this is an upper bound. With a LosContext, the ghost must also have a clear line of sight
 *  from where it would shoot: terrain (heightmap), buildings/footprints, trees, and other tanks
 *  all block. No reachable firing position with LOS = no marker at all (no ring, no countdown).
 *  `secs` is the earliest the ghost could shoot the friendly: the time to drive from the vanish
 *  point to the nearest firing position with LOS, at its fastest seen speed — positive counts
 *  down, zero or less means it may already be there. The marker shows only while the ghost is
 *  still tracked (the caller's ghost list) and the arrival falls inside that 30 s window.
 *  `edge` is the firing position — the line to draw — null when the ghost may already be in
 *  a firing position (inside its current reach disc). Without a LosContext the old rule applies:
 *  range only, and `edge` is the nearest point of the reach disc toward the friendly, null when
 *  the friendly is already inside the disc or the direct approach is shadowed. */
export interface GhostThreat { ghostVid: number; secs: number; alpha: number; edge: { x: number; z: number } | null }
const THREAT_WINDOW_S = 30; // the ghost's tracked life: the reach disc stops being drawn after this
/** Firing-position rings around the friendly (m), far to near, sampled at 45° steps when the
 *  direct approach has no LOS. Three rings bound the search: the 445 m ring is the farthest
 *  firing position, 250 m and 100 m cover ground closer in (a dip or a hill the ghost drives
 *  past). A position closer than 100 m is never sampled — the ghost would have to drive past
 *  the sampled rings to get there, so it cannot be the earliest arrival. 2026-11-05. */
const LOS_RING_R_M = [VIEW_RANGE_M.value, 250, 100];
const LOS_RING_STEPS = 8;

interface FiringPosition { x: number; z: number; arrival: number }

/** True when the eye-to-eye line from `from` to `to` is clear of terrain, footprints, trees
 *  and tanks. `exclude` holds the target's vid — a tank never blocks a shot aimed at itself. */
function losClear(from: { x: number; z: number }, to: { x: number; z: number }, los: LosContext, tanks: TankBlocker[], exclude: ReadonlySet<number>): boolean {
  const eye = (p: { x: number; z: number }): Vec3 => [p.x, heightAt(los.field, p.x, p.z) + EYE_HEIGHT_M, p.z];
  const a = eye(from), b = eye(to);
  if (segmentBlocked(a, b, los.field, los.blockers, los.index) !== null) return false;
  return segmentTankBlocked(a, b, tanks, exclude) === null;
}

/** The earliest firing position the ghost could reach with a clear line to the friendly, or
 *  null when there is none. Candidates are tested cheapest-first and in order of increasing
 *  arrival: the direct point (the closest firing position to the vanish point), then the
 *  rings around the friendly, nearest first. A candidate must be reachable inside the 30 s
 *  window, outside every friendly's 50 m proximity bubble, not in a proximity shadow, and
 *  have a clear line. The shadow check runs against EVERY living friendly — the whole
 *  vanish→firing-position segment, not just the reach blockers near the vanish point:
 *  the search ranges to speed × 30 s, far beyond the reach disc, so a far-side candidate
 *  could otherwise be reached by driving straight through a friendly's bubble (2026-11-05:
 *  a T=91 marker's path passed 44.9 m from its own victim, a T=45 one 0.3 m). A stationary
 *  ghost can only shoot from where it vanished. */
function findFiringPosition(g: Unit, f: Unit, friends: Unit[], los: LosContext, tanks: TankBlocker[]): FiringPosition | null {
  const vx = g.x, vz = g.z, speed = g.reachSpeedMps ?? 0;
  const d = Math.hypot(f.x - vx, f.z - vz);
  const candidates: { x: number; z: number }[] = [];
  if (d <= VIEW_RANGE_M.value) candidates.push({ x: vx, z: vz });
  else { const s = (d - VIEW_RANGE_M.value) / d; candidates.push({ x: vx + (f.x - vx) * s, z: vz + (f.z - vz) * s }); }
  const base = Math.atan2(vz - f.z, vx - f.x); // direction from the friendly toward the vanish point
  for (const rr of LOS_RING_R_M) for (let k = 0; k < LOS_RING_STEPS; k++) {
    if (rr === VIEW_RANGE_M.value && k === 0) continue; // the direct point, already a candidate
    const a = base + (k * 2 * Math.PI) / LOS_RING_STEPS;
    candidates.push({ x: f.x + rr * Math.cos(a), z: f.z + rr * Math.sin(a) });
  }
  candidates.sort((p, q) => Math.hypot(p.x - vx, p.z - vz) - Math.hypot(q.x - vx, q.z - vz));
  const exclude = new Set([f.vid]);
  for (const p of candidates) {
    const dist = Math.hypot(p.x - vx, p.z - vz);
    const arrival = speed > 0 ? dist / speed : dist === 0 ? 0 : Infinity;
    if (arrival > THREAT_WINDOW_S) continue;
    if (friends.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < PROXIMITY_SPOT_M.value)) continue;
    if (friends.some((o) => isShadowed(vx, vz, p.x, p.z, o.x, o.z))) continue;
    if (!losClear(p, f, los, tanks, exclude)) continue;
    return { x: p.x, z: p.z, arrival };
  }
  return null;
}

export function ghostThreats(ghosts: Unit[], units: Unit[], recorderTeam: number, los?: LosContext | null): Map<number, GhostThreat> {
  const out = new Map<number, GhostThreat>();
  const friends = units.filter((f) => f.team === recorderTeam && f.alive && f.known === "live");
  const tanks = los ? tankBlockers(units, los.field) : [];
  for (const g of ghosts) {
    if (!g.alive || g.known !== "ghost" || g.team === recorderTeam || g.reachSpeedMps == null) continue;
    const age = g.ageS ?? 0, alpha = Math.max(0, 1 - age / THREAT_WINDOW_S);
    if (alpha <= 0.03) continue;
    const R = g.reachM ?? 0, blockers = reachBlockers(units, g, recorderTeam);
    for (const f of friends) {
      const d = Math.hypot(f.x - g.x, f.z - g.z);
      let arrival: number, edge: { x: number; z: number } | null;
      if (!los) {
        // Range-only rule, as before: no line-of-sight data (obstacles not loaded).
        // A stationary ghost threatens only what is already in firing range; a moving one counts down.
        if (g.reachSpeedMps > 0) arrival = (d - VIEW_RANGE_M.value) / g.reachSpeedMps;
        else if (d <= VIEW_RANGE_M.value) arrival = 0;
        else continue;
        if (arrival > THREAT_WINDOW_S) continue;
        edge = null;
        if (d > R) {
          const ex = g.x + (R / d) * (f.x - g.x), ez = g.z + (R / d) * (f.z - g.z);
          if (!blockers.some((b) => isShadowed(g.x, g.z, ex, ez, b.x, b.z))) edge = { x: ex, z: ez };
        }
      } else {
        // Line-of-sight rule: the ghost must reach a firing position with a clear line.
        const fp = findFiringPosition(g, f, friends, los, tanks);
        if (!fp) continue;
        arrival = fp.arrival;
        if (arrival > THREAT_WINDOW_S) continue;
        const pd = Math.hypot(fp.x - g.x, fp.z - g.z);
        edge = pd > R ? { x: fp.x, z: fp.z } : null;
      }
      const secs = arrival - age;
      const prev = out.get(f.vid);
      if (prev && prev.secs <= secs) continue;
      out.set(f.vid, { ghostVid: g.vid, secs, alpha, edge });
    }
  }
  return out;
}
