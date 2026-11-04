import { defineDetector } from "../detector";
import cfg from "../../config/collision.json";
import { cluster, isRamming, subject } from "./util";
import type { BattleTimeline } from "@wotrep/model";
import type { Finding } from "../finding";

/** Ramming between the subject and another vehicle. Contact damage is not a trade: it is never a good play and never
 *  counts as an engagement. Collisions with an ally are a mistake (the team loses HP for nothing); with a foe they are
 *  reported as info only, since they are not a choice the subject made to deal damage. */
export const collision = defineDetector({
  id: "collision", version: 1, needs: ["H"], config: cfg,
  detect({ tl, cfg, subject: subjectVid }) {
    const me = subject(tl, subjectVid); if (!me) return [];
    const team = new Map(tl.vehicles.map((v) => [v.vid, v.team]));
    const ev = tl.events.flatMap((e) => (e.k === "damage" && isRamming(e) && e.t >= 0 && e.amount > 0 && (e.attacker === me.vid || e.target === me.vid) && e.attacker !== e.target ? [e] : []));
    const byOther = new Map<number, typeof ev>();
    for (const e of ev) { const o = e.attacker === me.vid ? e.target : e.attacker; byOther.set(o, [...(byOther.get(o) ?? []), e]); }
    const out: Omit<Finding, "schema" | "id" | "detector" | "detectorVersion">[] = [];
    for (const [other, list] of byOther) {
      for (const c of cluster(list, cfg.gapS as number)) {
        const dealt = c.filter((e) => e.attacker === me.vid).reduce((s, e) => s + e.amount, 0), got = c.filter((e) => e.target === me.vid).reduce((s, e) => s + e.amount, 0);
        const ally = team.get(other) === me.team;
        out.push({
          vid: me.vid, kind: ally ? "mistake" : "info", tStart: c[0]!.t, tEnd: c.at(-1)!.t, leadS: 3,
          cost: { hp: ally ? dealt + got : 0 }, confidence: 0.6,
          evidence: [{ k: "line", from: me.vid, to: other, t: c[0]!.t, style: "fire" }, { k: "number", label: "dealt", value: dealt }, { k: "number", label: "got", value: got }],
          messageKey: "coach.collision", params: { dealt, got, ally: ally ? 1 : 0 },
        });
      }
    }
    return out;
  },
});
