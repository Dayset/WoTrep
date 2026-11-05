import { describe, expect, it } from "vitest";
import { ghostThreats } from "../src/features/player/viewConfig";
import type { Unit } from "@wotrep/model";

const u = (o: Partial<Unit> & { vid: number }): Unit => ({ team: 2, alive: true, hp: 1000, x: 0, z: 0, yaw: 0, known: "live", ...o });
// Enemy ghost at (0,0): vanished 10 s ago, reach 100 m, fastest 10 m/s — consistent (10 x 10).
const ghost = (o: Partial<Unit> & { vid: number }): Unit => u({ team: 1, known: "ghost", ageS: 10, reachM: 100, reachSpeedMps: 10, ...o });

describe("ghostThreats", () => {
  it("a friendly inside firing range of the vanish point is threatened now, with an edge to draw", () => {
    const f = u({ vid: 2, x: 300, z: 0 });
    const th = ghostThreats([ghost({ vid: 1 })], [ghost({ vid: 1 }), f], 2).get(2)!;
    expect(th.secs).toBeLessThanOrEqual(0); // arrival (300-445)/10 = -14.5 s, age 10
    expect(th.edge).toEqual({ x: 100, z: 0 }); // nearest point of the 100 m disc toward the friendly
    expect(th.alpha).toBeCloseTo(1 - 10 / 30, 2); // fades with the ghost
  });
  it("a friendly the ghost can reach within the window counts down", () => {
    const f = u({ vid: 2, x: 600, z: 0 });
    const th = ghostThreats([ghost({ vid: 1 })], [ghost({ vid: 1 }), f], 2).get(2)!;
    expect(th.secs).toBeCloseTo(15.5 - 10, 1); // arrival (600-445)/10 = 15.5 s, age 10
    expect(th.edge).toEqual({ x: 100, z: 0 });
  });
  it("a friendly beyond the 30 s window is not marked", () => {
    const f = u({ vid: 2, x: 800, z: 0 }); // arrival (800-445)/10 = 35.5 s
    expect(ghostThreats([ghost({ vid: 1 })], [ghost({ vid: 1 }), f], 2).has(2)).toBe(false);
  });
  it("the soonest ghost wins", () => {
    const f = u({ vid: 3, x: 600, z: 0 });
    const g1 = ghost({ vid: 1 }), g2 = ghost({ vid: 2, x: 400, z: 0, ageS: 5, reachM: 50 }); // closer: arrival -24.5 s
    const th = ghostThreats([g1, g2], [g1, g2, f], 2).get(3)!;
    expect(th.ghostVid).toBe(2); expect(th.secs).toBeCloseTo(-24.5 - 5, 1);
  });
  it("the line is dropped when the direct approach is shadowed, the threat is not", () => {
    const f = u({ vid: 3, x: 300, z: 0 }), b = u({ vid: 2, x: 100, z: 0 }); // blocker sits on the edge point
    const th = ghostThreats([ghost({ vid: 1 })], [ghost({ vid: 1 }), f, b], 2).get(3)!;
    expect(th.secs).toBeLessThanOrEqual(0); expect(th.edge).toBeNull();
  });
  it("a friendly already inside the disc gets no line", () => {
    const f = u({ vid: 2, x: 50, z: 0 });
    const th = ghostThreats([ghost({ vid: 1 })], [ghost({ vid: 1 }), f], 2).get(2)!;
    expect(th.secs).toBeLessThanOrEqual(0); expect(th.edge).toBeNull();
  });
  it("allied ghosts, dead, stale and never-seen friendlies are ignored", () => {
    const f = u({ vid: 2, x: 300, z: 0 });
    const ally = ghost({ vid: 9, team: 2 });
    expect(ghostThreats([ally], [ally, f], 2).size).toBe(0);
    const g = ghost({ vid: 1 });
    for (const bad of [u({ vid: 2, x: 300, z: 0, alive: false }), u({ vid: 2, x: 300, z: 0, known: "ghost" }), u({ vid: 2, x: 300, z: 0, known: "never" })])
      expect(ghostThreats([g], [g, bad], 2).size).toBe(0);
  });
  it("a stationary ghost threatens only what is already in firing range", () => {
    const g = ghost({ vid: 1, reachM: undefined, reachSpeedMps: 0 });
    const near = u({ vid: 2, x: 400, z: 0 }), far = u({ vid: 3, x: 500, z: 0 });
    const th = ghostThreats([g], [g, near, far], 2);
    expect(th.has(2)).toBe(true); expect(th.get(2)!.secs).toBeLessThanOrEqual(0);
    expect(th.has(3)).toBe(false);
  });
  it("an old ghost (age past the window) is no threat", () => {
    const f = u({ vid: 2, x: 300, z: 0 }), g = ghost({ vid: 1, ageS: 35, reachM: 350 });
    expect(ghostThreats([g], [g, f], 2).size).toBe(0);
  });
});
