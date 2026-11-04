import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { styleAll } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("style", () => {
  const s = styleAll(tl);
  it("gives one profile per vehicle with finite team-relative values", () => {
    expect(s.size).toBe(tl.vehicles.length);
    for (const p of s.values()) for (const v of Object.values(p.rel)) if (v != null) expect(Number.isFinite(v)).toBe(true);
  });
  it("team-relative damage averages to 1 within each team", () => {
    for (const tm of [1, 2] as const) {
      const rel = [...s.values()].filter((p) => p.team === tm && p.rel.dpm != null).map((p) => p.rel.dpm as number);
      const avg = rel.reduce((a, b) => a + b, 0) / rel.length;
      expect(avg).toBeCloseTo(1, 6);
    }
  });
  it("scores are centred on 100 per team when present", () => {
    const sc = [...s.values()].filter((p) => p.score != null && p.team === 1).map((p) => p.score as number);
    expect(sc.length).toBeGreaterThan(0);
    expect(sc.reduce((a, b) => a + b, 0) / sc.length).toBeGreaterThan(50);
  });
});
