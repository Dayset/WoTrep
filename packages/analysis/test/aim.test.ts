import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { aimAt, tracerLines } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value, rec = tl.recorder.vid, shots = tracerLines(tl, { vid: rec }).filter((s) => Math.hypot(s.x1 - s.x0, s.z1 - s.z0) >= 3);
const diff = (a: number, b: number) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

describe("aimAt", () => {
  it("points along the shell path at the moment of a shot and resets the aim counter", () => {
    const s = shots[2]!, a = aimAt(tl, rec, s.t)!; expect(diff(a.yaw, Math.atan2(s.x1 - s.x0, s.z1 - s.z0))).toBeLessThan(0.02); expect(a.aimS).toBeLessThan(0.05);
  });
  it("aims for about the configured time when nothing moves, never longer", () => {
    const k = shots.findIndex((x, i) => i > 0 && (shots[i + 1]?.t ?? 1e9) - x.t > 4), s = shots[k]!, a = aimAt(tl, rec, s.t + 0.9)!; expect(a.aimS).toBeGreaterThan(0.5); expect(a.aimS).toBeLessThanOrEqual(2.3); expect(a.aimProgress).toBeLessThanOrEqual(1);
  });
  it("never turns faster than the assumed traverse speed", () => {
    let worst = 0; for (let t = 5; t < 400; t += 0.25) { const p = aimAt(tl, rec, t), q = aimAt(tl, rec, t + 0.25); if (p && q && !shots.some((x) => x.t > t && x.t <= t + 0.25)) worst = Math.max(worst, diff(p.yaw, q.yaw) / 0.25); }   // a shot can snap the turret to the true direction if the assumed speed was too slow
    expect(worst).toBeLessThan((31 * Math.PI) / 180 + 0.8);   // allows for the hull turning underneath (turret follows the hull when idle)
  });
  it("returns null for a tank with no known position", () => { expect(aimAt(tl, 1, 0)).toBeNull(); });
});
