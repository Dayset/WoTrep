import { describe, expect, it } from "vitest";
import type { Unit } from "@wotrep/model";
import {
  segmentTankBlocked, tankBlockers, TANK_BLOCK_R_M, TANK_HEIGHT_M,
  type HeightField, type TankBlocker,
} from "../src/index";

/** Flat ground: height 0 everywhere, so eye level is EYE_HEIGHT_M and tank tops are TANK_HEIGHT_M. */
function flatField(): HeightField {
  return { x0: -1000, z0: -1000, cell: 25, cols: 81, rows: 81, h: new Float32Array(81 * 81), seen: new Uint8Array(81 * 81).fill(1) };
}
const u = (o: Partial<Unit> & { vid: number }): Unit => ({ team: 2, alive: true, hp: 1000, x: 0, z: 0, yaw: 0, known: "live", ...o });
const tank = (x: number, z: number, vid: number, top = TANK_HEIGHT_M): TankBlocker => ({ x, z, top, vid });
const eye = (x: number, z: number): [number, number, number] => [x, 2.5, z];
const none = new Set<number>();

describe("segmentTankBlocked", () => {
  it("hits the near edge of the tank's circle", () => {
    // Tank at x=50, radius 3: the segment enters at x=47, t=0.47.
    expect(segmentTankBlocked(eye(0, 0), eye(100, 0), [tank(50, 0, 1)], none)).toBeCloseTo(0.47, 2);
  });
  it("misses a tank off to the side", () => {
    expect(segmentTankBlocked(eye(0, 0), eye(100, 0), [tank(50, 20, 1)], none)).toBeNull();
  });
  it("never blocks for an excluded vid (shooter / target)", () => {
    expect(segmentTankBlocked(eye(0, 0), eye(100, 0), [tank(50, 0, 1)], new Set([1]))).toBeNull();
  });
  it("a shot starting inside a tank is blocked at t=0", () => {
    expect(segmentTankBlocked(eye(50, 0), eye(100, 0), [tank(50, 0, 1)], none)).toBe(0);
  });
  it("a line above the tank's top passes over it", () => {
    expect(segmentTankBlocked([0, 5, 0], [100, 5, 0], [tank(50, 0, 1)], none)).toBeNull();
  });
  it("a tank past the segment end does not block", () => {
    expect(segmentTankBlocked(eye(0, 0), eye(100, 0), [tank(150, 0, 1)], none)).toBeNull();
  });
  it("returns the earliest tank when several are in the way", () => {
    expect(segmentTankBlocked(eye(0, 0), eye(100, 0), [tank(70, 0, 2), tank(50, 0, 1)], none)).toBeCloseTo(0.47, 2);
  });
  it("a lower tank does not block a line above it", () => {
    // A wreck-height tank (top 1 m) under a 2.5 m eye line: the line clears it.
    expect(segmentTankBlocked(eye(0, 0), eye(100, 0), [tank(50, 0, 1, 1)], none)).toBeNull();
  });
});

describe("tankBlockers", () => {
  it("keeps alive live tanks of either team, with tops at ground + TANK_HEIGHT_M", () => {
    const field = flatField();
    const list = tankBlockers([u({ vid: 1, x: 10, z: 20 }), u({ vid: 2, team: 1, x: -5, z: -5 })], field);
    expect(list).toEqual([
      { x: 10, z: 20, top: TANK_HEIGHT_M, vid: 1 },
      { x: -5, z: -5, top: TANK_HEIGHT_M, vid: 2 },
    ]);
    expect(TANK_BLOCK_R_M).toBe(3);
  });
  it("excludes dead tanks, ghosts and never-seen tanks", () => {
    const field = flatField();
    const list = tankBlockers([
      u({ vid: 1 }), u({ vid: 2, alive: false }), u({ vid: 3, known: "ghost" }), u({ vid: 4, known: "never" }),
    ], field);
    expect(list.map((t) => t.vid)).toEqual([1]);
  });
});
