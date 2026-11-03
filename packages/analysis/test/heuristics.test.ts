import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { playerMetrics, recorderHeuristics, wpOf, wpSeries } from "../src/index";
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
    console.log(JSON.stringify(h));
  });
});
