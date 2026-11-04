import type { BattleTimeline } from "./timeline";

/** Engagements (E2-04): damage between two vehicles grouped into exchange windows, so trades can be judged.
 *
 *  Rules:
 *  - Only damage events count (shots that miss, spots, kills without a damage event do not open or extend a window).
 *  - Per unordered pair, events sort by t; consecutive events chain while the gap is < gapS
 *    (default 12 s, configurable) — a gap >= gapS splits the window.
 *  - initiator = the attacker of the window's first damage event.
 *  - dealtByA / dealtByB = damage in each direction (a < b by vid, so the fields are unambiguous).
 *  - hp before/after per side come from that side's own damage events in the window (first hit's
 *    hpBefore, last hit's hpAfter); a side that took no damage in the window keeps its maxHealth.
 *  - Reload states at window start come from an optional provider: the model package cannot import
 *    the estimator (analysis owns it), so callers that have one pass `reloadAt` and the states ride along.
 */
export interface EngagementReload { state: string; secondsLeft: number }

export interface Engagement {
  a: number; b: number;
  start: number; end: number;
  initiator: number;
  dealtByA: number; dealtByB: number;
  hpA: { before: number; after: number };
  hpB: { before: number; after: number };
  shots: number;
  reloadA?: EngagementReload;
  reloadB?: EngagementReload;
}

export interface EngagementOptions {
  gapS?: number;
  reloadAt?: (vid: number, t: number) => EngagementReload | undefined;
}

interface Damage { t: number; attacker: number; target: number; amount: number; hpBefore: number; hpAfter: number }

export function buildEngagements(tl: BattleTimeline, opts: EngagementOptions = {}): Engagement[] {
  const gapS = opts.gapS ?? 12;
  const maxHealth = new Map(tl.vehicles.map((v) => [v.vid, v.maxHealth]));
  const byPair = new Map<string, Damage[]>();
  for (const e of tl.events) {
    if (e.k !== "damage" || e.attacker === e.target) continue;
    const a = Math.min(e.attacker, e.target), b = Math.max(e.attacker, e.target);
    const key = `${a}:${b}`;
    const list = byPair.get(key) ?? [];
    list.push({ t: e.t, attacker: e.attacker, target: e.target, amount: e.amount, hpBefore: e.hpBefore, hpAfter: e.hpAfter });
    byPair.set(key, list);
  }
  const out: Engagement[] = [];
  for (const [key, list] of byPair) {
    const [a, b] = key.split(":").map(Number) as [number, number];
    list.sort((x, y) => x.t - y.t);
    let win: Damage[] = [];
    const flush = () => {
      if (!win.length) return;
      const first = win[0]!, last = win[win.length - 1]!;
      const hp = (vid: number) => {
        const hits = win.filter((d) => d.target === vid);
        return hits.length ? { before: hits[0]!.hpBefore, after: hits[hits.length - 1]!.hpAfter } : { before: maxHealth.get(vid) ?? 0, after: maxHealth.get(vid) ?? 0 };
      };
      const eng: Engagement = {
        a, b, start: first.t, end: last.t, initiator: first.attacker,
        dealtByA: win.filter((d) => d.attacker === a).reduce((s, d) => s + d.amount, 0),
        dealtByB: win.filter((d) => d.attacker === b).reduce((s, d) => s + d.amount, 0),
        hpA: hp(a), hpB: hp(b), shots: win.length,
      };
      if (opts.reloadAt) {
        const ra = opts.reloadAt(a, first.t), rb = opts.reloadAt(b, first.t);
        if (ra) eng.reloadA = ra;
        if (rb) eng.reloadB = rb;
      }
      out.push(eng);
      win = [];
    };
    for (const d of list) {
      if (win.length && d.t - win[win.length - 1]!.t >= gapS) flush();
      win.push(d);
    }
    flush();
  }
  return out.sort((x, y) => x.start - y.start || x.a - y.a || x.b - y.b);
}
