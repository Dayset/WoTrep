import { defineDetector } from "../detector";
import { configs, largestDrop, largestRaise } from "@wotrep/analysis";
import type { Finding } from "../finding";
import { subject } from "./util";

/** The biggest single win-probability raise for the subject's team, shown on the replay at the moment it happened. Points come from
 *  the per-hit credit in the analysis (impact.ts); the player named is the one who credited the most points in that swing. */
export const impactRaise = defineDetector({
  id: "impact-raise", version: 1, needs: ["H", "T"], config: configs["spikes-v0"],
  detect({ tl, subject: subjectVid }) {
    const me = subject(tl, subjectVid); if (!me) return [];
    const name = new Map(tl.vehicles.map((v) => [v.vid, v.name]));
    const out: Omit<Finding, "schema" | "id" | "detector" | "detectorVersion">[] = [];
    const r = largestRaise(tl, me.team as 1 | 2);
    const top = r?.players.find((p) => p.team === me.team && p.pts > 0);
    if (r) out.push({
      vid: me.vid, kind: "good", tStart: r.t0, tEnd: r.t1, leadS: 3, cost: { winProbDelta: r.team[me.team as 1 | 2] }, confidence: 0.6,
      evidence: [
        ...(top ? [{ k: "unit" as const, vid: top.vid, t: r.t0, label: "coach.ev.you" }] : []),
        { k: "number" as const, label: "raise", value: r.team[me.team as 1 | 2], unit: "pts" },
      ],
      messageKey: "coach.impactRaise", params: { pts: Math.round(r.team[me.team as 1 | 2] * 10) / 10, who: top ? name.get(top.vid) ?? "?" : "—", secs: Math.round(r.t1 - r.t0) },
    });
    // the biggest loss for the subject's team, with the enemy who gained most in that swing
    const d = largestDrop(tl, me.team as 1 | 2);
    if (d) {
      const foe = d.players.filter((p) => p.team !== me.team && p.pts > 0)[0];
      out.push({
        vid: me.vid, kind: "mistake", tStart: d.t0, tEnd: d.t1, leadS: 3, cost: { winProbDelta: d.team[me.team as 1 | 2] }, confidence: 0.6,
        evidence: [
          ...(foe ? [{ k: "unit" as const, vid: foe.vid, t: d.t0, label: "coach.ev.foe" }] : []),
          { k: "number" as const, label: "loss", value: d.team[me.team as 1 | 2], unit: "pts" },
        ],
        messageKey: "coach.impactDrop", params: { pts: Math.round(-d.team[me.team as 1 | 2] * 10) / 10, who: foe ? name.get(foe.vid) ?? "?" : "—", secs: Math.round(d.t1 - d.t0) },
      });
    }
    return out;
  },
});
