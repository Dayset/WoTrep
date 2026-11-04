import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { shootingStats } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture");
const base = r.value;
const name = (vid: number) => base.vehicles.find((v) => v.vid === vid)!.name;

describe("shootingStats", () => {
  it("fixture: reproduces the first-replay clip table (6 clips, 46/342/493/136/52/293)", () => {
    const s = shootingStats(base);
    expect(s.vid).toBe(base.recorder.vid);
    expect(s.shells).toBe(61);
    expect(s.pens).toBe(28);
    expect(s.dmg).toBe(1362);
    expect(s.clips.map((c) => c.shells)).toEqual([10, 10, 10, 10, 11, 10]);
    expect(s.clips.map((c) => c.dmg)).toEqual([46, 342, 493, 136, 52, 293]);
    expect(s.clips.map((c) => c.pens)).toEqual([1, 7, 10, 3, 1, 6]);
    expect(s.clips.map((c) => c.targets.length)).toEqual([1, 1, 1, 3, 1, 1]);
    expect(s.clips.map((c) => c.targets.map(name))).toEqual([
      ["TheKaraBAS"], ["sergey126161"], ["X30D"],
      ["Chelove4ik1208", "sergey126161", "Tsunemikih"], ["Tsunemikih"], ["Tsunemikih"],
    ]);
    expect(s.clips.map((c) => c.t0)).toEqual([38.2, 122.8, 175.4, 201.79, 268.29, 286.29]);
    expect(s.clips.map((c) => Math.round(c.durationS * 10) / 10)).toEqual([38.8, 2.4, 3.3, 52.1, 2.4, 2.4]);
  });
  it("fixture: sniper seconds and per-shot speeds match the doc", () => {
    const s = shootingStats(base);
    expect(s.sniperSegments).toBe(23);
    expect(s.sniperS).toBeCloseTo(75, 0);
    expect(s.aimS).toBeNull();
    const speed = (clip: number, shot: number) => s.clips[clip]!.shots[shot]!.speedKmh;
    expect(speed(0, 0)).toBeLessThanOrEqual(19);
    expect(speed(1, 0)).toBe(0);
    expect(speed(2, 0)).toBe(12);
    for (const c of s.clips) for (const sh of c.shots) expect(sh.speedKmh).toBeGreaterThanOrEqual(0);
  });
  it("synthetic: bursts accumulate into clips, an over-full burst closes at once, single-shot guns get one clip per shot", () => {
    const me = base.recorder.vid, foe = base.vehicles.find((v) => v.team !== base.recorder.team)!.vid;
    const shot = (t: number) => ({ k: "shot" as const, t, shooter: me });
    const dmg = (t: number, amount: number) => ({ k: "damage" as const, t, attacker: me, target: foe, amount, hpBefore: 0, hpAfter: 0, reason: 0 });
    const events = [
      ...[0, 0.3, 0.6].map(shot), ...[20, 20.3].map(shot),
      ...[40, 40.3, 40.6].map(shot), dmg(41, 100),
    ];
    const tl = { ...base, events: [...events].sort((a, b) => a.t - b.t) };
    const s = shootingStats(tl);
    expect(s.clips.map((c) => c.shells)).toEqual([3, 5]);
    expect(s.clips[1]!.dmg).toBe(100);
    expect(s.clips[1]!.pens).toBe(1);
  });
  it("unknown subject: empty clips, recorder-only camera stats null", () => {
    const s = shootingStats(base, 999999);
    expect(s.clips).toEqual([]);
    expect(s.shells).toBe(0);
    expect(s.sniperS).toBeNull();
  });
});
