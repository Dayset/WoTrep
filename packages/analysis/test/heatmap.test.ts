import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { heatGrid, seriesFor } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value, bounds = { x0: -700, x1: 700, z0: -700, z1: 700 };

describe("heatGrid", () => {
  it("damage layer sums to the observed damage inside the bounds", () => {
    const g = heatGrid(tl, "dmgdealt", { bounds }), all = tl.vehicles.reduce((s, v) => s + seriesFor(tl, v.vid).finalDmg, 0);
    // attacker/victim on the same team (friendly fire) is excluded by seriesFor only; allow a small gap
    expect(g.total).toBeGreaterThan(0); expect(Math.abs(g.total - all)).toBeLessThanOrEqual(all * 0.05); expect(g.unit).toBe("hp");
  });
  it("deaths layer counts every kill once", () => {
    const g = heatGrid(tl, "deaths", { bounds }); expect(g.total).toBe(tl.events.filter((e) => e.k === "kill").length);
  });
  it("team filter splits presence and the window shrinks it", () => {
    const own = heatGrid(tl, "presence", { bounds, team: "own" }), foe = heatGrid(tl, "presence", { bounds, team: "enemy" }), both = heatGrid(tl, "presence", { bounds });
    expect(own.total).toBeGreaterThan(0); expect(foe.total).toBeGreaterThan(0); expect(Math.abs(own.total + foe.total - both.total)).toBeLessThan(1e-3);
    expect(heatGrid(tl, "presence", { bounds, t0: 0, t1: 60 }).total).toBeLessThan(both.total);
  });
  it("ignores positions outside the bounds", () => expect(heatGrid(tl, "presence", { bounds: { x0: 5000, x1: 5100, z0: 5000, z1: 5100 } }).total).toBe(0));
});

import { tracerLines } from "../src/index";
describe("tracerLines", () => {
  it("is empty on the fixture: projectileEnd events are not decoded yet (#26/#30)", () => expect(tracerLines(tl, {}).length).toBe(0));
  it("builds a line once an end point exists, and respects filters", () => {
    const shot = tl.events.find((e) => e.k === "shot" && e.shotId != null)!;
    if (shot.k !== "shot") throw new Error("x");
    const withEnd = { ...tl, events: [...tl.events, { k: "projectileEnd" as const, t: shot.t + 0.5, shotId: shot.shotId!, x: 10, y: 0, z: 20 }] };
    const all = tracerLines(withEnd, {}); expect(all).toHaveLength(1); expect(all[0]).toMatchObject({ shooter: shot.shooter, x1: 10, z1: 20 });
    expect(tracerLines(withEnd, { vid: shot.shooter + 1 })).toHaveLength(0);
  });
});
