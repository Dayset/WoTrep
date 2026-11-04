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
