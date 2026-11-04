import { stateAt, type BattleTimeline } from "@wotrep/model";
import { tracerLines } from "./heatmap";
import cfg from "../config/aim-v0.json";

/** Estimated turret direction and aim state (docs/METRICS.md §3.18). The replay does not give turret angles (gunYaw is not decoded), so we rebuild them:
 *  at each shot with a known shell end point the turret points from the shooter to that end point; between shots it turns at an assumed speed,
 *  arriving just in time for the next shot (if it is near), else going back to the hull direction. The aim counter follows the game's idea that the
 *  aim circle needs `aimTimeS` of a still turret and resets when the gun fires. Both numbers are generic assumptions until gun data exists (#42). */
export interface AimState { yaw: number; hullYaw: number; aimS: number; aimProgress: number; moving: boolean; shotKnown: boolean;
  /** the turret is (estimated to be) on a real target: arrived for a coming shot, or still holding after a shot */
  onTarget: boolean;
  /** gun elevation in radians (up is positive) from shooter height to shell end height; 0 when unknown */
  pitch: number }
const c = (k: keyof typeof cfg) => cfg[k].value;
const TAU = Math.PI * 2, wrap = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const cache = new WeakMap<BattleTimeline, Map<number, { t: number; a: number; e: number }[]>>();

function shotsOf(tl: BattleTimeline, vid: number) {
  let m = cache.get(tl); if (!m) { m = new Map(); for (const s of tracerLines(tl, {})) { const dx = s.x1 - s.x0, dz = s.z1 - s.z0; if (Math.hypot(dx, dz) < 3) continue; (m.get(s.shooter) ?? m.set(s.shooter, []).get(s.shooter)!).push({ t: s.t, a: Math.atan2(dx, dz), e: s.y0 != null && s.y1 != null ? Math.atan2(s.y1 - s.y0 - 2.5, Math.hypot(dx, dz)) : 0 }); } for (const v of m.values()) v.sort((x, y) => x.t - y.t); cache.set(tl, m); }
  return m.get(vid) ?? [];
}
const turn = (from: number, to: number, maxStep: number) => { const d = wrap(to - from); return Math.abs(d) <= maxStep ? to : from + Math.sign(d) * maxStep; };

export function aimAt(tl: BattleTimeline, vid: number, t: number): AimState | null {
  const u = stateAt(tl, t).units.find((x) => x.vid === vid); if (!u || u.known === "never") return null;
  const hull = u.yaw, sp = (c("traverseDegS") * Math.PI) / 180, aimT = c("aimTimeS"), shots = shotsOf(tl, vid);
  let i = -1; for (let k = 0; k < shots.length && shots[k]!.t <= t; k++) i = k;
  const prev = i >= 0 ? shots[i]! : null, next = shots[i + 1] ?? null;
  const done = (yaw: number, settle: number, moving: boolean, onTarget = false, pitch = 0): AimState => { const aimS = moving ? 0 : Math.min(aimT, Math.max(0, t - settle)); return { yaw, hullYaw: hull, aimS, aimProgress: aimS / aimT, moving, shotKnown: prev != null || next != null, onTarget, pitch }; };
  const base = prev?.a ?? hull, t0 = prev?.t ?? -1e9, holdEnd = t0 + c("holdS");
  const idleAt = (tt: number) => (tt < holdEnd ? base : turn(base, hull, sp * (tt - holdEnd)));      // after a shot: hold, then go back to the hull direction
  const idleSettle = Math.max(t0, holdEnd + Math.abs(wrap(hull - base)) / sp);
  if (next && next.t - t <= c("horizonS")) {
    const planT = Math.max(holdEnd, next.t - c("horizonS")), from = idleAt(planT), need = Math.abs(wrap(next.a - from)) / sp, start = Math.max(planT, next.t - need - 0.2), arrive = start + need;
    if (t < start) return done(idleAt(t), t < holdEnd ? t0 : Math.min(idleSettle, t), t >= holdEnd && t < idleSettle, t < holdEnd && prev != null, t < holdEnd && prev ? prev.e : 0);
    if (t < arrive) return done(turn(from, next.a, sp * (t - start)), arrive, true, false, next.e * Math.min(1, (t - start) / Math.max(0.1, need)));
    return done(next.a, arrive, false, true, next.e);
  }
  return done(idleAt(t), t < holdEnd ? t0 : idleSettle, t >= holdEnd && t < idleSettle, t < holdEnd && prev != null, t < holdEnd && prev ? prev.e : 0);
}
