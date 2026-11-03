import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "../src/index";

const load = () => JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8"));
describe("BattleTimeline schema", () => {
  it("accepts the fixture", () => {
    const r = validateTimeline(load());
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  it("rejects a wrong schema id and mismatched track columns", () => {
    const t = load(); t.schema = "x";
    expect(validateTimeline(t).ok).toBe(false);
    const u = load(); const k = Object.keys(u.tracks)[0]!; u.tracks[k].x.pop();
    expect(validateTimeline(u).ok).toBe(false);
  });
});
