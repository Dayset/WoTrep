import type { BattleTimeline } from "@wotrep/model";

/** Reload estimate learned from a vehicle's own observed shots (no game data needed). METRICS.md / issue #38.
 *  Shots are only visible while the shooter is in the recorder's area of interest, so everything here is approximate
 *  and carries a confidence. It is an estimate, not proof that a gun is still reloading: detectors that blame or praise a player for
 *  a reload window must wait for real gun data (#42). When gun data lands (#42) it should replace `reloadS`/`clipSize`, not this interface. */
export interface ReloadEstimate {
  clipSize: number;        // shots per burst (1 = single-shot gun)
  intraMaxS: number;       // gaps at or below this belong to one burst
  reloadS: number | null;  // shortest gap between bursts we saw. A player cannot fire before the gun is ready, so this is an UPPER bound on the true reload (skilled players fire the moment it is ready, so it is usually close). null if never seen
  confidence: number;      // 0..1
  shots: number;
  /** mean gap between bursts over the whole battle: the averaged reload used for the spinner. Undefined when too few shots. */
  avgReloadS?: number | null;
}
export interface ReloadState { state: "ready" | "bursting" | "reloading" | "unknown"; secondsLeft: number; shotsInClip: number | null; confidence: number }

const mode = (a: number[]) => { const c = new Map<number, number>(); for (const x of a) c.set(x, (c.get(x) ?? 0) + 1); return [...c].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0]?.[0] ?? 1; };

export function estimateReload(times: number[]): ReloadEstimate {
  const t = [...times].sort((a, b) => a - b), gaps = t.slice(1).map((x, i) => x - t[i]!).filter((g) => g > 0.02);
  if (gaps.length < 2) return { clipSize: 1, intraMaxS: 0, reloadS: gaps[0] ?? null, confidence: 0, shots: t.length };
  const s = [...gaps].sort((a, b) => a - b);
  let cut = 0, best = 1; // largest ratio jump between neighbouring sorted gaps splits "inside a burst" from "between bursts"
  for (let i = 1; i < s.length; i++) { const r = s[i]! / s[i - 1]!; if (r > best) { best = r; cut = i; } }
  const burstGaps = best >= 3 && s[cut - 1]! < 3 ? cut : 0;
  const intraMax = burstGaps ? Math.sqrt(s[cut - 1]! * s[cut]!) : 0;
  const long = gaps.filter((g) => g > intraMax);
  const runs: number[] = []; let run = 1;
  for (const g of gaps) { if (intraMax && g <= intraMax) run++; else { runs.push(run); run = 1; } }
  runs.push(run);
  const clip = burstGaps ? mode(runs.filter((r) => r >= mode(runs))) : 1; // full clips are the commonest of the longer runs; partial ones are shorter
  const conf = Math.min(1, long.length / 6) * (burstGaps ? Math.min(1, runs.filter((r) => r === clip).length / 3) : 0.7);
  const reloadS = long.length ? Math.min(...long) : null;
  // A "reload" under 1 s means a gun firing continuously without a clear burst structure (rapid-fire / special weapons): the estimate is meaningless.
  const capped = reloadS != null && reloadS < 1 ? Math.min(conf, 0.2) : conf;
  const avgReloadS = long.length ? long.reduce((a, b) => a + b, 0) / long.length : null;
  return { clipSize: clip, intraMaxS: intraMax, reloadS, confidence: Math.round(capped * 100) / 100, shots: t.length, avgReloadS };
}

/** State of the gun at time `t` given the shots seen so far. */
export function reloadStateAt(times: number[], est: ReloadEstimate, t: number): ReloadState {
  const seen = times.filter((x) => x <= t).sort((a, b) => a - b);
  if (!seen.length || est.confidence === 0) return { state: "unknown", secondsLeft: 0, shotsInClip: null, confidence: 0 };
  let run = 1;
  for (let i = seen.length - 1; i > 0; i--) { if (est.intraMaxS && seen[i]! - seen[i - 1]! <= est.intraMaxS) run++; else break; }
  const since = t - seen.at(-1)!;
  if (est.clipSize > 1 && run < est.clipSize && since <= est.intraMaxS * 1.5) return { state: "bursting", secondsLeft: 0, shotsInClip: est.clipSize - run, confidence: est.confidence };
  if (est.reloadS != null && (est.clipSize === 1 || run >= est.clipSize) && since < est.reloadS) return { state: "reloading", secondsLeft: est.reloadS - since, shotsInClip: 0, confidence: est.confidence };
  return { state: "ready", secondsLeft: 0, shotsInClip: est.clipSize > 1 && run < est.clipSize ? null : est.clipSize, confidence: est.confidence };
}

export function shotTimes(tl: BattleTimeline, vid: number): number[] {
  return tl.events.flatMap((e) => (e.k === "shot" && e.shooter === vid ? [e.t] : []));
}

/** Reload spinner value: 0..1 while the gun is reloading, measured against the averaged reload; null when ready, bursting or unknown. */
export function reloadProgress(times: number[], est: ReloadEstimate, t: number): number | null {
  if (est.confidence === 0 || est.avgReloadS == null) return null;
  const st = reloadStateAt(times, { ...est, reloadS: est.avgReloadS }, t);
  if (st.state !== "reloading") return null;
  return Math.min(1, Math.max(0, 1 - st.secondsLeft / est.avgReloadS));
}
