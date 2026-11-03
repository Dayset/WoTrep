import { stateAt, type BattleTimeline, type Unit } from "@wotrep/model";

export const recorder = (tl: BattleTimeline) => tl.vehicles.find((v) => v.isRecorder);
export const dist = (a: Unit, b: Unit) => Math.hypot(a.x - b.x, a.z - b.z);
/** The recorder's own view of a second: live enemies near, nearest living ally (allies are always known). */
export function around(tl: BattleTimeline, t: number, rangeM: number) {
  const me = recorder(tl)!, s = stateAt(tl, t), u = s.units.find((x) => x.vid === me.vid);
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
