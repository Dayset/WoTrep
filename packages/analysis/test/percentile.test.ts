import { describe, expect, it } from "vitest";
import { percentileRank } from "../src/index";

describe("percentileRank", () => {
  it("top value is 100, bottom is one share, median sits near 50", () => {
    const vs = [10, 20, 30, 40];
    expect(percentileRank(vs, 40)).toBe(100);
    expect(percentileRank(vs, 10)).toBe(25);
    expect(percentileRank(vs, 20)).toBe(50);
  });
  it("ties count every equal value", () => {
    expect(percentileRank([5, 5, 5], 5)).toBe(100);
    expect(percentileRank([5, 5, 10], 5)).toBe(67);
  });
  it("empty input → null", () => {
    expect(percentileRank([], 5)).toBeNull();
  });
});
