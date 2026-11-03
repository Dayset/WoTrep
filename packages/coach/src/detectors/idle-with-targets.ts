import { defineDetector } from "../detector";
import config from "../../config/idle-with-targets.json";
import { around, recorder } from "./util";
import { playerMetrics } from "@wotrep/analysis";
import type { DetectorInput } from "../detector";

type Detection = ReturnType<Parameters<typeof defineDetector>[0]["detect"]>[number];
void (null as unknown as DetectorInput);

/** Alive, no shot and almost no movement for a long stretch while an enemy was visible nearby. Cost = damage missed at the player's own average pace (an estimate, so confidence stays low). */
export const idleWithTargets = defineDetector({
  id: "idle-with-targets", version: 1, needs: ["P", "T"], config,
  detect({ tl, cfg }) {
    const me = recorder(tl); if (!me) return [];
    const end = Math.floor(tl.arena.durationS ?? 0), shots = tl.events.flatMap((e) => (e.k === "shot" && e.shooter === me.vid && e.t >= 0 ? [e.t] : []));
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
      const a = around(tl, t, cfg.viewM as number); if (!a || !a.me.alive) { flush(t); continue; }
      const shot = shots.some((s) => s > t - 1 && s <= t), moved = anchor ? Math.hypot(a.me.x - anchor.x, a.me.z - anchor.z) > (cfg.moveM as number) : false;
      if (shot || moved) { flush(t); }
      if (start < 0) { start = t; anchor = { x: a.me.x, z: a.me.z }; }
      if (a.enemies.length) lastSeen = t;
    }
    flush(end); return out;
  },
});
