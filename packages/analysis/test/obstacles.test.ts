import { describe, expect, it } from "vitest";
import {
  parseObstacles, filterOutland, solidFootprints, blockingStructures, sightBlockers,
  pointInQuad, segmentBlocked, buildBlockerIndex, type HeightField, type SightBlocker, type Vec3,
} from "../src/index";

/** Minimal valid obstacles JSON in the extractor's shape: one static house, one fragile
 *  fence with no collision hull (footprint null), one oak, one water body. */
function validJson(): Record<string, unknown> {
  return {
    manifest: { map: "101_dday" },
    models: [
      { id: 0, name: "content/buildings/house", hit_type: "static", hull_min: [-5, 0, -5], hull_max: [5, 8, 5], hull_h: 8, materials: [], fragile: null, kind: "building" },
      { id: 1, name: "content/props/fence", hit_type: "fragile", hull_min: [-2, 0, 0], hull_max: [2, 1, 0.5], hull_h: 1, materials: [], fragile: { destroyed_model_index: 2 }, kind: "fence" },
      { id: 2, name: "content/buildings/basilica", hit_type: "fragile", hull_min: [-15, 0, -10], hull_max: [15, 30, 10], hull_h: 30, materials: ["d_stone|1"], fragile: { destroyed_model_index: 4294967295 }, kind: "building" },
    ],
    placements: [
      { model_id: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 50, 200, 1], pos: [100, 50, 200], yaw: 0, footprint: [[95, 50, 195], [105, 50, 195], [105, 50, 205], [95, 50, 205]], height_m: 58, kind: "building", destructible: false, extras: 1, visibility_mask: 1 },
      { model_id: 1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], pos: [0, 0, 0], yaw: 0, footprint: null, height_m: null, kind: "fence", destructible: true, extras: 0, visibility_mask: 1 },
      { model_id: 2, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -500, 40, -500, 1], pos: [-500, 40, -500], yaw: 0, footprint: [[-515, 40, -510], [-485, 40, -510], [-485, 40, -490], [-515, 40, -490]], height_m: 70, kind: "building", destructible: true, extras: 0, visibility_mask: 1 },
    ],
    trees: [
      { pos: [10, 20, 30], srt: "vegetation/oak.srt", seed: 1, scale: 1 },
      { pos: [20, 20, 30], srt: "vegetation/Broadleaves/Shrubs/Bush_Wild.srt", seed: 2, scale: 1.3 },
    ],
    water: [{ rect: [[-500, -800], [-200, 700]], surface_y: 29 }],
  };
}

describe("parseObstacles", () => {
  it("parses a valid document, dropping the footprint y", () => {
    const o = parseObstacles(validJson());
    expect(o.map).toBe("101_dday"); expect(o.models.length).toBe(3); expect(o.placements.length).toBe(3);
    expect(o.placements[0]!.footprint).toEqual([[95, 195], [105, 195], [105, 205], [95, 205]]);
    expect(o.placements[0]!.heightM).toBe(58); expect(o.placements[0]!.baseY).toBe(50); expect(o.placements[1]!.footprint).toBeNull(); expect(o.placements[1]!.baseY).toBeNull();
    expect(o.trees.length).toBe(2); expect(o.water[0]!.surfaceY).toBe(29);
  });
  it("rejects a non-object top level and a missing manifest map", () => {
    expect(() => parseObstacles(null)).toThrow(/top level/);
    expect(() => parseObstacles({})).toThrow(/manifest\.map/);
  });
  it("rejects a footprint that is not 4 corners and a matrix that is not 16 floats", () => {
    const badFp = validJson(); (badFp["placements"] as Record<string, unknown>[])[0]!["footprint"] = [[0, 0, 0], [1, 0, 0]];
    expect(() => parseObstacles(badFp)).toThrow(/footprint/);
    const badMx = validJson(); (badMx["placements"] as Record<string, unknown>[])[0]!["matrix"] = [1, 2, 3];
    expect(() => parseObstacles(badMx)).toThrow(/matrix/);
  });
  it("rejects a placement naming an unknown model and a non-finite number", () => {
    const badId = validJson(); (badId["placements"] as Record<string, unknown>[])[0]!["model_id"] = 99;
    expect(() => parseObstacles(badId)).toThrow(/no model/);
    const badNum = validJson(); (badNum["placements"] as Record<string, unknown>[])[0]!["yaw"] = Number.NaN;
    expect(() => parseObstacles(badNum)).toThrow(/finite/);
  });
  it("rejects a bad kind and a bad hit type", () => {
    const badKind = validJson(); (badKind["models"] as Record<string, unknown>[])[0]!["kind"] = "castle";
    expect(() => parseObstacles(badKind)).toThrow(/kind/);
    const badHit = validJson(); (badHit["models"] as Record<string, unknown>[])[0]!["hit_type"] = "ghost";
    expect(() => parseObstacles(badHit)).toThrow(/hit_type/);
  });
});

