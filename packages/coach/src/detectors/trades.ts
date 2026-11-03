import { defineDetector } from "../detector";
import badCfg from "../../config/bad-trade.json";
import wonCfg from "../../config/won-trade.json";
import { cluster, recorder } from "./util";
import { stateAt, type BattleTimeline } from "@wotrep/model";
import { wpOf } from "@wotrep/analysis";

/** Engagements = the recorder's own damage dealt and received, clustered in time. Per-hit data for the recorder is complete, so these numbers are exact. */
export function engagements(tl: BattleTimeline, gapS: number, vid?: number) {
  const me = vid != null ? tl.vehicles.find((v) => v.vid === vid) : recorder(tl); if (!me) return [];
  const ev = tl.events.flatMap((e) => (e.k === "damage" && e.amount > 0 && e.t >= 0 && (e.attacker === me.vid || e.target === me.vid) && e.attacker !== e.target ? [e] : []));
  return cluster(ev, gapS).map((c) => ({
    me, c, t0: c[0]!.t, t1: c.at(-1)!.t, first: c[0]!.attacker === me.vid ? "me" as const : "them" as const,
    dealt: c.filter((e) => e.attacker === me.vid).reduce((s, e) => s + e.amount, 0), got: c.filter((e) => e.target === me.vid).reduce((s, e) => s + e.amount, 0),
    foes: [...new Set(c.map((e) => (e.attacker === me.vid ? e.target : e.attacker)))],
    wp: Math.round((wpOf(stateAt(tl, c.at(-1)!.t), me.team) - wpOf(stateAt(tl, c[0]!.t - 0.001), me.team)) * 1000) / 1000,
  }));
}

export const badTrade = defineDetector({
  id: "bad-trade", version: 1, needs: ["H"], config: badCfg,
  detect({ tl, cfg }) {
    return engagements(tl, cfg.gapS as number).filter((g) => g.first === "me" && g.got >= (cfg.minLossShare as number) * g.me.maxHealth && g.dealt / g.got < (cfg.maxRatio as number)).map((g) => ({
      vid: g.me.vid, kind: "mistake" as const, tStart: g.t0, tEnd: g.t1, leadS: 3, cost: { hp: g.got - g.dealt, winProbDelta: Math.min(0, g.wp) }, confidence: 0.6,
      evidence: [...g.foes.map((f) => ({ k: "line" as const, from: g.me.vid, to: f, t: g.t0, style: "fire" as const })), { k: "path" as const, vid: g.me.vid, t0: g.t0 - 8, t1: g.t1, style: "actual" as const }, { k: "number" as const, label: "dealt", value: g.dealt, unit: "hp" }, { k: "number" as const, label: "received", value: g.got, unit: "hp" }],
      messageKey: "coach.badTrade", params: { dealt: g.dealt, got: g.got }, guide: "trading-hp",
    }));
  },
});

export const wonTrade = defineDetector({
  id: "won-trade", version: 1, needs: ["H"], config: wonCfg,
  detect({ tl, cfg }) {
    return engagements(tl, cfg.gapS as number).filter((g) => g.dealt >= (cfg.minDealtShare as number) * g.me.maxHealth && g.dealt >= (cfg.minRatio as number) * Math.max(g.got, 1)).map((g) => ({
      vid: g.me.vid, kind: "good" as const, tStart: g.t0, tEnd: g.t1, leadS: 3, cost: { winProbDelta: Math.max(0, g.wp) }, confidence: 0.6,
      evidence: [...g.foes.map((f) => ({ k: "line" as const, from: g.me.vid, to: f, t: g.t0, style: "fire" as const })), { k: "path" as const, vid: g.me.vid, t0: g.t0 - 8, t1: g.t1, style: "actual" as const }, { k: "number" as const, label: "dealt", value: g.dealt, unit: "hp" }, { k: "number" as const, label: "received", value: g.got, unit: "hp" }],
      messageKey: "coach.wonTrade", params: { dealt: g.dealt, got: g.got }, guide: "trading-hp",
    }));
  },
});
