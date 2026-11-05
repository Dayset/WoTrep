/** Trainer view cones. Values are game-wide, not per tank, so a tank with a shorter view range is drawn too far out.
 *  Thresholds live here with provenance, per AGENTS.md §8. */
import type { Unit } from "@wotrep/model";

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

/** Threat markers: for each living friendly, the soonest an enemy ghost could be in firing range.
 *  Firing range is the game max view range (445 m) — the actual tank's view range may be shorter,
 *  so this is an upper bound, and it ignores line of sight (bushes, terrain) entirely. `secs` is the
 *  earliest the ghost could shoot the friendly, driving straight at it at its fastest seen speed:
 *  positive counts down, zero or less means it may already be in range. The marker shows only while
 *  the ghost is still tracked (the caller's ghost list) and the arrival falls inside that 30 s window.
 *  `edge` is the nearest point of the ghost's reach disc toward the friendly — the line to draw —
 *  null when the friendly is already inside the disc, or the direct approach is shadowed. */
export interface GhostThreat { ghostVid: number; secs: number; alpha: number; edge: { x: number; z: number } | null }
const THREAT_WINDOW_S = 30; // the ghost's tracked life: the reach disc stops being drawn after this

export function ghostThreats(ghosts: Unit[], units: Unit[], recorderTeam: number): Map<number, GhostThreat> {
  const out = new Map<number, GhostThreat>();
  const friends = units.filter((f) => f.team === recorderTeam && f.alive && f.known === "live");
  for (const g of ghosts) {
    if (!g.alive || g.known !== "ghost" || g.team === recorderTeam || g.reachSpeedMps == null) continue;
    const age = g.ageS ?? 0, alpha = Math.max(0, 1 - age / THREAT_WINDOW_S);
    if (alpha <= 0.03) continue;
    const R = g.reachM ?? 0, blockers = reachBlockers(units, g, recorderTeam);
    for (const f of friends) {
      const d = Math.hypot(f.x - g.x, f.z - g.z);
      // A stationary ghost threatens only what is already in firing range; a moving one counts down.
      let arrival: number;
      if (g.reachSpeedMps > 0) arrival = (d - VIEW_RANGE_M.value) / g.reachSpeedMps;
      else if (d <= VIEW_RANGE_M.value) arrival = 0;
      else continue;
      if (arrival > THREAT_WINDOW_S) continue;
      const secs = arrival - age;
      const prev = out.get(f.vid);
      if (prev && prev.secs <= secs) continue;
      let edge: { x: number; z: number } | null = null;
      if (d > R) {
        const ex = g.x + (R / d) * (f.x - g.x), ez = g.z + (R / d) * (f.z - g.z);
        if (!blockers.some((b) => isShadowed(g.x, g.z, ex, ez, b.x, b.z))) edge = { x: ex, z: ez };
      }
      out.set(f.vid, { ghostVid: g.vid, secs, alpha, edge });
    }
  }
  return out;
}
