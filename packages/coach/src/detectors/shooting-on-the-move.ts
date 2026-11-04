import { defineDetector } from "../detector";
import cfgJson from "../../config/shooting-on-the-move.json";
import { subject } from "./util";
import { shootingStats } from "@wotrep/analysis";

/** Shooting on the move (COACHING wave 1): ≥ minFastShare of shots above minSpeedKmh with a
 *  pen rate on those shots below maxPenRate. One battle-level mistake spanning the first to the
 *  last fast shot. Guide: aim-time. Needs P (positions → speed) + T (shots).
 *
 *  Three v1 honesty notes, stated, not smoothed over:
 *  - "Hit rate" in COACHING is measured as PEN rate here. Damage events are pens only; a shot
 *    that hits but bounces leaves no damage event, and bounces need showDamageFromShot decoding
 *    (open, #30). Pen rate ≤ hit rate, so a pen rate below the bar is a conservative trigger —
 *    but the message says "penned", not "hit", and the param is penRate.
 *  - The "(non-LT)" qualifier is vacuous in v1: vehicleType strings carry no class, and the
 *    gamedata class lookup is #42 (parked). The detector applies to any subject until #42 lands.
 *  - Pen attribution: each damage event from the subject maps to the LATEST shot (any speed)
 *    with shot.t ≤ dmg.t ≤ shot.t + penWindowS (shell flight + packet skew, parity with #68's
 *    1 s clip window). If that shot is fast it pens; damage with no shot in window is
 *    unattributed (shot unobserved, e.g. out of area of interest). Shots with unknown speed
 *    (no track) are excluded from both counts.
 *  - Cost: damage the fast shots would have dealt at the subject's own slow-shot rate
 *    (fastShots × slowDmgPerShot − fastDmg, floored at 0) — the #75-style leave-one-out
 *    baseline. With no slow shots there is no baseline, so the cost is omitted (optional). */
export const shootingOnTheMove = defineDetector({
  id: "shooting-on-the-move", version: 1, needs: ["P", "T"], config: cfgJson,
  detect({ tl, cfg, subject: subjectVid }) {
    const me = subject(tl, subjectVid); if (!me) return [];
    const stats = shootingStats(tl, me.vid);
    const shots = stats.clips.flatMap((c) => c.shots).map((s) => ({ ...s, fast: s.speedKmh != null && s.speedKmh > (cfg.minSpeedKmh as number), penned: false, dmg: 0 }));
    const known = shots.filter((s) => s.speedKmh != null);
    if (!known.length) return [];
    const fastShots = shots.filter((s) => s.fast), slowShots = shots.filter((s) => s.speedKmh != null && !s.fast);
    if (fastShots.length / known.length < (cfg.minFastShare as number)) return [];
    const windowS = cfg.penWindowS as number;
    for (const d of tl.events) {
      if (d.k !== "damage" || d.attacker !== me.vid || d.amount <= 0) continue;
      let hit: (typeof shots)[number] | undefined;
      for (const s of shots) { if (s.t <= d.t && d.t <= s.t + windowS) hit = s; else if (s.t > d.t) break; }
      if (hit) { hit.penned = true; hit.dmg += d.amount; }
    }
    const penRate = fastShots.filter((s) => s.penned).length / fastShots.length;
    if (penRate >= (cfg.maxPenRate as number)) return [];
    const fastDmg = fastShots.reduce((s, x) => s + x.dmg, 0);
    const cost: { damageMissed?: number } = {};
    if (slowShots.length) {
      const missed = fastShots.length * (slowShots.reduce((s, x) => s + x.dmg, 0) / slowShots.length) - fastDmg;
      if (missed > 0) cost.damageMissed = Math.round(missed);
    }
    const t0 = fastShots[0]!.t, t1 = fastShots[fastShots.length - 1]!.t;
    return [{
      vid: me.vid, kind: "mistake" as const, tStart: t0, tEnd: t1, leadS: 3, cost, confidence: 0.6,
      evidence: [
        { k: "path" as const, vid: me.vid, t0: t0 - 8, t1, style: "actual" as const },
        { k: "number" as const, label: "fast", value: fastShots.length, unit: "shots" },
        { k: "number" as const, label: "total", value: known.length, unit: "shots" },
        { k: "number" as const, label: "penRate", value: Math.round(penRate * 100), unit: "%" },
      ],
      messageKey: "coach.shootingOnTheMove",
      params: { fast: fastShots.length, total: known.length, penRate: Math.round(penRate * 100) },
      guide: "aim-time",
    }];
  },
});
