import { describe, expect, it } from "vitest";
import { buildBlockerIndex, type HeightField, type SightBlocker } from "@wotrep/analysis";
import { ghostThreats, type LosContext } from "../src/features/player/viewConfig";
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

/** LOS-aware threats: synthetic fields and blockers, no fixture replay needed. */
function flatField(): HeightField {
  return { x0: -1000, z0: -1000, cell: 25, cols: 81, rows: 81, h: new Float32Array(81 * 81), seen: new Uint8Array(81 * 81).fill(1) };
}
/** Flat except for a 40 m hill within 100 m of (300, 0) — it sits on the direct line from (0,0) to (500,0). */
function hillField(): HeightField {
  const f = flatField();
  for (let r = 0; r < f.rows; r++) for (let c = 0; c < f.cols; c++) {
    const x = f.x0 + c * f.cell, z = f.z0 + r * f.cell;
    if (Math.hypot(x - 300, z) <= 100) f.h[r * f.cols + c] = 40;
  }
  return f;
}
const wall = (x0: number, x1: number, z0: number, z1: number, top = 30): SightBlocker => ({ quad: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], top, kind: "building" });
const losCtx = (field: HeightField, blockers: SightBlocker[] = []): LosContext => ({ field, blockers, index: buildBlockerIndex(blockers) });
// Fast ghost (20 m/s, 5 s old, 100 m reach) at (0,0); the direct firing point toward (500,0) is
// (55,0), arrival 55/20 = 2.75 s; the nearest flank firing points are (185, ±315), arrival 365/20 = 18.26 s.
const fastGhost = (o: Partial<Unit> & { vid: number }): Unit => ghost({ vid: 1, ageS: 5, reachM: 100, reachSpeedMps: 20, ...o });

describe("ghostThreats with line of sight", () => {
  it("with clear LOS the countdown matches the direct approach, and the line points at the firing position", () => {
    const f = u({ vid: 2, x: 600, z: 0 });
    const th = ghostThreats([ghost({ vid: 1 })], [ghost({ vid: 1 }), f], 2, losCtx(flatField())).get(2)!;
    expect(th.secs).toBeCloseTo(15.5 - 10, 1); // arrival (600-445)/10 = 15.5 s, age 10
    expect(th.edge!.x).toBeCloseTo(155, 0); expect(th.edge!.z).toBeCloseTo(0, 0); // the firing position, not the old 100 m disc edge
  });
  it("a building on the direct line pushes the threat to a flank", () => {
    const f = u({ vid: 2, x: 500, z: 0 });
    const ctx = losCtx(flatField(), [wall(200, 400, -20, 20)]); // straddles the direct ray, not the flanks
    const th = ghostThreats([fastGhost({ vid: 1 })], [fastGhost({ vid: 1 }), f], 2, ctx).get(2)!;
    expect(th.secs).toBeCloseTo(18.26 - 5, 1); // the flank arrival, not the direct 2.75 s
    expect(th.edge).not.toBeNull();
    expect(Math.hypot(th.edge!.x - 500, th.edge!.z)).toBeCloseTo(445, 0); // on the 445 m ring
    expect(Math.hypot(th.edge!.x, th.edge!.z)).toBeCloseTo(365, 0); // 365 m from the vanish point
  });
  it("a hill on the direct line pushes the threat to a flank", () => {
    const f = u({ vid: 2, x: 500, z: 0 });
    const th = ghostThreats([fastGhost({ vid: 1 })], [fastGhost({ vid: 1 }), f], 2, losCtx(hillField())).get(2)!;
    expect(th.secs).toBeCloseTo(18.26 - 5, 1);
    expect(th.edge).not.toBeNull();
  });
  it("no firing position with LOS means no marker at all", () => {
    const f = u({ vid: 2, x: 600, z: 0 });
    // Four 120 m walls around the friendly: every sampled firing position looks through one.
    const ctx = losCtx(flatField(), [wall(568, 572, -60, 60), wall(628, 632, -60, 60), wall(560, 640, 28, 32), wall(560, 640, -32, -28)]);
    expect(ghostThreats([ghost({ vid: 1 })], [ghost({ vid: 1 }), f], 2, ctx).has(2)).toBe(false);
  });
  it("a tank on the direct line pushes the threat to a flank", () => {
    // The blocker is an ENEMY live tank: it blocks the ray, but it is not a threat target, so
    // the one-ghost-one-position rule cannot steal the marker onto it (a friendly standing
    // there would be the ghost's earliest firing position instead).
    const f = u({ vid: 2, x: 500, z: 0 }), blocker = u({ vid: 9, team: 1, x: 250, z: 0 });
    const g = fastGhost({ vid: 1 });
    const th = ghostThreats([g], [g, f, blocker], 2, losCtx(flatField())).get(2)!;
    expect(th.secs).toBeCloseTo(18.26 - 5, 1); // the direct 2.75 s is blocked by the tank
  });
  it("a dead tank does not block", () => {
    const f = u({ vid: 2, x: 500, z: 0 }), wreck = u({ vid: 9, x: 250, z: 0, alive: false });
    const g = fastGhost({ vid: 1 });
    const th = ghostThreats([g], [g, f, wreck], 2, losCtx(flatField())).get(2)!;
    expect(th.secs).toBeCloseTo(2.75 - 5, 1); // the direct approach is open
    expect(th.edge).toBeNull(); // the firing position is inside the ghost's reach disc
  });
  it("a ghost tank does not block — its position is unknown", () => {
    const f = u({ vid: 2, x: 500, z: 0 }), maybe = ghost({ vid: 9, x: 250, z: 0 }); // another ghost, not a threat source here
    const g = fastGhost({ vid: 1 });
    const th = ghostThreats([g], [g, f, maybe], 2, losCtx(flatField())).get(2)!;
    expect(th.secs).toBeCloseTo(2.75 - 5, 1);
  });
  it("a stationary ghost threatens only with a clear line", () => {
    const g = ghost({ vid: 1, reachM: undefined, reachSpeedMps: 0 });
    const near = u({ vid: 2, x: 400, z: 0 });
    const clear = ghostThreats([g], [g, near], 2, losCtx(flatField()));
    expect(clear.has(2)).toBe(true); expect(clear.get(2)!.secs).toBeLessThanOrEqual(0);
    const walled = ghostThreats([g], [g, near], 2, losCtx(flatField(), [wall(100, 300, -20, 20)]));
    expect(walled.has(2)).toBe(false); // the only firing position is behind the wall
  });
  // Path fix (2026-11-05): the whole vanish→firing-position segment is checked against every
  // friendly's bubble, not just the reach blockers near the vanish point. Ghost at (0,0), friendly
  // at (300,0), walled in on the west/north/south — the only LOS-clear firing positions are the
  // east ones, (400,0) and (550,0), and the straight line to either runs through the friendly.
  it("a firing position reached only by driving through the victim's own bubble is no marker", () => {
    const f = u({ vid: 2, x: 300, z: 0 });
    const ctx = losCtx(flatField(), [wall(268, 272, -60, 60), wall(260, 340, 28, 32), wall(260, 340, -32, -28)]);
    expect(ghostThreats([fastGhost({ vid: 1 })], [fastGhost({ vid: 1 }), f], 2, ctx).has(2)).toBe(false);
  });
  it("a firing position whose path clears the friendly's bubble still marks", () => {
    const f = u({ vid: 2, x: 300, z: 0 });
    // Same walls minus the north one: the first LOS-clear candidate is (300,100) on the 100 m
    // ring — its path from the vanish point clears the friendly by ~95 m, so the marker stands.
    const ctx = losCtx(flatField(), [wall(268, 272, -60, 60), wall(260, 340, -32, -28)]);
    const th = ghostThreats([fastGhost({ vid: 1 })], [fastGhost({ vid: 1 }), f], 2, ctx).get(2)!;
    expect(th.secs).toBeCloseTo(Math.hypot(300, 100) / 20 - 5, 1); // arrival 15.81 s, age 5
    expect(th.edge!.x).toBeCloseTo(300, 0); expect(th.edge!.z).toBeCloseTo(100, 0);
  });
});

