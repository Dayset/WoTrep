import { describe, expect, it } from "vitest";
import { estimateReload, reloadProgress } from "../src/reload";

describe("reloadProgress", () => {
  it("shows the averaged reload as progress while reloading, and nothing when ready", () => {
    const times = [0, 10, 20, 30];
    const est = estimateReload(times);
    expect(est.avgReloadS).toBeCloseTo(10);
    expect(reloadProgress(times, est, 35)).toBeCloseTo(0.5);
    expect(reloadProgress(times, est, 50)).toBeNull();
  });
});
