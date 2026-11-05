import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseHeightsZip } from "../src/lib/heightsStore";

/** A minimal heights ZIP in the extractor's format: manifest + two 2x2 float32 chunk grids. */
function makeZip(map = "101_dday"): Uint8Array {
  const manifest = JSON.stringify({
    map, chunk_size: 100, bounds: [0, 1, 0, 0], sample_scale_m: 0.001, encoding: "float32 little-endian metres",
    chunks: [
      { loc_x: 0, loc_y: 0, file: "chunks/chunk_000.bin", w: 2, h: 2, min_m: 10, max_m: 13, method: "rgba32-le" },
      { loc_x: 1, loc_y: 0, file: "chunks/chunk_001.bin", w: 2, h: 2, min_m: 20, max_m: 23, method: "rgba32-le" },
    ],
  });
  const grid = (base: number) => new Uint8Array(new Float32Array([base, base + 1, base + 2, base + 3]).buffer);
  return zipSync({ "manifest.json": new TextEncoder().encode(manifest), "chunks/chunk_000.bin": grid(10), "chunks/chunk_001.bin": grid(20) });
}

describe("parseHeightsZip", () => {
  it("reads the manifest and chunk grids", () => {
    const h = parseHeightsZip(makeZip().buffer as ArrayBuffer, "101_dday");
    expect(h.chunkSize).toBe(100); expect(h.chunks.size).toBe(2); expect(h.minM).toBe(10); expect(h.maxM).toBe(23);
    expect(Array.from(h.chunks.get("0,0")!.data)).toEqual([10, 11, 12, 13]);
    expect(Array.from(h.chunks.get("1,0")!.data)).toEqual([20, 21, 22, 23]);
  });
  it("rejects heights for another map", () => {
    expect(() => parseHeightsZip(makeZip("101_dday_x").buffer as ArrayBuffer, "101_dday")).toThrow(/not 101_dday/);
  });
  it("rejects a zip without a manifest", () => {
    const z = zipSync({ "chunks/chunk_000.bin": new Uint8Array(16) });
    expect(() => parseHeightsZip(z.buffer as ArrayBuffer, "101_dday")).toThrow(/manifest/);
  });
  it("rejects a short chunk", () => {
    const z = zipSync({ "manifest.json": new TextEncoder().encode(JSON.stringify({ map: "101_dday", chunk_size: 100, chunks: [{ loc_x: 0, loc_y: 0, file: "chunks/chunk_000.bin", w: 2, h: 2 }] })), "chunks/chunk_000.bin": new Uint8Array(8) });
    expect(() => parseHeightsZip(z.buffer as ArrayBuffer, "101_dday")).toThrow(/short chunk/);
  });
  it("rejects non-zip bytes", () => {
    expect(() => parseHeightsZip(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, "101_dday")).toThrow(/zip/);
  });
});
