import { defineDetector } from "../detector";
import { configs, unseenCandidates, unseenDrops, hiddenDealt } from "@wotrep/analysis";
import type { Finding } from "../finding";
import { subject } from "./util";

/** HP lost out of view (no damage event behind it). Lists the likely sources as an estimate: the replay does not say who hit
 *  whom out of view. Thresholds live in packages/analysis/config/unseen-v0.json. Only the subject's drops are reported. */
export const unseenDamage = defineDetector({
  id: "unseen-damage", version: 1, needs: ["H", "T"], config: configs["unseen-v0"],
  detect({ tl, subject: subjectVid }) {
    const me = subject(tl, subjectVid); if (!me) return [];
    const hidden = hiddenDealt(tl);
    const out: Omit<Finding, "schema" | "id" | "detector" | "detectorVersion">[] = [];
    for (const d of unseenDrops(tl, me.vid)) {
      const cands = unseenCandidates(tl, d, hidden);
      out.push({
        vid: me.vid, kind: "info", tStart: d.t0, tEnd: d.t1, leadS: 3,
        cost: { hp: Math.round(d.unseen) }, confidence: cands.length ? Math.max(...cands.map((c) => c.confidence)) : 0,
        evidence: [
          ...cands.map((c) => ({ k: "line" as const, from: c.vid, to: me.vid, t: d.t0, style: "threat" as const })),
          { k: "number" as const, label: "unseen", value: Math.round(d.unseen), unit: "hp" },
        ],
        messageKey: "coach.unseenDamage", params: { hp: Math.round(d.unseen), n: cands.length },
      });
    }
    return out;
  },
});
