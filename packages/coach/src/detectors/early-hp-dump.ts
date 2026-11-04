import { defineDetector } from "../detector";
import config from "../../config/early-hp-dump.json";
import { subject } from "./util";

/** Lost a large share of own HP in the opening minutes. Cost = the HP itself: exact for the recorder, a lower bound for any
 *  other subject (their damage taken is partly unseen). */
export const earlyHpDump = defineDetector({
  id: "early-hp-dump", version: 1, needs: ["H"], config,
  detect({ tl, cfg, subject: subjectVid }) {
    const me = subject(tl, subjectVid); if (!me || me.maxHealth <= 0) return [];
    const hits = tl.events.flatMap((e) => (e.k === "damage" && e.target === me.vid && e.t < (cfg.beforeS as number) && e.amount > 0 ? [e] : []));
    const lost = hits.reduce((s, e) => s + e.amount, 0);
    if (!hits.length || lost / me.maxHealth < (cfg.hpShare as number)) return [];
    const attackers = [...new Set(hits.map((h) => h.attacker))];
    return [{
      vid: me.vid, kind: "mistake", tStart: hits[0]!.t, tEnd: hits.at(-1)!.t, leadS: 3, cost: { hp: lost }, confidence: 0.6,
      evidence: [...attackers.map((a) => ({ k: "unit" as const, vid: a, t: hits[0]!.t })), { k: "number", label: "hp lost", value: lost, unit: "hp" }],
      messageKey: "coach.earlyHpDump", params: { hp: lost, pct: Math.round((lost / me.maxHealth) * 100), by: attackers.length }, guide: "first-two-minutes",
    }];
  },
});
