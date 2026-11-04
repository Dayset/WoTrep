import { stateAt, type BattleTimeline } from "@wotrep/model";
import { aimAt } from "./aim";
import cfgRaw from "../config/alignment-v0.json";

const cfg = cfgRaw as { sampleS: { value: number }; sameDirDeg: { value: number } };

/** Aim (estimated turret yaw, see aim.ts) for every player at regular samples. A null entry means the player was not alive or not known then. */
export interface AimSamples { t: number[]; yaw: Map<number, (number | null)[]> }

export function aimSamples(tl: BattleTimeline, stepS: number = cfg.sampleS.value): AimSamples {
  const end = tl.arena.durationS ?? 0, t: number[] = [], yaw = new Map<number, (number | null)[]>(tl.vehicles.map((v) => [v.vid, []]));
  for (let s = 0; s <= end; s += stepS) {
    t.push(s);
    const alive = new Set(stateAt(tl, s).units.filter((u) => u.alive && u.known === "live").map((u) => u.vid));
    for (const v of tl.vehicles) yaw.get(v.vid)!.push(alive.has(v.vid) ? aimAt(tl, v.vid, s)?.yaw ?? null : null);
  }
  return { t, yaw };
}

/** Angle between two turret yaws in degrees, 0..180. */
export function yawGapDeg(a: number, b: number): number {
  const d = (((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return Math.abs(d) * 180 / Math.PI;
}

/** How often player `a` and player `b` were aiming the same way while both were alive: share of shared samples within sameDirDeg. */
export function alignWith(samples: AimSamples, a: number, b: number): { share: number | null; n: number; meanGapDeg: number | null } {
  const ya = samples.yaw.get(a) ?? [], yb = samples.yaw.get(b) ?? [];
  let n = 0, same = 0, sum = 0;
  for (let i = 0; i < ya.length; i++) {
    const p = ya[i], q = yb[i];
    if (p == null || q == null) continue;
    const g = yawGapDeg(p, q); n++; sum += g; if (g <= cfg.sameDirDeg.value) same++;
  }
  return { share: n ? same / n : null, n, meanGapDeg: n ? sum / n : null };
}
