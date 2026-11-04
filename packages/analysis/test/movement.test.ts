import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { movement } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("movement", () => {
  const m = movement(tl);
  it("gives bounded numbers for every player and full coverage of the recorder", () => {
    expect(m.players.length).toBe(30);
    const me = m.players.find((p) => p.vid === tl.recorder.vid)!; expect(me.seenS).toBeGreaterThan(60);
    for (const p of m.players) { if (p.stillShare != null) { expect(p.stillShare).toBeGreaterThanOrEqual(0); expect(p.stillShare).toBeLessThanOrEqual(1); } if (p.mPerMin != null) expect(p.mPerMin).toBeLessThan(1500); expect(p.multiS).toBeGreaterThanOrEqual(0); if (p.acquireS != null) expect(p.acquireS).toBeLessThanOrEqual(20); }
  });
  it("reports a median per team", () => { expect(m.medians[1].mPerMin).not.toBeNull(); expect(m.medians[2].mPerMin).not.toBeNull(); });
});