/** Coverage rejection + one-ghost-one-position (2026-11-05): a ghost cannot threaten from a
 *  firing position another friendly is watching, and it can be in only one place. */
describe("ghostThreats coverage and one-ghost-one-position", () => {
  // Slow ghost (5 m/s, 5 s old, 25 m reach) at (0,0); the only firing position reachable in
  // the 30 s window is the direct point (55,0) toward (500,0) — every flank point is >30 s away.
  const slowGhost = (o: Partial<Unit> & { vid: number }): Unit => ghost({ vid: 1, ageS: 5, reachM: 25, reachSpeedMps: 5, ...o });
  it("a firing position watched by another friendly is no marker", () => {
    const f = u({ vid: 2, x: 500, z: 0 }), w = u({ vid: 3, x: 55, z: 200 }); // 200 m from (55,0), clear LOS
    const th = ghostThreats([slowGhost({ vid: 1 })], [slowGhost({ vid: 1 }), f, w], 2, losCtx(flatField()));
    expect(th.has(2)).toBe(false); // the only firing position is watched
    expect(th.get(3)).toBeDefined(); // the watcher is itself the ghost's earliest target
  });
  it("the victim's own coverage does not kill its marker", () => {
    const f = u({ vid: 2, x: 500, z: 0 }); // 445 m from (55,0) with a clear line: it watches its own firing position
    const th = ghostThreats([slowGhost({ vid: 1 })], [slowGhost({ vid: 1 }), f], 2, losCtx(flatField())).get(2)!;
    expect(th.secs).toBeCloseTo(55 / 5 - 5, 1); // arrival 11 s, age 5
    expect(th.edge).toEqual({ x: 55, z: 0 });
  });
  it("a watcher out of range does not kill the marker", () => {
    const f = u({ vid: 2, x: 500, z: 0 }), w = u({ vid: 3, x: 55, z: 500 }); // 500 m from (55,0)
    expect(ghostThreats([slowGhost({ vid: 1 })], [slowGhost({ vid: 1 }), f, w], 2, losCtx(flatField())).has(2)).toBe(true);
  });
  it("a watcher whose line to the position is walled off does not kill the marker", () => {
    const f = u({ vid: 2, x: 500, z: 0 }), w = u({ vid: 3, x: 55, z: 200 });
    // The first wall stands between the watcher and (55,0); the second stands between the
    // ghost and the watcher, so the watcher is not itself the ghost's earliest target
    // (one ghost, one position) and the test pins the coverage rule alone.
    const ctx = losCtx(flatField(), [wall(45, 65, 90, 110), wall(20, 35, 90, 110)]);
    expect(ghostThreats([slowGhost({ vid: 1 })], [slowGhost({ vid: 1 }), f, w], 2, ctx).has(2)).toBe(true);
  });
  it("one ghost claims only its earliest firing position across friendlies", () => {
    const g = fastGhost({ vid: 1 }); // (0,0), 20 m/s, age 5, reach 100
    const f1 = u({ vid: 2, x: 500, z: 0 }); // direct (55,0), arrival 2.75 s
    const f2 = u({ vid: 3, x: 0, z: 700 }); // direct (0,255), arrival 12.75 s
    const th = ghostThreats([g], [g, f1, f2], 2, losCtx(flatField()));
    expect(th.get(2)!.secs).toBeCloseTo(2.75 - 5, 1);
    expect(th.has(3)).toBe(false); // the same ghost cannot also be 255 m north
  });
  it("a second ghost still marks the friendly the first ghost abandoned", () => {
    const g1 = fastGhost({ vid: 1 });
    const g2 = fastGhost({ vid: 4, x: 100, z: 600 }); // near f2: direct (100,600), arrival 0
    const f1 = u({ vid: 2, x: 500, z: 0 }), f2 = u({ vid: 3, x: 0, z: 700 });
    const th = ghostThreats([g1, g2], [g1, g2, f1, f2], 2, losCtx(flatField()));
    expect(th.get(2)!.ghostVid).toBe(1); expect(th.get(3)!.ghostVid).toBe(4);
  });
  it("the range-only rule still lets one ghost threaten several friendlies", () => {
    const f1 = u({ vid: 2, x: 300, z: 0 }), f2 = u({ vid: 3, x: 0, z: 300 });
    const th = ghostThreats([ghost({ vid: 1 })], [ghost({ vid: 1 }), f1, f2], 2);
    expect(th.has(2)).toBe(true); expect(th.has(3)).toBe(true);
  });
});