describe("filterOutland", () => {
  it("drops placements by footprint centroid and trees by position, keeps water", () => {
    const o = parseObstacles(validJson());
    const f = filterOutland(o, { x0: 0, x1: 200, z0: 0, z1: 300 }, 25);
    expect(f.placements.map((p) => p.modelId)).toEqual([0, 1]); // basilica at (-500,-500) is out
    expect(f.trees.map((t) => t.pos[0])).toEqual([10, 20]);
    expect(f.water.length).toBe(1); expect(f.models.length).toBe(3); // models kept whole
  });
  it("keeps a placement just inside the margin and drops one just outside", () => {
    const o = parseObstacles(validJson());
    const edge = { ...o.placements[0]!, footprint: [[224, 195], [226, 195], [226, 205], [224, 205]] as [[number, number], [number, number], [number, number], [number, number]] };
    const keep = filterOutland({ ...o, placements: [edge] }, { x0: 0, x1: 200, z0: 0, z1: 300 }, 25);
    expect(keep.placements.length).toBe(1); // centroid x=225 = 200+25, on the margin
    const out = { ...edge, footprint: [[226, 195], [228, 195], [228, 205], [226, 205]] as [[number, number], [number, number], [number, number], [number, number]] };
    expect(filterOutland({ ...o, placements: [out] }, { x0: 0, x1: 200, z0: 0, z1: 300 }, 25).placements.length).toBe(0);
  });
});

describe("blocker sets", () => {
  it("solidFootprints takes static hull > 1 only; blockingStructures adds tall fragile", () => {
    const o = parseObstacles(validJson());
    expect(solidFootprints(o).map((p) => p.modelId)).toEqual([0]);
    expect(blockingStructures(o).map((p) => p.modelId)).toEqual([0, 2]); // basilica: fragile, 30 m
  });
  it("sightBlockers adds trees as canopy quads, bushes low", () => {
    const o = parseObstacles(validJson());
    const b = sightBlockers(o);
    const trees = b.filter((x) => x.kind === "tree");
    expect(trees.length).toBe(2);
    expect(trees[0]!.top).toBeCloseTo(20 + 10, 9); // oak: pos.y 20 + 10 m
    expect(trees[1]!.top).toBeCloseTo(20 + 1.5 * 1.3, 9); // bush: 1.5 m * scale
    expect(trees[0]!.quad[1]![0]! - trees[0]!.quad[0]![0]!).toBeCloseTo(4, 9); // 2 * radius 2 m
  });
});

describe("pointInQuad", () => {
  const q: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  it("inside, outside, on an edge", () => {
    expect(pointInQuad(5, 5, q)).toBe(true);
    expect(pointInQuad(11, 5, q)).toBe(false);
    expect(pointInQuad(-1, 5, q)).toBe(false);
    expect(pointInQuad(0, 5, q)).toBe(true);
  });
  it("works on a rotated quad", () => {
    const r: [[number, number], [number, number], [number, number], [number, number]] = [[5, 0], [10, 5], [5, 10], [0, 5]];
    expect(pointInQuad(5, 5, r)).toBe(true);
    expect(pointInQuad(9, 9, r)).toBe(false);
  });
});

/** Flat field at height 0 over x,z in [0,100]; a hill variant with 20 m ground at x 80..100
 *  (the bilinear ramp starts one cell before it, so the line first hits ground at x=75). */
