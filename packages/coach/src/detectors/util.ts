import { stateAt, type BattleTimeline, type Unit } from "@wotrep/model";

export const recorder = (tl: BattleTimeline) => tl.vehicles.find((v) => v.isRecorder);
/** The detector's subject: the vehicle with `vid` when given, else the recorder. Unknown vid → undefined. */
export const subject = (tl: BattleTimeline, vid?: number) => vid != null ? tl.vehicles.find((v) => v.vid === vid) : recorder(tl);
export const dist = (a: Unit, b: Unit) => Math.hypot(a.x - b.x, a.z - b.z);
/** The subject's view of a second: live enemies near, nearest living ally. Positions and visibility come from the recorder's
 *  battle data, so for a non-recorder subject this is what the replay shows — not what the subject saw. */
export function around(tl: BattleTimeline, t: number, rangeM: number, subjectVid?: number) {
  const v = subject(tl, subjectVid); if (!v) return null;
  const me = v, s = stateAt(tl, t), u = s.units.find((x) => x.vid === me.vid);
  if (!u || u.known === "never") return null;
  const allies = s.units.filter((x) => x.team === me.team && x.vid !== me.vid && x.alive && x.known !== "never");
  const enemies = s.units.filter((x) => x.team !== me.team && x.alive && x.known === "live" && dist(u, x) <= rangeM);
  const nearest = allies.reduce<{ vid: number; d: number } | null>((b, a) => { const d = dist(u, a); return !b || d < b.d ? { vid: a.vid, d } : b; }, null);
  return { me: u, enemies, nearestAlly: nearest };
}
/** Group sorted times into clusters where consecutive items are closer than `gapS`. */
export function cluster<T extends { t: number }>(items: T[], gapS: number): T[][] {
  const out: T[][] = [];
  for (const it of items) { const last = out.at(-1); if (last && it.t - last.at(-1)!.t <= gapS) last.push(it); else out.push([it]); }
  return out;
}
