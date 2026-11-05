import { describe, expect, it } from "vitest";
import { isShadowed, shadowPolygon } from "../src/features/player/viewConfig";

type Pt = { x: number; z: number };

function inPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function distToPoly(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)));
  }
  return best;
}

describe("isShadowed", () => {
  const V = { x: 0, z: 0 }, F = { x: 100, z: 0 }; // bubble radius 50
  it("straight through the bubble is shadowed", () => {
    expect(isShadowed(V.x, V.z, 150, 0, F.x, F.z)).toBe(true);
    expect(isShadowed(V.x, V.z, 250, 0, F.x, F.z)).toBe(true);
  });
  it("a line passing near the bubble is shadowed, one passing wide is not", () => {
    expect(isShadowed(V.x, V.z, 150, 60, F.x, F.z)).toBe(true); // closest approach ~37 m
    expect(isShadowed(V.x, V.z, 150, 120, F.x, F.z)).toBe(false); // closest approach ~62 m
  });
  it("ground between the vanish point and the bubble is not shadowed", () => {
    expect(isShadowed(V.x, V.z, 50, 0, F.x, F.z)).toBe(false);
    expect(isShadowed(V.x, V.z, 0, 100, F.x, F.z)).toBe(false);
  });
  it("no shadow when the vanish point is inside the bubble, or the point is the vanish point", () => {
    expect(isShadowed(80, 0, 250, 0, F.x, F.z)).toBe(false);
    expect(isShadowed(V.x, V.z, 0, 0, F.x, F.z)).toBe(false);
  });
});

describe("shadowPolygon", () => {
  const V = { x: 0, z: 0 }, R = 200, F = { x: 100, z: 0 };
  it("starts and ends at the tangent points", () => {
    const p = shadowPolygon(V.x, V.z, R, F.x, F.z);
    expect(p).not.toBeNull();
    expect(p![0].x).toBeCloseTo(75, 0);
    expect(p![0].z).toBeCloseTo(-43.3, 0);
    expect(p![p!.length - 1].x).toBeCloseTo(75, 0);
    expect(p![p!.length - 1].z).toBeCloseTo(43.3, 0);
  });
  it("its arc sits on the reach circle", () => {
    const p = shadowPolygon(V.x, V.z, R, F.x, F.z)!;
    for (const q of p.slice(1, -1)) expect(Math.hypot(q.x, q.z)).toBeCloseTo(R, 0);
  });
  it("contains shadowed points and excludes the rest", () => {
    const p = shadowPolygon(V.x, V.z, R, F.x, F.z)!;
    expect(inPoly({ x: 150, z: 0 }, p)).toBe(true);
    expect(inPoly({ x: 250, z: 0 }, p)).toBe(false); // past the reach circle
    expect(inPoly({ x: 50, z: 0 }, p)).toBe(false);
    expect(inPoly({ x: 150, z: 120 }, p)).toBe(false);
  });
  it("matches the predicate on a grid, up to the arc chord error", () => {
    const p = shadowPolygon(V.x, V.z, R, F.x, F.z)!;
    for (let x = -50; x <= 250; x += 10) for (let z = -150; z <= 150; z += 10) {
      if (Math.hypot(x - F.x, z - F.z) < 50) continue; // bubble interior: the hole's job, not the polygon's
      if (Math.hypot(x, z) > R) continue;
      const pred = isShadowed(V.x, V.z, x, z, F.x, F.z), poly = inPoly({ x, z }, p);
      if (pred !== poly) expect(distToPoly({ x, z }, p)).toBeLessThan(3); // boundary chord error only
    }
  });
  it("is null when the vanish point is inside the bubble or the bubble is clear of the disc", () => {
    expect(shadowPolygon(V.x, V.z, R, 30, 0)).toBeNull();
    expect(shadowPolygon(V.x, V.z, R, 300, 0)).toBeNull();
  });
});
