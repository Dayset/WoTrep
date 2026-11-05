import type { BattleTimeline, Team, Track } from "./timeline";

export interface Unit {
  vid: number; team: Team; alive: boolean; hp: number; x: number; z: number; yaw: number;
  /** live = inside a visible interval (interpolated); ghost = last known position, `ageS` old; never = no position yet */
  known: "live" | "ghost" | "never"; ageS?: number;
  /** Ghost, alive only: metres the vehicle could have covered since it was last seen — its fastest
   *  2 s-window speed observed up to the last-seen sample, times `ageS`. A worst-case bound, not a
   *  prediction: it assumes the tank kept going flat-out, in any direction, from the last known spot.
   *  Dead tanks never move again, so they carry no reach. */
  reachM?: number;
  /** Ghost, alive only: the fastest 2 s-window speed (m/s) behind `reachM` — the speed the reach
   *  radius grows at. Carried separately so callers can turn a distance into a time ("in how many
   *  seconds could it be there") without dividing by a possibly-zero `ageS`. */
  reachSpeedMps?: number;
  /** Ghost, alive only: the speed the vanish→edge leg is credited at (m/s) — the 75TH PERCENTILE
   *  of the per-segment speeds the vehicle was seen driving at before it vanished, counting only
   *  moving segments. A fast cruise, not the burst behind `reachSpeedMps`: it credits the faster
   *  half of the tank's demonstrated driving while still capping the 2 s-window burst — a tank
   *  that once hit 15 m/s for two seconds but usually drives at 6 m/s is credited near the fast
   *  end of its driving, not at 15. The median proved too aggressive combined with the
   *  coverage / one-ghost cross-checks (2026-11-05), so the percentile was raised from 50 to 75.
   *  0 when it never moved visibly (the stationary rule then applies). */
  sustainSpeedMps?: number;
}
export interface Snapshot { t: number; units: Unit[]; teamHp: Record<Team, number>; alive: Record<Team, number> }

interface Idx {
  tl: BattleTimeline;
  dmg: Map<number, { t: number[]; hpAfter: number[] }>;
  killT: Map<number, number>;
  /** Per vehicle, prefix max of the 2 s-window speed at each track sample: reach[i] is the fastest
   *  the vehicle was ever seen going up to sample i. Built once per timeline (tracks are 0.1 s
   *  samples, so this is one linear pass) and read by stateAt for ghost reach. */
  reach: Map<number, number[]>;
  /** Lazily filled 75th percentiles of moving-segment speeds, keyed `${vid}:${sampleIndex}`: the
   *  sustainable speed behind `sustainSpeedMps` for a ghost that vanished at that sample.
   *  A ghost's vanish sample never moves while it stays vanished, so each pair is computed
   *  once per timeline; computing it on every stateAt call would re-sort the track each frame. */
  sustain: Map<string, number>;
}

function maxSpeedPrefix(tr: Track): number[] {
  const n = tr.t.length, out = new Array<number>(n).fill(0);
  let j = -1, mx = 0;
  for (let i = 0; i < n; i++) {
    while (j + 1 <= i && tr.t[j + 1]! <= tr.t[i]! - 2) j++;
    if (j >= 0) {
      const dt = tr.t[i]! - tr.t[j]!;
      if (dt >= 0.5) mx = Math.max(mx, Math.hypot(tr.x[i]! - tr.x[j]!, tr.z[i]! - tr.z[j]!) / dt);
    }
    out[i] = mx;
  }
  return out;
}

/** Percentile of the moving-segment speeds credited as the sustainable speed (2026-11-05):
 *  75 credits the faster half of the tank's demonstrated driving while still capping the
 *  2 s-window burst. The 50th percentile (median) proved too aggressive combined with the
 *  coverage / one-ghost cross-checks — the fixture sweep fell 1135 → 179 markers — so the
 *  percentile was raised; 90 was measured for comparison and not kept. */
const SUSTAIN_PERCENTILE = 0.75;
/** Moving-segment floor for the sustainable-speed percentile (m/s): a segment counts as "driving"
 *  only above this speed, so time spent sitting still does not drag the cruise speed down.
 *  Initial guess (2026-11-05): a tank repositioning below walking pace is not cruising. */