function flatField(): HeightField {
  return { x0: 0, z0: 0, cell: 10, cols: 11, rows: 11, h: new Float32Array(121).fill(0), seen: new Uint8Array(121).fill(1) };
}
function hillField(): HeightField {
  const f = flatField();
  for (let r = 0; r < 11; r++) for (let c = 8; c <= 10; c++) f.h[r * 11 + c] = 20;
  return f;
}
const wall: SightBlocker = { quad: [[45, -5], [55, -5], [55, 5], [45, 5]], top: 10, kind: "building" };
const lowWall: SightBlocker = { quad: [[45, -5], [55, -5], [55, 5], [45, 5]], top: 1, kind: "fence" };

describe("segmentBlocked", () => {
  it("a wall across the line blocks, a gap beside it passes", () => {
    expect(segmentBlocked([0, 2.5, 0], [100, 2.5, 0], flatField(), [wall])?.kind).toBe("building");
    expect(segmentBlocked([0, 2.5, 20], [100, 2.5, 20], flatField(), [wall])).toBeNull();
  });
  it("a low wall passes under the line", () => {
    expect(segmentBlocked([0, 2.5, 0], [100, 2.5, 0], flatField(), [lowWall])).toBeNull();
  });
  it("a hill blocks as terrain, and the earliest hit wins", () => {
    const hit = segmentBlocked([0, 2.5, 0], [100, 2.5, 0], hillField(), []);
    expect(hit?.kind).toBe("terrain"); expect(hit!.t).toBeGreaterThan(0.6); expect(hit!.t).toBeLessThan(0.9);
    const both = segmentBlocked([0, 2.5, 0], [100, 2.5, 0], hillField(), [wall]);
    expect(both?.kind).toBe("building"); // wall at t=0.45 beats the hill at t=0.75
  });
  it("a clear line over flat ground passes, and a zero-length segment passes", () => {
    expect(segmentBlocked([0, 2.5, 0], [100, 2.5, 0], flatField(), [])).toBeNull();
    expect(segmentBlocked([50, 2.5, 0], [50, 2.5, 0], flatField(), [wall])).toBeNull();
  });
  it("a ray ending inside a quad is blocked at its entry, like one starting inside it", () => {
    // A tree canopy over (0,0): the eye at (0,2.5,0) sits inside it.
    const tree: SightBlocker = { quad: [[-5, -5], [5, -5], [5, 5], [-5, 5]], top: 20, kind: "tree" };
    expect(segmentBlocked([0, 2.5, 0], [100, 2.5, 0], flatField(), [tree])?.kind).toBe("tree"); // starts inside: t = 0
    const back = segmentBlocked([100, 2.5, 0], [0, 2.5, 0], flatField(), [tree]);
    expect(back?.kind).toBe("tree"); // ends inside: blocked at the entry (x = 5), not clear
    expect(back!.t).toBeCloseTo(0.95, 9);
    expect(back!.at[0]).toBeCloseTo(5, 9);
  });
  it("a ray ending inside a building is blocked at the entry wall", () => {
    const hit = segmentBlocked([0, 2.5, 0], [50, 2.5, 0], flatField(), [wall]); // ends at x = 50, inside the wall
    expect(hit?.kind).toBe("building");
    expect(hit!.t).toBeCloseTo(0.9, 9); // entry at x = 45
    expect(hit!.at[0]).toBeCloseTo(45, 9);
    const out = segmentBlocked([50, 2.5, 0], [0, 2.5, 0], flatField(), [wall]); // starts inside: t = 0
    expect(out?.kind).toBe("building"); expect(out!.t).toBe(0);
  });
  it("the grid index agrees with the unindexed scan", () => {
    const blockers: SightBlocker[] = [wall, lowWall, { quad: [[80, 80], [90, 80], [90, 90], [80, 90]], top: 30, kind: "rock" }];
    const idx = buildBlockerIndex(blockers);
    const cases: [Vec3, Vec3][] = [
      [[0, 2.5, 0], [100, 2.5, 0]], [[0, 2.5, 20], [100, 2.5, 20]], [[0, 2.5, 85], [100, 2.5, 85]],
      [[85, 2.5, 0], [85, 2.5, 100]], [[100, 2.5, 0], [50, 2.5, 0]], // ends inside the wall
    ];
    for (const [from, to] of cases) {
      const a = segmentBlocked(from, to, flatField(), blockers);
      const b = segmentBlocked(from, to, flatField(), blockers, idx);
      if (a === null || b === null) expect(b).toBe(a);
      else { expect(b.kind).toBe(a.kind); expect(b.t).toBeCloseTo(a.t, 9); }
    }
  });
});
