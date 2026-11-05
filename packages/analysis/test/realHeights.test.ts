import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { heightField, heightAt, realHeightAt, REAL_HEIGHT_CELL_M, type RealHeights } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

/** Synthetic real heights: two 3x3 chunks, values chosen so bilinear results are exact by hand.
 *  Chunk (0,0): data[r*3+c] = r*10 + c (row = z, col = x). Chunk (1,0): every sample 50. */
function synthetic(): RealHeights {
  const a = new Float32Array([0, 1, 2, 10, 11, 12, 20, 21, 22]);
  const b = new Float32Array(9).fill(50);
  return { chunkSize: 100, chunks: new Map([["0,0", { locX: 0, locY: 0, w: 3, h: 3, data: a }], ["1,0", { locX: 1, locY: 0, w: 3, h: 3, data: b }]]), minM: 0, maxM: 50 };
}

describe("realHeightAt", () => {
  const real = synthetic(), off = { dx: 0, dz: 0 };
  it("reads exact grid points", () => {
    expect(realHeightAt(real, off, 0, 0)).toBe(0);
    expect(realHeightAt(real, off, 50, 0)).toBe(1);
    expect(realHeightAt(real, off, 0, 50)).toBe(10);
    expect(realHeightAt(real, off, 50, 50)).toBe(11);
  });
  it("reads a chunk's edge sample from just inside, and the neighbour's from the boundary", () => {
    // x = 100 is the first column of chunk (1,0); chunk (0,0)'s last column is read just inside it
    expect(realHeightAt(real, off, 99.9, 0)).toBeCloseTo(2, 1);
    expect(realHeightAt(real, off, 100, 0)).toBe(50);
    expect(realHeightAt(real, off, 50, 100)).toBeNull(); // chunk (0,1) is not loaded
  });
  it("bilinear-interpolates between samples", () => {
    expect(realHeightAt(real, off, 25, 75)).toBeCloseTo(15.5, 9);
    expect(realHeightAt(real, off, 75, 25)).toBeCloseTo(6.5, 9);
  });
  it("is continuous across a chunk boundary", () => {
    // last column of chunk (0,0) is 2/12/22, first column of chunk (1,0) is 50: the boundary jumps,
    // but sampling just inside each side reads that side's edge exactly
    expect(realHeightAt(real, off, 99.9, 50)).toBeCloseTo(11.99, 1);
    expect(realHeightAt(real, off, 100.1, 50)).toBeCloseTo(50, 9);
  });
  it("returns null outside the covered chunks", () => {
    expect(realHeightAt(real, off, -1, 50)).toBeNull();
    expect(realHeightAt(real, off, 50, -1)).toBeNull();
    expect(realHeightAt(real, off, 250, 50)).toBeNull();
    expect(realHeightAt(real, off, 50, 150)).toBeNull();
  });
  it("shifts world coordinates by the offset", () => {
    expect(realHeightAt(real, { dx: -300, dz: 0 }, 300, 0)).toBe(0);
    expect(realHeightAt(real, { dx: -300, dz: 0 }, 0, 0)).toBeNull();
  });
});

describe("heightField with real heights", () => {
  const xs = Object.values(tl.tracks).flatMap((t) => t.x), zs = Object.values(tl.tracks).flatMap((t) => t.z);
  const b = { x0: Math.min(...xs) - 40, x1: Math.max(...xs) + 40, z0: Math.min(...zs) - 40, z1: Math.max(...zs) + 40 };
  // flat 50 m over the whole map, in the fixture's own coordinates (offset 0, chunks sized to cover it)
  const flat = (): RealHeights => {
    const chunks = new Map<string, { locX: number; locY: number; w: number; h: number; data: Float32Array }>();
    // one chunk of padding: the last field column's centre can sit past the bounds edge
    for (let lx = Math.floor(b.x0 / 100) - 1; lx <= Math.floor(b.x1 / 100) + 1; lx++)
      for (let ly = Math.floor(b.z0 / 100) - 1; ly <= Math.floor(b.z1 / 100) + 1; ly++)
        chunks.set(`${lx},${ly}`, { locX: lx, locY: ly, w: 3, h: 3, data: new Float32Array(9).fill(50) });
    return { chunkSize: 100, chunks, minM: 50, maxM: 50 };
  };
  const guessed = heightField(tl, b), real = heightField(tl, b, 25, { heights: flat(), offset: { dx: 0, dz: 0 } });
  it("overwrites covered cells with the measured value and marks them seen", () => {
    for (let i = 0; i < real.h.length; i++) { expect(real.h[i]).toBe(50); expect(real.seen[i]).toBe(1); }
  });
  it("keeps the guessed field where there is no real data", () => {
    const empty: RealHeights = { chunkSize: 100, chunks: new Map(), minM: 0, maxM: 0 };
    const f = heightField(tl, b, 25, { heights: empty, offset: { dx: 0, dz: 0 } });
    expect(f.h).toEqual(guessed.h); expect(f.seen).toEqual(guessed.seen);
  });
  it("builds a finer field at REAL_HEIGHT_CELL_M when real data is loaded", () => {
    expect(REAL_HEIGHT_CELL_M).toBe(5);
    const f5 = heightField(tl, b, REAL_HEIGHT_CELL_M, { heights: flat(), offset: { dx: 0, dz: 0 } });
    expect(f5.cell).toBe(5); expect(f5.cols).toBeGreaterThan(real.cols); expect(f5.rows).toBeGreaterThan(real.rows);
    for (let i = 0; i < f5.h.length; i++) { expect(f5.h[i]).toBe(50); expect(f5.seen[i]).toBe(1); }
  });
  it("fills cells no tank visited when the real data covers them", () => {
    // find a cell the guess had to invent (seen 0) and check the real field measures it
    let i = -1; for (let k = 0; k < guessed.seen.length; k++) if (!guessed.seen[k]!) { i = k; break; }
    expect(i).toBeGreaterThanOrEqual(0); expect(real.seen[i]!).toBe(1); expect(real.h[i]).toBe(50);
    expect(heightAt(real, b.x0 + (i % real.cols) * 25, b.z0 + Math.floor(i / real.cols) * 25)).toBe(50);
  });
});
