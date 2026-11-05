import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stateAt, validateTimeline } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value; const ME = tl.recorder.vid;
const u = (t: number, vid: number) => stateAt(tl, t).units.find((x) => x.vid === vid)!;

describe("stateAt", () => {
  it("recorder HP follows the five TDM-54 hits of 4:13-4:15 (253.99 .. 255.19 s)", () => {
    expect(u(253, ME).hp).toBe(1246);
    expect(u(254.1, ME).hp).toBe(1156);
    const mid = u(254.7, ME).hp; expect(mid).toBeGreaterThanOrEqual(911); expect(mid).toBeLessThanOrEqual(1076);
    expect(u(256, ME).hp).toBe(825);
  });
  it("the Britva (killed 2:26) is dead at 3:30 and keeps a ghost position", () => {
    const b = u(210, 13908112); expect(b.alive).toBe(false); expect(b.hp).toBe(0); expect(b.known).toBe("ghost");
  });
  it("never returns live outside a visible interval", () => {
    for (let t = 0; t < 328; t += 2) for (const x of stateAt(tl, t).units) {
      if (x.known !== "live") continue;
      const tr = tl.tracks[x.vid]!; expect(tr.visible.some(([a, b]) => t >= a - 1e-6 && t <= b + 1e-6)).toBe(true);
    }
  });
  it("enemies are never-known before first sighting and ghosts after losing sight", () => {
    const e = tl.vehicles.find((v) => v.team !== tl.recorder.team && tl.tracks[v.vid])!;
    const first = tl.tracks[e.vid]!.t[0]!;
    expect(u(first - 5, e.vid).known).toBe("never");
  });
  it("a vanished tank carries a reach circle that grows with age", () => {
    const SH = 13908105; // shohins2013, last seen 128.8, visible again from 150.6
    const a = u(135, SH), b = u(140, SH);
    expect(a.known).toBe("ghost"); expect(a.ageS).toBeCloseTo(6.2, 1);
    expect(a.reachM).toBeGreaterThan(30); expect(a.reachM).toBeLessThan(40); // ~5.6 m/s fastest x 6.2 s
    expect(b.reachM!).toBeGreaterThan(a.reachM!);
    // the same fastest speed behind both: reach / age is constant as the circle grows
    expect(a.reachM! / a.ageS!).toBeCloseTo(b.reachM! / b.ageS!, 1);
  });
  it("reach is absent for live, never-seen and dead ghosts", () => {
    expect(u(100, ME).reachM).toBeUndefined();
    const e = tl.vehicles.find((v) => v.team !== tl.recorder.team && tl.tracks[v.vid])!;
    expect(u(tl.tracks[e.vid]!.t[0]! - 5, e.vid).reachM).toBeUndefined();
    const d = u(210, 13908112); expect(d.known).toBe("ghost"); expect(d.alive).toBe(false); expect(d.reachM).toBeUndefined();
  });
  it("a reappearing tank drops its reach", () => {
    const r = u(160, 13908105); expect(r.known).toBe("live"); expect(r.reachM).toBeUndefined();
  });
  it("team totals are consistent and fast (60 calls under 60 ms)", () => {
    const s = stateAt(tl, 100); expect(s.alive[1] + s.alive[2]).toBe(s.units.filter((x) => x.alive).length);
    const t0 = performance.now(); for (let i = 0; i < 60; i++) stateAt(tl, i * 5); expect(performance.now() - t0).toBeLessThan(60);
  });
});
