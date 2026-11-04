import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { heightField, heightAt, tracerLines, aimAt } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("terrain from tracks", () => {
  const xs = Object.values(tl.tracks).flatMap((t) => t.x), zs = Object.values(tl.tracks).flatMap((t) => t.z), b = { x0: Math.min(...xs) - 40, x1: Math.max(...xs) + 40, z0: Math.min(...zs) - 40, z1: Math.max(...zs) + 40 };
  const f = heightField(tl, b);
  it("reproduces the heights tanks stood at (median error under 3 m)", () => {
    const err: number[] = []; for (const tr of Object.values(tl.tracks)) for (let i = 0; i < tr.t.length; i += 37) if (tr.y[i]! > 0) err.push(Math.abs(heightAt(f, tr.x[i]!, tr.z[i]!) - tr.y[i]!)); err.sort((a, c) => a - c);
    expect(err.length).toBeGreaterThan(50); expect(err[err.length >> 1]!).toBeLessThan(3);
  });
  it("stays inside the range of observed heights and has no holes", () => {
    const ys = Object.values(tl.tracks).flatMap((t) => t.y).filter((y) => y > 0); const lo = Math.min(...ys), hi = Math.max(...ys);
    for (const v of f.h) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThan(lo - 1); expect(v).toBeLessThan(hi + 1); }
  });
});
describe("shell heights and gun elevation", () => {
  it("drops end heights that the game reports as 0 and keeps the rest", () => {
    const ts = tracerLines(tl, {}); expect(ts.some((x) => x.y1 === null)).toBe(true); expect(ts.some((x) => x.y1 != null)).toBe(true); for (const x of ts) if (x.y1 != null) expect(x.y1).toBeGreaterThan(1);
  });
  it("gives a small elevation for a flat shot", () => {
    const s = tracerLines(tl, { vid: tl.recorder.vid }).find((x) => x.y1 != null && Math.hypot(x.x1 - x.x0, x.z1 - x.z0) > 100)!, a = aimAt(tl, tl.recorder.vid, s.t)!;
    expect(Math.abs(a.pitch)).toBeLessThan(0.15);
  });
});
