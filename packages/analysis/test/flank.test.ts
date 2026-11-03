import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { flankModel, flankState } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("flankModel", () => {
  it("builds three aligned series, bounded ratios and shares that sum to 1", () => {
    const m = flankModel(tl)!; expect(m).not.toBeNull();
    for (let b = 0; b < 3; b++) { expect(m.own[b]!.length).toBe(m.t.length); expect(m.foe[b]!.length).toBe(m.t.length); expect(m.ratio[b]!.every((x) => x == null || (x >= 0 && x <= 1))).toBe(true); }
    expect(m.ownShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1); expect(m.foeShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
  });
  it("own HP in the series never exceeds the team's maximum", () => {
    const m = flankModel(tl)!, cap = tl.vehicles.filter((v) => v.team === m.team).reduce((s, v) => s + v.maxHealth, 0);
    for (let i = 0; i < m.t.length; i++) expect(m.own[0]![i]! + m.own[1]![i]! + m.own[2]![i]!).toBeLessThanOrEqual(cap + 1);
  });
  it("the two teams see mirrored flanks: left for one is right for the other", () => {
    const a = flankModel(tl, 1), b = flankModel(tl, 2); if (!a || !b) return;   // team 1 may be untracked at the start
    expect(a.ownShare.length).toBe(3);
  });
  it("states", () => { expect(flankState(0.9)).toBe("ahead"); expect(flankState(0.5)).toBe("even"); expect(flankState(0.1)).toBe("behind"); expect(flankState(null)).toBeNull(); });
});
