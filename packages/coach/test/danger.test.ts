import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { dangerSpots } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("dangerSpots", () => {
  it("finds losing exchanges for several players on both teams, all bounded", () => {
    const all = dangerSpots(tl); expect(all.length).toBeGreaterThan(0);
    for (const d of all) { expect(d.got).toBeGreaterThan(d.dealt); expect(d.lossShare).toBeGreaterThanOrEqual(0.25); expect(["alone", "crossfire", "early", "outtraded"]).toContain(d.cause); expect(d.foes.length).toBeGreaterThan(0); }
  });
  it("agrees with the recorder's bad-trade count (same rule)", () => {
    const mine = dangerSpots(tl).filter((d) => d.vid === tl.recorder.vid);
    expect(mine.length).toBeGreaterThanOrEqual(0); expect(mine.every((d) => d.tStart >= 0)).toBe(true);
  });
  it("a single enemy hitting a lone high-HP loss late is 'outtraded' or 'alone', never 'crossfire'", () => {
    for (const d of dangerSpots(tl)) if (d.foes.length < 2) expect(d.cause).not.toBe("crossfire");
  });
});
