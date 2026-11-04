import { defineDetector } from "../detector";
import { configs, allocateUnseen } from "@wotrep/analysis";
import type { Finding } from "../finding";
import { subject } from "./util";

/** HP lost out of view (no damage event behind it). Shows the #1 suspect and whatever the allocation pass could not cover.
 *  An estimate: the replay does not say who hit whom out of view. Thresholds: packages/analysis/config/unseen-v0.json. */
export const unseenDamage = defineDetector({
  id: "unseen-damage", version: 1, needs: ["H", "T"], config: configs["unseen-v0"],
  detect({ tl, subject: subjectVid }) {
    const me = subject(tl, subjectVid); if (!me) return [];
    const name = new Map(tl.vehicles.map((v) => [v.vid, v.name]));
    const out: Omit<Finding, "schema" | "id" | "detector" | "detectorVersion">[] = [];
    for (const a of allocateUnseen(tl)) {
      if (a.victim !== me.vid) continue;
      const suspect = a.topSuspect != null ? name.get(a.topSuspect) ?? "?" : "—";
      out.push({
        vid: me.vid, kind: "info", tStart: a.t0, tEnd: a.t1, leadS: 3,
        cost: { hp: a.unseen }, confidence: a.sources[0] ? Math.min(1, a.sources[0].hp / Math.max(1, a.unseen)) : 0,
        evidence: [
          ...a.sources.map((s) => ({ k: "line" as const, from: s.vid, to: me.vid, t: a.t0, style: "threat" as const })),
          { k: "number" as const, label: "unseen", value: a.unseen, unit: "hp" },
          { k: "number" as const, label: "unexplained", value: a.unexplained, unit: "hp" },
        ],
        messageKey: "coach.unseenDamage", params: { hp: a.unseen, left: a.unexplained, suspect },
      });
    }
    return out;
  },
});
