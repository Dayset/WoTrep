import { defineDetector } from "../detector";
import config from "../../config/isolated-under-fire.json";
import { around, cluster, subject } from "./util";

/** Took damage while far from every ally and facing several visible enemies. Cost = the HP lost in that stretch (exact). */
export const isolatedUnderFire = defineDetector({
  id: "isolated-under-fire", version: 1, needs: ["P", "H"], config,
  detect({ tl, cfg, subject: subjectVid }) {
    const me = subject(tl, subjectVid); if (!me) return [];
    const hits = tl.events.flatMap((e) => (e.k === "damage" && e.target === me.vid && e.amount > 0 && e.t >= 0 ? [e] : []));
    const bad = hits.filter((h) => { const a = around(tl, Math.floor(h.t), cfg.enemyRangeM as number, me.vid); return !!a && !!a.nearestAlly && a.nearestAlly.d > (cfg.allyDistM as number) && a.enemies.length >= (cfg.minEnemies as number); });
    return cluster(bad, cfg.mergeS as number).map((c) => {
      const a = around(tl, Math.floor(c[0]!.t), cfg.enemyRangeM as number, me.vid)!, hp = c.reduce((s, h) => s + h.amount, 0);
      return {
        vid: me.vid, kind: "mistake" as const, tStart: c[0]!.t, tEnd: c.at(-1)!.t, leadS: 3, cost: { hp }, confidence: 0.6,
        evidence: [...a.enemies.map((e) => ({ k: "line" as const, from: e.vid, to: me.vid, t: c[0]!.t, style: "threat" as const })), { k: "unit" as const, vid: a.nearestAlly!.vid, t: c[0]!.t, label: "coach.ev.nearestAlly" }, { k: "zone" as const, x: a.me.x, z: a.me.z, r: cfg.enemyRangeM as number, style: "exposed" as const }, { k: "path" as const, vid: me.vid, t0: c[0]!.t - 10, t1: c.at(-1)!.t, style: "actual" as const }, { k: "number" as const, label: "nearest ally", value: Math.round(a.nearestAlly!.d), unit: "m" }],
        messageKey: "coach.isolatedUnderFire", params: { hp, dist: Math.round(a.nearestAlly!.d), enemies: a.enemies.length }, guide: "stay-in-support",
      };
    });
  },
});
