import { estimateReload } from "./reload";
import type { BattleTimeline, Track } from "@wotrep/model";

/** Clip economy and shooting stats (E6-06). Clips come from the reload estimator (#38): shots are
 *  burst-split at intraMax, then bursts are accumulated into a clip until its shell count reaches
 *  the estimated clip size. That reproduces the fixture's clip table, including its two awkward
 *  cases: clip 1 is two bursts (6 + 4 shells) separated by 38 s of driving, and clip 5 is a single
 *  11-shell burst (one shell over the 10-round estimate) — hence "reaches", not "equals".
 *
 *  Damage attribution: a pen belongs to the first clip whose shot window [t0, t1 + DMG_WINDOW_S]
 *  contains it. The 1 s tolerance covers shell flight plus shot/damage packet clock skew (the
 *  fixture's largest observed skew is ~0.3 s); it is far below any reload gap, so windows never
 *  genuinely overlap. Pens with no matching clip (their shot was never observed, e.g. the shooter
 *  was out of the recorder's area of interest) are left unattributed — totals cover attributed
 *  clips only. "Hits" are NOT reported: damage events are pens, and bounces need
 *  showDamageFromShot decoding (open, #30), so a per-shot hit/pen split would be fabricated.
 *
 *  Speed at each shot comes from the subject's track (0.1 s samples on the fixture). Sniper-mode
 *  seconds come from the recorder's camera only, so they are null for any other subject. Aim time
 *  stays null: aim packets are not decoded in v1, so no aim-time semantics exist to compute yet.
 */
const DMG_WINDOW_S = 1.0;

export interface ShootingShot { t: number; speedKmh: number | null }
export interface ShootingClip {
  index: number; t0: number; t1: number; durationS: number;
  shells: number; pens: number; dmg: number; targets: number[];
  shots: ShootingShot[];
}
export interface ShootingStats {
  vid: number; clips: ShootingClip[];
  shells: number; pens: number; dmg: number;
  sniperS: number | null; sniperSegments: number | null; aimS: null;
}

interface Burst { start: number; end: number; shots: number[] }

/** Same burst-split as the peek detector's local helper (a future cleanup could unify them). */
function bursts(times: number[], intraMaxS: number): Burst[] {
  const out: Burst[] = [];
  let cur: number[] = [];
  for (const t of times) {
    if (cur.length && t - cur[cur.length - 1]! > intraMaxS) { out.push({ start: cur[0]!, end: cur[cur.length - 1]!, shots: cur }); cur = []; }
    cur.push(t);
  }
  if (cur.length) out.push({ start: cur[0]!, end: cur[cur.length - 1]!, shots: cur });
  return out;
}

function speedAt(track: Track | undefined, t: number): number | null {
  if (!track) return null;
  const { t: ts, x, z } = track;
  let lo = 0, hi = ts.length - 1, i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid]! <= t) { i = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (i < 0 || i + 1 >= ts.length) return null;
  const dt = ts[i + 1]! - ts[i]!;
  if (dt <= 0) return null;
  return Math.round((Math.hypot(x[i + 1]! - x[i]!, z[i + 1]! - z[i]!) / dt) * 3.6);
}

export function shootingStats(tl: BattleTimeline, vid?: number): ShootingStats {
  const me = vid ?? tl.recorder.vid;
  const isRecorder = me === tl.recorder.vid;
  const shots = tl.events.flatMap((e) => (e.k === "shot" && e.shooter === me ? [e.t] : [])).sort((a, b) => a - b);
  const est = estimateReload(shots);
  const raw: number[][] = [];
  if (est.clipSize > 1 && est.intraMaxS) {
    let cur: number[] = [];
    for (const b of bursts(shots, est.intraMaxS)) {
      cur.push(...b.shots);
      if (cur.length >= est.clipSize) { raw.push(cur); cur = []; }
    }
    if (cur.length) raw.push(cur);
  } else {
    for (const s of shots) raw.push([s]);
  }
  const track = tl.tracks[me];
  const clips: ShootingClip[] = raw.map((ss, index) => ({
    index, t0: ss[0]!, t1: ss[ss.length - 1]!, durationS: ss[ss.length - 1]! - ss[0]!,
    shells: ss.length, pens: 0, dmg: 0, targets: [],
    shots: ss.map((t) => ({ t, speedKmh: speedAt(track, t) })),
  }));
  const pens = tl.events.flatMap((e) => (e.k === "damage" && e.attacker === me && e.amount > 0 ? [e] : [])).sort((a, b) => a.t - b.t);
  let ci = 0;
  for (const p of pens) {
    while (ci < clips.length && p.t > clips[ci]!.t1 + DMG_WINDOW_S) ci++;
    if (ci >= clips.length) break;
    const c = clips[ci]!;
    if (p.t < c.t0) continue;
    c.pens++;
    c.dmg += p.amount;
    if (!c.targets.includes(p.target)) c.targets.push(p.target);
  }
  let sniperS: number | null = null, sniperSegments: number | null = null;
  if (isRecorder && tl.camera) {
    sniperS = 0; sniperSegments = 0;
    const { t: ts, mode } = tl.camera;
    for (let i = 0; i < ts.length; i++) {
      if (mode[i] !== "sniper") continue;
      if (i === 0 || mode[i - 1] !== "sniper") sniperSegments++;
      const end = i + 1 < ts.length ? ts[i + 1]! : (tl.arena.durationS ?? ts[i]!);
      sniperS += end - ts[i]!;
    }
    sniperS = Math.round(sniperS * 100) / 100;
  }
  return {
    vid: me, clips,
    shells: clips.reduce((s, c) => s + c.shells, 0),
    pens: clips.reduce((s, c) => s + c.pens, 0),
    dmg: clips.reduce((s, c) => s + c.dmg, 0),
    sniperS, sniperSegments, aimS: null,
  };
}
