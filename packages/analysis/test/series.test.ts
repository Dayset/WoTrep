import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { seriesFor } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("seriesFor", () => {
  it("is monotone and the recorder's final damage matches the official number", () => {
    const s = seriesFor(tl, tl.recorder.vid);
    for (let i = 1; i < s.dmg.length; i++) { expect(s.dmg[i]!).toBeGreaterThanOrEqual(s.dmg[i - 1]!); expect(s.shots[i]!).toBeGreaterThanOrEqual(s.shots[i - 1]!); }
    expect(s.finalDmg).toBe(s.officialDmg);
    // Real finding: the event stream shows 61 shots, the results say 59 (two events not counted by the game). Allow a small gap.
    expect(Math.abs(s.finalShots - s.officialShots!)).toBeLessThanOrEqual(3);
    expect(s.hitRate.every((v) => v == null || (v >= 0 && v <= 1))).toBe(true);
  });
});
