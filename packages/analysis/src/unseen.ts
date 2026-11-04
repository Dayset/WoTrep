import { stateAt, type BattleTimeline } from "@wotrep/model";
import cfg from "../config/unseen-v0.json";

/** Unseen damage: HP a tank lost that no damage event explains (typically while it was a ghost, out of the recorder's view).
 *  `hiddenDealt` = official damage an enemy dealt minus the damage the replay itemised for it. Candidates for a drop are enemies
 *  with hidden damage that fired inside the drop window, scored by hidden damage × shots in the window. This is an estimate:
 *  the replay does not record who hit whom out of view, so the output is a ranked list with capped confidence, never a name. */
export interface UnseenDrop { vid: number; t0: number; t1: number; hpLost: number; seenDmg: number; unseen: number }
export interface UnseenCandidate { vid: number; share: number; hidden: number; shots: number; confidence: number }

const c = (k: keyof typeof cfg) => cfg[k].value;

export function hiddenDealt(tl: BattleTimeline): Map<number, number> {
  const seen = new Map<number, number>();
  for (const e of tl.events) if (e.k === "damage" && e.amount > 0) seen.set(e.attacker, (seen.get(e.attacker) ?? 0) + e.amount);
  const out = new Map<number, number>();
  for (const v of tl.vehicles) {
    const off = tl.results?.players[v.vid]?.damageDealt ?? 0, h = off - (seen.get(v.vid) ?? 0);
    if (h > 0) out.set(v.vid, h);
  }
  return out;
}

/** Drops in `vid`'s HP that the itemised damage does not explain. The window opens at the last live sample before the drop. */
export function unseenDrops(tl: BattleTimeline, vid: number): UnseenDrop[] {
  const end = Math.floor(tl.arena.durationS ?? Math.max(0, ...tl.events.map((e) => e.t)));
  const out: UnseenDrop[] = [];
  // The window opens when the HP last changed, not at the last live sample: HP can stay stale while the tank is live.
  let lastT = -1, lastHp = -1;
  for (let t = 0; t <= end; t++) {
    const u = stateAt(tl, t).units.find((x) => x.vid === vid);
    if (!u || u.known !== "live") continue;
    if (lastT < 0) { lastT = t; lastHp = u.hp; continue; }
    if (u.hp === lastHp) continue;
    if (u.hp < lastHp) {
      const hpLost = lastHp - u.hp;
      const seenDmg = tl.events.reduce((s, e) => (e.k === "damage" && e.target === vid && e.t > lastT && e.t <= t ? s + e.amount : s), 0);
      const unseen = hpLost - seenDmg;
      if (unseen >= (c("minUnseenHp") as number)) out.push({ vid, t0: lastT, t1: t, hpLost, seenDmg, unseen });
    }
    lastT = t; lastHp = u.hp;
  }
  return out;
}

/** Likely sources of one drop: enemies with hidden damage that fired inside the window, ranked by hidden × shots. */
export function unseenCandidates(tl: BattleTimeline, drop: UnseenDrop, hidden = hiddenDealt(tl)): UnseenCandidate[] {
  const team = new Map(tl.vehicles.map((v) => [v.vid, v.team]));
  const mine = team.get(drop.vid);
  const shots = new Map<number, number>();
  for (const e of tl.events) if (e.k === "shot" && e.t > drop.t0 && e.t <= drop.t1 && team.get(e.shooter) !== undefined && team.get(e.shooter) !== mine) shots.set(e.shooter, (shots.get(e.shooter) ?? 0) + 1);
  const score = [...hidden].flatMap(([v, h]) => { const n = shots.get(v) ?? 0; return n > 0 && team.get(v) !== mine ? [{ vid: v, hidden: h, shots: n, s: h * n }] : []; });
  const total = score.reduce((a, b) => a + b.s, 0);
  if (!total) return [];
  return score.sort((a, b) => b.s - a.s).slice(0, c("topN") as number).map((x) => ({ vid: x.vid, share: x.s / total, hidden: x.hidden, shots: x.shots, confidence: Math.min(c("maxConfidence") as number, x.s / total) }));
}

export interface UnseenAllocation {
  victim: number; t0: number; t1: number; unseen: number;
  /** hidden damage assigned to each source from its remaining budget, in share order */
  sources: { vid: number; hp: number }[];
  /** what no source could cover within its budget */
  unexplained: number;
  /** the top-ranked candidate, shown even when its budget is used up by an earlier drop */
  topSuspect: number | null;
}

/** Allocation pass: drops are processed in time order. Each source's hidden damage is a budget spent once; each drop takes
 *  its candidates in share order until the drop is covered or the candidates run out. The leftover stays unexplained, and the
 *  top-ranked candidate is still reported as the #1 suspect. Estimate only: the budgets are the official totals minus the itemised ones. */
export function allocateUnseen(tl: BattleTimeline): UnseenAllocation[] {
  const hidden = hiddenDealt(tl);
  const budget = new Map(hidden);
  const drops: UnseenDrop[] = [];
  for (const v of tl.vehicles) drops.push(...unseenDrops(tl, v.vid));
  drops.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  return drops.map((d) => {
    const cands = unseenCandidates(tl, d, hidden);
    let left = d.unseen;
    const sources: { vid: number; hp: number }[] = [];
    for (const c of cands) {
      if (left <= 0) break;
      const avail = budget.get(c.vid) ?? 0;
      const take = Math.min(avail, left);
      if (take <= 0) continue;
      budget.set(c.vid, avail - take); left -= take; sources.push({ vid: c.vid, hp: Math.round(take) });
    }
    return { victim: d.vid, t0: d.t0, t1: d.t1, unseen: Math.round(d.unseen), sources, unexplained: Math.max(0, Math.round(left)), topSuspect: cands[0]?.vid ?? null };
  });
}

/** Status of one drop after allocation. "allocated" = the unexplained HP is within `allocatedShare` of the unseen HP (an estimate
 *  that adds up, not proof of who fired). "partial" = some sources were found but HP is left. "unresolved" = no source could be placed. */
export type UnseenStatus = "allocated" | "partial" | "unresolved";
export function unseenStatus(a: Pick<UnseenAllocation, "unseen" | "unexplained" | "sources">): UnseenStatus {
  if (a.unseen <= 0 || a.unexplained <= a.unseen * (cfg.allocatedShare.value as number)) return "allocated";
  return a.sources.length ? "partial" : "unresolved";
}
