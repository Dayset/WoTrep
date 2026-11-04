import { defineDetector } from "../detector";
import cfgJson from "../../config/punished-reload.json";
import { estimateReload } from "@wotrep/analysis";
import type { Finding } from "../finding";
import { subject } from "./util";

/** Punished reload (E7-04, COACHING.md wave 1, good play): the subject dealt damage to an enemy
 *  while that enemy's estimated reload had at least minRemainingS left. One finding per reload
 *  window, aggregating all qualifying damage in it; cost.damageMissed is NEGATIVE (damage gained).
 *
 *  A reload window opens only after a FULL clip (burst length reached the estimated clip size) —
 *  a partial burst's end is a pause, not a reload (same guard as peek-into-loaded-autoloader).
 *  The window closes at the earliest of: last shot + estimated reload, the enemy's next burst,
 *  the enemy's death, the battle end. "Remaining" is measured against that capped end, so it is
 *  the time the enemy genuinely could not shoot back. Single-shot guns (clipSize 1) and
 *  low-confidence estimates (< minConfidence) never open a window: for a single-shot gun every
 *  gap is a cycle, not a reload worth praising.
 */
export const punishedReload = defineDetector({
  id: "punished-reload", version: 1, needs: ["H", "T", "R"], config: cfgJson,
  detect({ tl, cfg, subject: subjectVid }) {
    const me = subject(tl, subjectVid);
    if (!me) return [];
    const minRemainingS = cfg.minRemainingS as number, minConfidence = cfg.minConfidence as number;
    const end = tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0;
    const out: Omit<Finding, "schema" | "id" | "detector" | "detectorVersion">[] = [];
    for (const foe of tl.vehicles.filter((u) => u.team !== me.team)) {
      const shots = tl.events.filter((e) => e.k === "shot" && e.shooter === foe.vid).map((e) => e.t);
      if (shots.length < 2) continue;
      const est = estimateReload(shots);
      if (est.clipSize <= 1 || est.confidence < minConfidence || est.reloadS == null) continue;
      const bursts: number[][] = [[shots[0]!]];
      for (let i = 1; i < shots.length; i++) {
        if (shots[i]! - shots[i - 1]! > est.intraMaxS) bursts.push([]);
        bursts[bursts.length - 1]!.push(shots[i]!);
      }
      const deathT = tl.events.find((e) => e.k === "kill" && e.victim === foe.vid)?.t;
      const dmg = tl.events.filter((e) => e.k === "damage" && e.attacker === me.vid && e.target === foe.vid);
      for (let i = 0; i < bursts.length; i++) {
        const b = bursts[i]!;
        if (b.length < est.clipSize) continue;
        const lastShot = b[b.length - 1]!;
        const nextShot = bursts[i + 1]?.[0];
        const windowEnd = Math.min(lastShot + est.reloadS, nextShot ?? Infinity, deathT ?? Infinity, end);
        if (windowEnd <= lastShot) continue;
        const hits = dmg.filter((e) => e.t >= lastShot && e.t <= windowEnd && windowEnd - e.t >= minRemainingS);
        if (!hits.length) continue;
        const total = hits.reduce((s, e) => s + (e.k === "damage" ? e.amount : 0), 0);
        const firstT = hits[0]!.t, lastT = hits[hits.length - 1]!.t;
        const name = tl.vehicles.find((v) => v.vid === foe.vid)?.name ?? String(foe.vid);
        out.push({
          vid: me.vid, kind: "good" as const, tStart: firstT, tEnd: lastT, leadS: 3,
          cost: { damageMissed: -total }, confidence: 0.6,
          evidence: [
            { k: "unit" as const, vid: foe.vid, t: firstT, label: "target" },
            { k: "timer" as const, vid: foe.vid, t: firstT, label: "reload", secondsLeft: Math.round((windowEnd - firstT) * 100) / 100 },
            { k: "number" as const, label: "damage", value: total, unit: "hp" },
          ],
          messageKey: "coach.punishedReload", params: { dmg: total, enemy: name }, guide: "autoloader-timing",
        });
      }
    }
    return out;
  },
});