const SUSTAIN_MOVING_MPS = 1;
/** A track segment spanning more than this many seconds crosses an unspotted gap (the track
 *  holds samples only while the vehicle is visible) and is not a real drive — the same gap
 *  the interpolation in stateAt refuses to bridge. */
const SUSTAIN_GAP_S = 1.5;

/** Percentile of the per-segment speeds (m/s) over the track's samples up to index `i`, counting
 *  only segments where the vehicle was moving. 0 when it never moved visibly. Linear
 *  interpolation between the two nearest order statistics (the numpy default): a stray teleport
 *  segment across an unspotted gap is excluded by the gap rule, and one that slips through can
 *  move the value by at most one rank. */
function percentileMovingSpeed(tr: Track, i: number, p: number): number {
  const speeds: number[] = [];
  for (let j = 1; j <= i; j++) {
    const dt = tr.t[j]! - tr.t[j - 1]!;
    if (dt <= 0 || dt > SUSTAIN_GAP_S) continue;
    const s = Math.hypot(tr.x[j]! - tr.x[j - 1]!, tr.z[j]! - tr.z[j - 1]!) / dt;
    if (s > SUSTAIN_MOVING_MPS) speeds.push(s);
  }
  if (speeds.length === 0) return 0;
  speeds.sort((a, b) => a - b);
  const rank = p * (speeds.length - 1);
  const lo = Math.floor(rank), hi = Math.ceil(rank);
  return lo === hi ? speeds[lo]! : speeds[lo]! * (hi - rank) + speeds[hi]! * (rank - lo);
}

const cache = new WeakMap<BattleTimeline, Idx>();

function index(tl: BattleTimeline): Idx {
  let i = cache.get(tl); if (i) return i;
  const dmg = new Map<number, { t: number[]; hpAfter: number[] }>(); const killT = new Map<number, number>();
  for (const e of tl.events) {
    if (e.k === "damage") { const d = dmg.get(e.target) ?? { t: [], hpAfter: [] }; d.t.push(e.t); d.hpAfter.push(e.hpAfter); dmg.set(e.target, d); }
    else if (e.k === "kill" && !killT.has(e.victim)) killT.set(e.victim, e.t);
  }
  const reach = new Map<number, number[]>();
  for (const v of tl.vehicles) { const tr = tl.tracks[v.vid]; if (tr && tr.t.length) reach.set(v.vid, maxSpeedPrefix(tr)); }
  i = { tl, dmg, killT, reach, sustain: new Map() }; cache.set(tl, i); return i;
}

/** index of the last element <= x, or -1 */
function upper(a: number[], x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m]! <= x) lo = m + 1; else hi = m; }
  return lo - 1;
}
const inVisible = (tr: Track, t: number) => tr.visible.some(([a, b]) => t >= a && t <= b);

/** Everything the recorder knew at battle second `t`. Interpolates only inside visible intervals; never invents a position.
 *  A ghost's `reachM` is not a position either — it is the radius of where the tank could have got to by `t` at the
 *  fastest speed it was seen doing before it vanished. */
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
        else {
          const ageS = Math.round((t - tr.t[i]!) * 100) / 100;
          u = { ...u, known: "ghost", x: tr.x[i]!, z: tr.z[i]!, yaw: tr.yaw[i]!, ageS };
          if (!dead) {
            const vMax = ix.reach.get(v.vid)?.[i] ?? 0, r = vMax * ageS;
            u.reachSpeedMps = Math.round(vMax * 10) / 10;
            const sKey = `${v.vid}:${i}`;
            let s = ix.sustain.get(sKey);
            if (s === undefined) { s = percentileMovingSpeed(tr, i, SUSTAIN_PERCENTILE); ix.sustain.set(sKey, s); }
            u.sustainSpeedMps = Math.round(s * 10) / 10;
            if (r > 0) u.reachM = Math.round(r * 10) / 10;
          }
        }
      }
    }
    units.push(u); if (u.alive) { alive[v.team]++; teamHp[v.team] += hp; }
  }
  return { t, units, teamHp, alive };
}
