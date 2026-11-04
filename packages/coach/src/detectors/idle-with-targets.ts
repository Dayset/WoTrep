import { defineDetector } from "../detector";
import config from "../../config/idle-with-targets.json";
import { around, subject } from "./util";
import { estimateReload, playerMetrics, reloadStateAt } from "@wotrep/analysis";

type Detection = ReturnType<Parameters<typeof defineDetector>[0]["detect"]>[number];

/** Alive, no shot and almost no movement for a long stretch while an enemy was visible nearby. Cost = damage missed at the player's own average pace (an estimate, so confidence stays low).
 *  Reloading time is excluded (#80 scope): a second spent reloading flushes the stretch like a shot
 *  does, and no stretch starts mid-reload — a reload always follows shots, and shots already flush,
 *  so this is exactly equivalent to subtracting reload seconds from the stretch. The exclusion needs
 *  a trustworthy autoloader estimate, so it is skipped for single-shot guns and low-confidence
 *  estimates (those subjects keep the old behaviour). The scope's spotting exclusion is still
 *  vacuous: no spot events exist in v1 data.
 *  Only seconds with a live position count: for a teammate the recorder sees a ghost (last known spot) most of the time, and a ghost
 *  cannot show movement, so ghost seconds must not extend an idle stretch. */
export const idleWithTargets = defineDetector({
  id: "idle-with-targets", version: 1, needs: ["P", "T", "R"], config,
  detect({ tl, cfg, subject: subjectVid }) {
    const me = subject(tl, subjectVid); if (!me) return [];
    const end = Math.floor(tl.arena.durationS ?? 0), shots = tl.events.flatMap((e) => (e.k === "shot" && e.shooter === me.vid && e.t >= 0 ? [e.t] : []));
    const est = estimateReload(shots);
    const reloadKnown = est.clipSize > 1 && est.confidence >= (cfg.minConfidence as number) && est.reloadS != null;
    const dpm = playerMetrics(tl).find((p) => p.vid === me.vid)?.dpm ?? 0, out: Detection[] = [];
    let start = -1, anchor: { x: number; z: number } | null = null, lastSeen = -1;
    const flush = (until: number) => {
      if (start >= 0 && lastSeen - start >= (cfg.idleS as number)) {
        const secs = lastSeen - start; out.push({
          vid: me.vid, kind: "mistake" as const, tStart: start, tEnd: lastSeen, leadS: 3, cost: { damageMissed: Math.round((dpm * secs) / 60) }, confidence: 0.5,
          evidence: [{ k: "unit" as const, vid: me.vid, t: start, label: "coach.ev.you" }, { k: "path" as const, vid: me.vid, t0: start, t1: lastSeen, style: "actual" as const }, { k: "number" as const, label: "idle", value: Math.round(secs), unit: "s" }], messageKey: "coach.idleWithTargets", params: { secs: Math.round(secs), dmg: Math.round((dpm * secs) / 60) }, guide: "stay-useful",
        });
      }
      void until; start = -1; anchor = null; lastSeen = -1;
    };
    for (let t = 0; t <= end; t++) {
      const a = around(tl, t, cfg.viewM as number, me.vid); if (!a || !a.me.alive) { flush(t); continue; }
      // A ghost position is the last spotted one, not where the tank is: a stretch cannot be judged idle from it (no movement can be seen).
      if (a.me.known !== "live") { flush(t); continue; }
      const shot = shots.some((s) => s > t - 1 && s <= t), moved = anchor ? Math.hypot(a.me.x - anchor.x, a.me.z - anchor.z) > (cfg.moveM as number) : false;
      const reloading = reloadKnown && reloadStateAt(shots, est, t).state === "reloading";
      if (shot || moved || reloading) { flush(t); }
      if (start < 0 && !reloading) { start = t; anchor = { x: a.me.x, z: a.me.z }; }
      if (a.enemies.length) lastSeen = t;
    }
    flush(end); return out;
  },
});
