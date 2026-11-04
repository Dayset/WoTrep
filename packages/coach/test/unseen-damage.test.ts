import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { runDetectors, detectors } from "../src/index";
import { unseenDrops, unseenCandidates, hiddenDealt } from "@wotrep/analysis";

// PERESVET (13908120) lost ~1.6k HP between about 150 s and 224 s with no damage events behind it.
// Enemies 13908118, 13908123 and 13908127 dealt damage the recorder never itemised.
const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/peresvet-ghost.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("ghost fixture invalid");
const tl = r.value;
const VID = 13908120;

describe("unseen damage", () => {
  it("finds the unexplained HP drop of the victim", () => {
    const drops = unseenDrops(tl, VID);
    const big = drops.find((d) => d.unseen > 1000);
    expect(big).toBeDefined();
    expect(big!.t1).toBeGreaterThan(150);
    expect(big!.t1).toBeLessThanOrEqual(230);
  });
  it("only enemies with hidden damage are candidates, and shares add up to 1", () => {
    const hidden = hiddenDealt(tl);
    const d = unseenDrops(tl, VID).find((x) => x.unseen > 1000)!;
    const cands = unseenCandidates(tl, d, hidden);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) expect(hidden.has(c.vid)).toBe(true);
    expect(cands.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 6);
  });
  it("confidence is capped: attribution is an estimate", () => {
    const d = unseenDrops(tl, VID).find((x) => x.unseen > 1000)!;
    for (const c of unseenCandidates(tl, d)) expect(c.confidence).toBeLessThanOrEqual(0.4);
  });
  it("the engine reports it as info for the victim, with no accusation wording", () => {
    const f = runDetectors(tl, detectors, VID).filter((x) => x.messageKey === "coach.unseenDamage");
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.kind === "info")).toBe(true);
  });
});
