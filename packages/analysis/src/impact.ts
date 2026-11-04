import { stateAt, type BattleTimeline, type Team } from "@wotrep/model";
import { wpOf } from "./wp";

/** Win-probability added (docs/METRICS.md §3.2): every damage event moves WP, `ΔWP = WP(after) − WP(before)`,
 *  credited to the attacker in the attacker's own team's percentage points, and logged against the target as the
 *  mirror (−ΔWP, the target's team's points lost). `Impact = Σ credited ΔWP` in percentage points.
 *
 *  Tick grouping: several damage events can share one timestamp (the fixture has 35 multi-damage ticks), and
 *  stateAt(t) already includes all damage at t, so a per-event before/after would credit the whole tick's ΔWP to
 *  each event in it. Instead each tick contributes one ΔWP, split among its credited events pro-rata by damage
 *  amount. A single-event tick is exactly the spec's before/after. Zero-sum holds per tick by construction: the
 *  two teams' credited sums are +ΔWP and −ΔWP.
 *
 *  Kill flips: a kill event also moves WP (the alive-flip removes a ~0-HP unit's sqrt(1) from its team's sum) even
 *  when its timestamp carries no damage. Damage-only crediting leaves that residue uncredited — measured at
 *  2.23 points on the fixture, outside the §3.2 acceptance of ±2 — so kill-only ticks are credited to the killer
 *  (split equally if several kills share the tick). A kill that shares a damage tick rides with that tick's damage
 *  split: stateAt(t) applies damage and kill atomically, so the flip cannot be separated from the tick's damage —
 *  a bounded attribution approximation that never affects conservation, since the tick's ΔWP is fully attributed
 *  either way. With kill ticks included, per-team credited sums telescope to the full WP swing exactly.
 *  Spotting/track assist credit is omitted: it needs personal events (E1-11, #30), which do not exist in v1.
 *  Damage events whose attacker is not a known vehicle are skipped entirely (excluded from the tick total too),
 *  so the credited splits still sum to the tick's ΔWP exactly.
 */
export interface ImpactEvent {
  t: number; attacker: number; target: number; amount: number; dw: number;
  /** "kill": a kill-only tick's flip credit (amount 0); "damage": ordinary damage credit. */
  kind: "damage" | "kill";
}

export function impactEvents(tl: BattleTimeline): ImpactEvent[] {
  const teamOf = new Map(tl.vehicles.map((v) => [v.vid, v.team]));
  const dmgByTick = new Map<number, { target: number; attacker: number; amount: number; team: Team }[]>();
  const killByTick = new Map<number, { victim: number; killer: number; team: Team }[]>();
  for (const e of tl.events) {
    if (e.k === "damage") {
      const team = teamOf.get(e.attacker);
      if (team === undefined) continue; // unknown attacker: uncredited, and excluded from the tick total
      const tick = dmgByTick.get(e.t) ?? [];
      tick.push({ target: e.target, attacker: e.attacker, amount: e.amount, team });
      dmgByTick.set(e.t, tick);
    } else if (e.k === "kill") {
      const team = teamOf.get(e.killer);
      if (team === undefined) continue;
      const tick = killByTick.get(e.t) ?? [];
      tick.push({ victim: e.victim, killer: e.killer, team });
      killByTick.set(e.t, tick);
    }
  }
  const out: ImpactEvent[] = [];
  const ticks = new Set([...dmgByTick.keys(), ...killByTick.keys()]);
  for (const t of [...ticks].sort((a, b) => a - b)) {
    const dw1 = (wpOf(stateAt(tl, t), 1) - wpOf(stateAt(tl, t - 0.001), 1)) * 100;
    const dmg = dmgByTick.get(t) ?? [];
    const total = dmg.reduce((s, e) => s + e.amount, 0);
    if (total > 0) {
      for (const e of dmg) {
        const dw = (e.team === 1 ? dw1 : -dw1) * (e.amount / total);
        out.push({ t, attacker: e.attacker, target: e.target, amount: e.amount, dw, kind: "damage" });
      }
    } else {
      const kills = killByTick.get(t) ?? [];
      for (const k of kills) {
        const dw = (k.team === 1 ? dw1 : -dw1) / kills.length;
        out.push({ t, attacker: k.killer, target: k.victim, amount: 0, dw, kind: "kill" });
      }
    }
  }
  return out;
}

export interface PlayerImpact {
  vid: number; team: Team; name: string;
  /** Σ credited ΔWP as attacker, own-team percentage points. This is the headline Impact (damage + kill flips). */
  dealt: number;
  /** Σ mirrored ΔWP as target, own-team percentage points (negative when hurt). Logged-against stat, not summed into dealt. */
  taken: number;
  damage: number; hits: number; kills: number;
  /** dealt per minute of battle (minute = floor(t / 60)); the per-minute series. */
  byMinute: number[];
}

export function impactByPlayer(tl: BattleTimeline): PlayerImpact[] {
  const end = tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0;
  const nMin = Math.max(1, Math.ceil(end / 60));
  const rows = new Map<number, PlayerImpact>();
  for (const v of tl.vehicles) {
    rows.set(v.vid, { vid: v.vid, team: v.team, name: v.name, dealt: 0, taken: 0, damage: 0, hits: 0, kills: 0, byMinute: new Array<number>(nMin).fill(0) });
  }
  for (const e of impactEvents(tl)) {
    const a = rows.get(e.attacker);
    if (a) {
      a.dealt += e.dw;
      a.byMinute[Math.min(Math.floor(e.t / 60), nMin - 1)]! += e.dw;
      if (e.kind === "damage") { a.damage += e.amount; a.hits += 1; } else a.kills += 1;
    }
    const g = rows.get(e.target);
    if (g) g.taken += -e.dw;
  }
  return [...rows.values()];
}
