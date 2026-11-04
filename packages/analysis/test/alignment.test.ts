import { describe, expect, it } from "vitest";
import { yawGapDeg } from "../src/alignment";

describe("yawGapDeg", () => {
  it("is 0 for the same heading and wraps around the circle", () => {
    expect(yawGapDeg(1, 1)).toBeCloseTo(0);
    expect(yawGapDeg(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(0.2 * 180 / Math.PI);
  });
  it("reports the opposite side as 180", () => {
    expect(yawGapDeg(0, Math.PI)).toBeCloseTo(180);
  });
});

import { teamCoherence } from "../src/alignment";
describe("teamCoherence", () => {
  it("averages pair shares and reports each member", () => {
    const yaw = new Map<number, (number | null)[]>([[1, [0, 0, 0]], [2, [0, 0, 1]], [3, [3, 3, 3]]]);
    const r = teamCoherence({ t: [0, 1, 2], yaw }, [1, 2, 3]);
    expect(r.members.find((m) => m.vid === 3)!.share).toBeCloseTo(0);
    expect(r.members.find((m) => m.vid === 1)!.share).toBeCloseTo(1 / 3);
    expect(r.avg).toBeCloseTo((2 / 3 + 0 + 0) / 3);
  });
});
