import { defineDetector } from "../detector";
import { configs, largestRaise } from "@wotrep/analysis";
import type { Finding } from "../finding";
import { subject } from "./util";

/** The biggest single win-probability raise for the subject's team, shown on the replay at the moment it happened. Points come from
 *  the per-hit credit in the analysis (impact.ts); the player named is the one who credited the most points in that swing. */
export const impactRaise = defineDetector({
  id: "impact-raise", version: 1, needs: ["H", "T"], config: configs["spikes-v0"],
  detect({ tl, subject: subjectVid }) {
    const me = subject(tl, subjectVid); if (!me) return [];
    const r = largestRaise(tl, me.team as 1 | 2); if (!r) return [];
    const name = new Map(tl.vehicles.map((v) => [v.vid, v.name]));
    const top = r.players.find((p) => p.team === me.team && p.pts > 0);
    const out: Omit<Finding, "schema" | "id" | "detector" | "detectorVersion">[] = [{
      vid: me.vid, kind: "good", tStart: r.t0, tEnd: r.t1, leadS: 3, cost: { winProbDelta: r.team[me.team as 1 | 2] }, confidence: 0.6,
      evidence: [
        ...(top ? [{ k: "unit" as const, vid: top.vid, t: r.t0, label: "coach.ev.you" }] : []),
        { k: "number" as const, label: "raise", value: r.team[me.team as 1 | 2], unit: "pts" },
      ],
      messageKey: "coach.impactRaise", params: { pts: Math.round(r.team[me.team as 1 | 2] * 10) / 10, who: top ? name.get(top.vid) ?? "?" : "—", secs: Math.round(r.t1 - r.t0) },
    }];
    return out;
  },
});
