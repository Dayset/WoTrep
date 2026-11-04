import { defineDetector } from "../detector";
import deathCfg from "../../config/death-recap.json";
import survCfg from "../../config/survived-unused-hp.json";
import { estimateReload, reloadStateAt, shotTimes } from "@wotrep/analysis";
import { around, subject } from "./util";

/** Info card when the subject dies: who killed them and where the damage in the last seconds came from,
 *  plus the nearest ally at the death and the subject's own reload state (a timer when mid-reload).
 *  Two scope items are deliberately absent, not forgotten: "time spotted before first hit" has no signal
 *  in v1 data (enemy vision of the subject is never recorded — the track's visible intervals are the
 *  recorder's view, meaningless for the recorder subject), and the "HP curve" has no series evidence
 *  kind in the findings contract v1 — the lost-HP number is its scalar summary. */
export const deathRecap = defineDetector({
  id: "death-recap", version: 1, needs: ["H", "T", "R"], config: deathCfg,
  detect({ tl, cfg, subject: subjectVid }) {
    const me = subject(tl, subjectVid); if (!me) return [];
    const k = tl.events.find((e) => e.k === "kill" && e.victim === me.vid); if (!k || k.k !== "kill") return [];
    const hits = tl.events.flatMap((e) => (e.k === "damage" && e.target === me.vid && e.t <= k.t && e.t >= k.t - (cfg.windowS as number) ? [e] : []));
    const by = new Map<number, number>(); for (const h of hits) by.set(h.attacker, (by.get(h.attacker) ?? 0) + h.amount);
    const lost = hits.reduce((s, h) => s + h.amount, 0), main = [...by].sort((a, b) => b[1] - a[1])[0];
    const near = around(tl, k.t, 0, subjectVid)?.nearestAlly ?? null;
    const ally = near ? tl.vehicles.find((v) => v.vid === near.vid)?.name ?? "?" : "?";
    const reload = reloadStateAt(shotTimes(tl, me.vid), estimateReload(shotTimes(tl, me.vid)), k.t);
    const evidence: { k: "line"; from: number; to: number; t: number; style: "fire" }[] = [...by.keys()].map((a) => ({ k: "line" as const, from: a, to: me.vid, t: k.t, style: "fire" as const }));
    return [{
      vid: me.vid, kind: "info" as const, tStart: hits[0]?.t ?? k.t, tEnd: k.t, leadS: 5, cost: { hp: lost }, confidence: 0.9,
      evidence: [...evidence, { k: "path" as const, vid: me.vid, t0: k.t - 10, t1: k.t, style: "actual" as const }, { k: "number" as const, label: "lost in last window", value: lost, unit: "hp" },
        ...(near ? [{ k: "number" as const, label: "nearest ally m", value: Math.round(near.d), unit: "m" }] : []),
        ...(reload.state === "reloading" ? [{ k: "timer" as const, vid: me.vid, t: k.t, label: "reload", secondsLeft: Math.round(reload.secondsLeft * 100) / 100 }] : [])],
      messageKey: "coach.deathRecap", params: { lost, sources: by.size, killer: tl.vehicles.find((v) => v.vid === k.killer)?.name ?? "?", main: main ? tl.vehicles.find((v) => v.vid === main[0])?.name ?? "?" : "?", mainHp: main?.[1] ?? 0, secs: Math.round(cfg.windowS as number), ally }, guide: "why-you-died",
    }];
  },
});

/** Team lost while the subject survived with most of their HP and dealt little. */
export const survivedUnusedHp = defineDetector({
  id: "survived-unused-hp", version: 1, needs: ["H"], config: survCfg,
  detect({ tl, cfg, subject: subjectVid }) {
    const me = subject(tl, subjectVid), w = tl.arena.winnerTeam; if (!me || !tl.results || w == null || w === 0 || w === me.team) return [];
    if (tl.events.some((e) => e.k === "kill" && e.victim === me.vid)) return [];
    const hp = me.maxHealth - tl.events.reduce((s, e) => s + (e.k === "damage" && e.target === me.vid ? e.amount : 0), 0), dealt = tl.results.players[me.vid]?.damageDealt ?? 0;
    if (hp < (cfg.hpShare as number) * me.maxHealth || dealt >= (cfg.dealtShare as number) * me.maxHealth) return [];
    const end = tl.arena.durationS ?? 0;
    return [{ vid: me.vid, kind: "info" as const, tStart: Math.max(0, end - 30), tEnd: end, leadS: 3, cost: { damageMissed: Math.max(0, me.maxHealth - dealt) }, confidence: 0.8, evidence: [{ k: "number" as const, label: "HP left", value: Math.round(hp), unit: "hp" }], messageKey: "coach.survivedUnusedHp", params: { hp: Math.round(hp), dealt }, guide: "using-your-hp" }];
  },
});