/** Sustainable speed (2026-11-05): the vanish→edge leg is credited at the median of the
 *  speeds the ghost was seen driving at, not the 2 s-window burst. */
describe("ghostThreats sustainable speed", () => {
  it("a slow cruiser with a fast burst is credited at its cruise speed", () => {
    const f = u({ vid: 2, x: 600, z: 0 });
    // Burst 20 m/s would give arrival 7.75 s; sustain 5 m/s gives 31 s — past the window.
    const slow = ghost({ vid: 1, ageS: 5, reachM: 100, reachSpeedMps: 20, sustainSpeedMps: 5 });
    expect(ghostThreats([slow], [slow, f], 2, losCtx(flatField())).has(2)).toBe(false);
    const mid = ghost({ vid: 1, ageS: 5, reachM: 100, reachSpeedMps: 20, sustainSpeedMps: 10 });
    const th = ghostThreats([mid], [mid, f], 2, losCtx(flatField())).get(2)!;
    expect(th.secs).toBeCloseTo(15.5 - 5, 1); // arrival 155/10 = 15.5 s, age 5
  });
  it("the range-only rule uses the sustainable speed too", () => {
    const f = u({ vid: 2, x: 600, z: 0 });
    const slow = ghost({ vid: 1, ageS: 5, reachM: 100, reachSpeedMps: 20, sustainSpeedMps: 5 });
    expect(ghostThreats([slow], [slow, f], 2).has(2)).toBe(false); // (600-445)/5 = 31 s
    const mid = ghost({ vid: 1, ageS: 5, reachM: 100, reachSpeedMps: 20, sustainSpeedMps: 10 });
    expect(ghostThreats([mid], [mid, f], 2).get(2)!.secs).toBeCloseTo(15.5 - 5, 1);
  });
  it("a ghost that never moved still threatens only what is already in range", () => {
    const g = ghost({ vid: 1, reachM: undefined, reachSpeedMps: 0, sustainSpeedMps: 0 });
    const near = u({ vid: 2, x: 400, z: 0 }), far = u({ vid: 3, x: 500, z: 0 });
    const th = ghostThreats([g], [g, near, far], 2, losCtx(flatField()));
    expect(th.has(2)).toBe(true); expect(th.has(3)).toBe(false);
  });
});
