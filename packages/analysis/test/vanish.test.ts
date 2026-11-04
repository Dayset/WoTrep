import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { vanishEvents } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("vanishEvents", () => {
  const v = vanishEvents(tl);
  it("finds vanishes of enemy tanks only, with a spotter in view range", () => {
    expect(v.length).toBeGreaterThan(5);
    const enemy = new Set(tl.vehicles.filter((x) => x.team !== tl.recorder.team).map((x) => x.vid));
    for (const e of v) { expect(enemy.has(e.vid)).toBe(true); expect(e.t).toBeGreaterThan(0); if (e.spotterM != null) { expect(e.spotterM).toBeGreaterThanOrEqual(20); expect(e.spotterM).toBeLessThanOrEqual(445); } }
  });
  it("does not count a destroyed tank as a vanish", () => {
    const killT = new Map(tl.events.flatMap((e) => (e.k === "kill" ? [[e.victim, e.t] as const] : [])));
    for (const e of v) { const k = killT.get(e.vid); if (k != null) expect(Math.abs(k - e.t)).toBeGreaterThan(1.5); }
  });
});
