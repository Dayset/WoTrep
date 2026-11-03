import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { boldnessAll, estimateReload, reloadStateAt, shotTimes, playerHeuristics, playerMetrics, playerStats, recorderHeuristics, wpOf, wpSeries } from "../src/index";
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
  it("reload estimator learns the recorder's clip from observed shots and its state is consistent", () => {
    const ts = shotTimes(tl, tl.recorder.vid), est = estimateReload(ts);
    expect(est.clipSize).toBe(10); expect(est.intraMaxS).toBeGreaterThan(0.5); expect(est.reloadS).toBeGreaterThan(est.intraMaxS); expect(est.confidence).toBeGreaterThan(0.3);
    // end of the first full burst: a shot of a 10-shot run followed by a long gap
    let run = 1, end = -1;
    for (let i = 1; i < ts.length && end < 0; i++) { if (ts[i]! - ts[i - 1]! <= est.intraMaxS) run++; else { if (run === est.clipSize) end = i - 1; run = 1; } }
    expect(end).toBeGreaterThan(0);
    expect(reloadStateAt(ts, est, ts[0]! - 1).state).toBe("unknown");
    const r = reloadStateAt(ts, est, ts[end]! + 0.5); expect(r.state).toBe("reloading"); expect(r.secondsLeft).toBeGreaterThan(0);
    expect(reloadStateAt(ts, est, ts[end]! + est.reloadS! + 0.5).state).toBe("ready");
  });
  it("single-shot and empty inputs degrade safely", () => {
    expect(estimateReload([]).confidence).toBe(0); expect(estimateReload([5]).clipSize).toBe(1);
    const e = estimateReload([0, 8, 16.2, 24.1, 32.5, 41, 49.2]); expect(e.clipSize).toBe(1); expect(e.reloadS).toBeCloseTo(7.9, 1);
  });
  it("boldness: rates are in [0,1], counts are consistent, tiny samples give no rate", () => {
    const b = boldnessAll(tl); let withRate = 0;
    for (const x of b.values()) {
      expect(x.taken).toBeLessThanOrEqual(x.episodes); expect(x.openSeconds).toBeGreaterThanOrEqual(x.episodes);
      if (x.rate != null) { withRate++; expect(x.rate).toBeGreaterThanOrEqual(0); expect(x.rate).toBeLessThanOrEqual(1); expect(x.episodes).toBeGreaterThanOrEqual(3); }
    }
    expect(withRate).toBeGreaterThan(5);
    for (const x of b.values()) { expect(x.rewarded + x.costly + x.flat).toBe(x.taken); expect(x.flat).toBeGreaterThanOrEqual(0); if (x.style === "safe") expect(x.rate!).toBeLessThan(0.35); if (x.rate == null) expect(x.style).toBeNull(); }
    console.log("BOLD", JSON.stringify([...b.values()].map((x) => [x.vid === tl.recorder.vid ? "ME" : x.vid % 100, x.episodes, x.taken, x.rewarded, x.costly, x.style])));
  });
});
