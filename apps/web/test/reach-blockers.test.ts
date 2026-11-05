import { describe, expect, it } from "vitest";
import { PROXIMITY_SPOT_M, reachBlockers } from "../src/features/player/viewConfig";
import type { Unit } from "@wotrep/model";

const u = (o: Partial<Unit> & { vid: number }): Unit => ({ team: 2, alive: true, hp: 1000, x: 0, z: 0, yaw: 0, known: "live", ...o });
const ghost = u({ vid: 1, team: 1, known: "ghost", ageS: 10, reachM: 100 });

describe("reachBlockers", () => {
  it("the proximity rule is 50 m", () => { expect(PROXIMITY_SPOT_M.value).toBe(50); });
  it("a living friendly inside the reach disc blocks", () => {
    const bs = reachBlockers([ghost, u({ vid: 2, x: 30 })], ghost, 2);
    expect(bs.map((b) => b.vid)).toEqual([2]);
  });
  it("a friendly whose bubble merely overlaps the disc blocks too", () => {
    const bs = reachBlockers([ghost, u({ vid: 2, x: 120 })], ghost, 2);
    expect(bs.map((b) => b.vid)).toEqual([2]); // 120 <= reach 100 + 50
  });
  it("a friendly clear of the disc does not block", () => {
    expect(reachBlockers([ghost, u({ vid: 2, x: 200 })], ghost, 2)).toEqual([]);
  });
  it("dead, stale-position and enemy units never block, and the ghost itself is excluded", () => {
    const units = [ghost, u({ vid: 2, x: 30, alive: false }), u({ vid: 3, x: 30, known: "ghost" }), u({ vid: 4, team: 1, x: 30 })];
    expect(reachBlockers(units, ghost, 2)).toEqual([]);
  });
  it("a friendly ghost carries no blockers", () => {
    const ally = u({ vid: 5, team: 2, known: "ghost", ageS: 5, reachM: 50 });
    expect(reachBlockers([ally, u({ vid: 2, x: 10 })], ally, 2)).toEqual([]);
  });
  it("a live tank carries no blockers", () => {
    expect(reachBlockers([u({ vid: 1, team: 1 }), u({ vid: 2, x: 10 })], u({ vid: 1, team: 1 }), 2)).toEqual([]);
  });
});
