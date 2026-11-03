import type { BattleTimeline, Team, Track } from "./timeline";

export interface Unit {
  vid: number; team: Team; alive: boolean; hp: number; x: number; z: number; yaw: number;
  /** live = inside a visible interval (interpolated); ghost = last known position, `ageS` old; never = no position yet */
  known: "live" | "ghost" | "never"; ageS?: number;
}
export interface Snapshot { t: number; units: Unit[]; teamHp: Record<Team, number>; alive: Record<Team, number> }

interface Idx {
  tl: BattleTimeline;
  dmg: Map<number, { t: number[]; hpAfter: number[] }>;
  killT: Map<number, number>;
}
const cache = new WeakMap<BattleTimeline, Idx>();

function index(tl: BattleTimeline): Idx {
  let i = cache.get(tl); if (i) return i;
  const dmg = new Map<number, { t: number[]; hpAfter: number[] }>(); const killT = new Map<number, number>();
  for (const e of tl.events) {
    if (e.k === "damage") { const d = dmg.get(e.target) ?? { t: [], hpAfter: [] }; d.t.push(e.t); d.hpAfter.push(e.hpAfter); dmg.set(e.target, d); }
    else if (e.k === "kill" && !killT.has(e.victim)) killT.set(e.victim, e.t);
  }
  i = { tl, dmg, killT }; cache.set(tl, i); return i;
}

/** index of the last element <= x, or -1 */
function upper(a: number[], x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m]! <= x) lo = m + 1; else hi = m; }
  return lo - 1;
}
const inVisible = (tr: Track, t: number) => tr.visible.some(([a, b]) => t >= a && t <= b);

/** Everything the recorder knew at battle second `t`. Interpolates only inside visible intervals; never invents a position. */
export function stateAt(tl: BattleTimeline, t: number): Snapshot {
  const ix = index(tl);
  const units: Unit[] = []; const teamHp: Record<Team, number> = { 1: 0, 2: 0 }; const alive: Record<Team, number> = { 1: 0, 2: 0 };
  for (const v of tl.vehicles) {
    const kt = ix.killT.get(v.vid); const dead = kt !== undefined && kt <= t;
    const d = ix.dmg.get(v.vid); const di = d ? upper(d.t, t) : -1;
    const hp = dead ? 0 : di >= 0 ? d!.hpAfter[di]! : v.maxHealth;
    const tr = tl.tracks[v.vid]; let u: Unit = { vid: v.vid, team: v.team, alive: !dead, hp, x: 0, z: 0, yaw: 0, known: "never" };
    if (tr && tr.t.length) {
      const i = upper(tr.t, t);
      if (i >= 0) {
        const live = inVisible(tr, t);
        if (live && i + 1 < tr.t.length && tr.t[i + 1]! - tr.t[i]! <= 1.5) {
          const f = (t - tr.t[i]!) / (tr.t[i + 1]! - tr.t[i]!);
          u = { ...u, known: "live", x: tr.x[i]! + (tr.x[i + 1]! - tr.x[i]!) * f, z: tr.z[i]! + (tr.z[i + 1]! - tr.z[i]!) * f, yaw: tr.yaw[i]! };
        } else if (live) u = { ...u, known: "live", x: tr.x[i]!, z: tr.z[i]!, yaw: tr.yaw[i]! };
        else u = { ...u, known: "ghost", x: tr.x[i]!, z: tr.z[i]!, yaw: tr.yaw[i]!, ageS: Math.round((t - tr.t[i]!) * 100) / 100 };
      }
    }
    units.push(u); if (u.alive) { alive[v.team]++; teamHp[v.team] += hp; }
  }
  return { t, units, teamHp, alive };
}
