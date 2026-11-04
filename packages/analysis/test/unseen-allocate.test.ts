import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { allocateUnseen, hiddenDealt } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/peresvet-ghost.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("ghost fixture invalid");
const tl = r.value;

describe("allocation pass", () => {
  const plan = allocateUnseen(tl);
  it("every drop is accounted for: assigned plus unexplained equals the unseen HP", () => {
    for (const a of plan) {
      const assigned = a.sources.reduce((s, x) => s + x.hp, 0);
      expect(Math.abs(assigned + a.unexplained - a.unseen)).toBeLessThanOrEqual(1);
    }
  });
  it("no source is assigned more than its hidden damage in total", () => {
    const hidden = hiddenDealt(tl);
    const used = new Map<number, number>();
    for (const a of plan) for (const s of a.sources) used.set(s.vid, (used.get(s.vid) ?? 0) + s.hp);
    for (const [vid, hp] of used) expect(hp).toBeLessThanOrEqual((hidden.get(vid) ?? 0) + 1);
  });
  it("the #1 suspect is still reported when the budget runs out", () => {
    const withSuspect = plan.filter((a) => a.topSuspect != null);
    expect(withSuspect.length).toBe(plan.length);
  });
});
