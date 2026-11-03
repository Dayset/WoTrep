import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { playerHeuristics, playerMetrics, playerStats, recorderHeuristics, wpOf, wpSeries } from "../src/index";
import { stateAt } from "@wotrep/model";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("analysis on the fixture", () => {
  it("win probability starts near even and the winning team ends ahead", () => {
    const s = wpSeries(tl, tl.recorder.team);
    expect(Math.abs(s.wp[0]! - 0.5)).toBeLessThan(0.05);
    expect(s.wp.at(-1)!).toBeGreaterThan(0.9);
    expect(wpOf(stateAt(tl, 0), 1) + wpOf(stateAt(tl, 0), 2)).toBeCloseTo(1, 5);
  });
  it("DPM = damage per life minute", () => {
    const me = playerMetrics(tl).find((p) => p.vid === tl.recorder.vid)!;
    expect(me.damage).toBe(1362); expect(me.dpm).toBe(Math.round(1362 / (327 / 60)));
  });
  it("recorder heuristics account for all 1,362 damage and are internally consistent", () => {
    const h = recorderHeuristics(tl)!;
    expect(h.damage).toBe(1362);
    expect(h.cleanupShare).toBeGreaterThanOrEqual(0); expect(h.cleanupShare).toBeLessThanOrEqual(1);
    expect(h.shareOnThreats).toBeGreaterThan(0); expect(h.threatWeighted).toBeGreaterThan(0);
    expect(h.best).not.toBeNull();
    expect(h.coverage).toBe(1);
  });
  it("any player: hits only land on the other team, per-hit damage never exceeds the official total", () => {
    const team = new Map(tl.vehicles.map((v) => [v.vid, v.team]));
    let seen = 0, official = 0;
    for (const v of tl.vehicles) {
      const h = playerHeuristics(tl, v.vid)!;
      expect(h.damage).toBeLessThanOrEqual((tl.results!.players[v.vid]?.damageDealt ?? 0) + 0);
      expect(h.coverage).toBeGreaterThanOrEqual(0); expect(h.coverage).toBeLessThanOrEqual(1);
      for (const x of h.hits) expect(team.get(x.target)).not.toBe(v.team);
      seen += h.damage; official += tl.results!.players[v.vid]?.damageDealt ?? 0;
    }
    expect(seen / official).toBeGreaterThan(0.8);
  });
  it("Impact of every player on a team, from that team's own win probability, is finite", () => {
    for (const v of tl.vehicles) expect(Number.isFinite(playerHeuristics(tl, v.vid)!.impactPts)).toBe(true);
  });
  it("accuracy, pen rate and life share match the results and stay in [0,1]", () => {
    const me = playerStats(tl).find((p) => p.vid === tl.recorder.vid)!, r = tl.results!.players[tl.recorder.vid]!;
    expect(me.accuracy).toBeCloseTo(r.hits / r.shots, 10); expect(me.penRate).toBeCloseTo(r.pens / r.hits, 10);
    for (const p of playerStats(tl)) for (const x of [p.accuracy, p.penRate, p.lifeShare]) if (x != null) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
  });
});
