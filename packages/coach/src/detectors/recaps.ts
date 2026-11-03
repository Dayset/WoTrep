import { defineDetector } from "../detector";
import deathCfg from "../../config/death-recap.json";
import survCfg from "../../config/survived-unused-hp.json";
import { recorder } from "./util";

/** Info card when the recorder dies: who killed them and where the damage in the last seconds came from. */
export const deathRecap = defineDetector({
  id: "death-recap", version: 1, needs: ["H"], config: deathCfg,
  detect({ tl, cfg }) {
    const me = recorder(tl); if (!me) return [];
    const k = tl.events.find((e) => e.k === "kill" && e.victim === me.vid); if (!k || k.k !== "kill") return [];
    const hits = tl.events.flatMap((e) => (e.k === "damage" && e.target === me.vid && e.t <= k.t && e.t >= k.t - (cfg.windowS as number) ? [e] : []));
    const by = new Map<number, number>(); for (const h of hits) by.set(h.attacker, (by.get(h.attacker) ?? 0) + h.amount);
    const lost = hits.reduce((s, h) => s + h.amount, 0), main = [...by].sort((a, b) => b[1] - a[1])[0];
    return [{
      vid: me.vid, kind: "info" as const, tStart: hits[0]?.t ?? k.t, tEnd: k.t, leadS: 5, cost: { hp: lost }, confidence: 0.9,
      evidence: [...[...by.keys()].map((a) => ({ k: "line" as const, from: a, to: me.vid, t: k.t, style: "fire" as const })), { k: "path" as const, vid: me.vid, t0: k.t - 10, t1: k.t, style: "actual" as const }, { k: "number" as const, label: "lost in last window", value: lost, unit: "hp" }],
      messageKey: "coach.deathRecap", params: { lost, sources: by.size, killer: tl.vehicles.find((v) => v.vid === k.killer)?.name ?? "?", main: main ? tl.vehicles.find((v) => v.vid === main[0])?.name ?? "?" : "?", mainHp: main?.[1] ?? 0, secs: Math.round(cfg.windowS as number) }, guide: "why-you-died",
    }];
  },
});

/** Team lost while the recorder survived with most of their HP and dealt little. */
export const survivedUnusedHp = defineDetector({
  id: "survived-unused-hp", version: 1, needs: ["H"], config: survCfg,
  detect({ tl, cfg }) {
    const me = recorder(tl), w = tl.arena.winnerTeam; if (!me || !tl.results || w == null || w === 0 || w === me.team) return [];
    if (tl.events.some((e) => e.k === "kill" && e.victim === me.vid)) return [];
    const hp = me.maxHealth - tl.events.reduce((s, e) => s + (e.k === "damage" && e.target === me.vid ? e.amount : 0), 0), dealt = tl.results.players[me.vid]?.damageDealt ?? 0;
    if (hp < (cfg.hpShare as number) * me.maxHealth || dealt >= (cfg.dealtShare as number) * me.maxHealth) return [];
    const end = tl.arena.durationS ?? 0;
    return [{ vid: me.vid, kind: "info" as const, tStart: Math.max(0, end - 30), tEnd: end, leadS: 3, cost: { damageMissed: Math.max(0, me.maxHealth - dealt) }, confidence: 0.8, evidence: [{ k: "number" as const, label: "HP left", value: Math.round(hp), unit: "hp" }], messageKey: "coach.survivedUnusedHp", params: { hp: Math.round(hp), dealt }, guide: "using-your-hp" }];
  },
});
