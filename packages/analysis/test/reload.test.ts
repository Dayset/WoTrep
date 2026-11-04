import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { estimateReload, reloadStateAt, shotTimes } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

/** Tsunemikih's TDM-54, the tank docs/analysis/first-replay.md follows. */
const TDM = 13908133;

describe("reload estimator (#38 acceptance, Lesta fixture)", () => {
  it("TDM-54 bursts at 3:56–3:59, 4:13–4:17, 4:46–4:48", () => {
    const times = shotTimes(tl, TDM);
    const inWin = (a: number, b: number) => times.filter((t) => t >= a && t <= b).length;
    expect(inWin(236, 240)).toBeGreaterThanOrEqual(6);
    expect(inWin(253, 258)).toBeGreaterThanOrEqual(6);
    expect(inWin(286, 289)).toBeGreaterThanOrEqual(6);
  });
  it("state at 4:12 is ready (the issue's 'loaded') with confidence ≥ 0.6", () => {
    const times = shotTimes(tl, TDM);
    const st = reloadStateAt(times, estimateReload(times), 252);
    expect(st.state).toBe("ready");
    expect(st.confidence).toBeGreaterThanOrEqual(0.6);
  });
  it("recorder SBM-44: six ~10-shell clips", () => {
    const times = shotTimes(tl, tl.recorder.vid);
    expect(times.length).toBe(61);
    const est = estimateReload(times);
    expect(est.clipSize).toBe(10);
    expect(est.confidence).toBeGreaterThanOrEqual(0.6);
  });
});

describe("reload estimator (synthetic)", () => {
  const times = [0, 0.3, 0.6, 10, 10.3, 10.6, 20, 20.3, 20.6];
  it("learns clip size and reload from bursts", () => {
    const est = estimateReload(times);
    expect(est.clipSize).toBe(3);
    expect(est.reloadS).toBeCloseTo(9.4, 5);
  });
  it("reports reloading between clips, bursting mid-clip", () => {
    const est = estimateReload(times);
    const between = reloadStateAt(times, est, 5);
    expect(between.state).toBe("reloading");
    expect(between.secondsLeft).toBeCloseTo(5, 5);
    expect(reloadStateAt(times, est, 20.5)).toMatchObject({ state: "bursting", shotsInClip: 1 });
  });
});
