import { buildEngagements, type BattleTimeline, type VehicleInfo } from "@wotrep/model";

/** Trade summary (E6-04): battle-level trade numbers for one subject, from engagements.
 *
 *  The summary is subject-centric by necessity: battle-wide dealt always equals battle-wide
 *  received (every damage event is both), so only a subject's numbers say anything.
 *  - dealt / received = sums over the subject's engagements; ratio = dealt / received
 *    (null when the subject received nothing).
 *  - Best / worst rank by ratio among TWO-SIDED exchanges only (both sides dealt damage):
 *    a one-sided 493/0 is free damage, not an exchange, so it cannot be the "best exchange".
 *    With no two-sided exchange, best and worst are null.
 *  - SPG damage is a subset breakdown, not an exclusion: spgDealt / spgReceived count the
 *    subject's damage with SPGs, inside the totals. Which vehicles are SPGs comes from the
 *    caller (gamedata class data lands with #42/#43); without a predicate, both are 0.
 */
export interface TradeExchange { other: number; start: number; end: number; dealt: number; received: number; ratio: number }
export interface TradeSummary {
  subject: number;
  dealt: number; received: number; ratio: number | null;
  spgDealt: number; spgReceived: number;
  exchanges: number;
  best: TradeExchange | null;
  worst: TradeExchange | null;
}

export interface TradeOptions {
  subject?: number;
  isSpg?: (vehicle: VehicleInfo) => boolean;
}

export function tradeSummary(tl: BattleTimeline, opts: TradeOptions = {}): TradeSummary {
  const subject = opts.subject ?? tl.recorder.vid;
  const byVid = new Map(tl.vehicles.map((v) => [v.vid, v]));
  let dealt = 0, received = 0, spgDealt = 0, spgReceived = 0, exchanges = 0;
  let best: TradeExchange | null = null, worst: TradeExchange | null = null;
  for (const e of buildEngagements(tl)) {
    if (e.a !== subject && e.b !== subject) continue;
    const other = e.a === subject ? e.b : e.a;
    const d = e.a === subject ? e.dealtByA : e.dealtByB;
    const r = e.a === subject ? e.dealtByB : e.dealtByA;
    dealt += d; received += r; exchanges++;
    const otherVeh = byVid.get(other);
    if (otherVeh && opts.isSpg?.(otherVeh)) { spgDealt += d; spgReceived += r; }
    if (d > 0 && r > 0) {
      const ex: TradeExchange = { other, start: e.start, end: e.end, dealt: d, received: r, ratio: d / r };
      if (!best || ex.ratio > best.ratio) best = ex;
      if (!worst || ex.ratio < worst.ratio) worst = ex;
    }
  }
  return { subject, dealt, received, ratio: received > 0 ? dealt / received : null, spgDealt, spgReceived, exchanges, best, worst };
}
