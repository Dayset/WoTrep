import { describe, expect, it } from "vitest";
import { parseObstacles } from "@wotrep/analysis";
import { isObstacles } from "../src/lib/obstaclesStore";

/** A minimal obstacles JSON in the extractor's format: one building model + placement,
 *  one tree, one water body. */
function makeFile() {
  return {
    manifest: { map: "101_dday" },
    models: [{ id: 0, name: "Vhouse", hit_type: "static", hull_min: [0, 0, 0], hull_max: [10, 5, 8], hull_h: 5, kind: "building", fragile: null, materials: ["concrete"] }],
    placements: [{ model_id: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 30, 200, 1], footprint: [[95, 30, 196], [105, 30, 196], [105, 30, 204], [95, 30, 204]], height_m: 35, pos: [100, 30, 200], yaw: 0, kind: "building", destructible: false, extras: 0, visibility_mask: 1 }],
    trees: [{ pos: [150, 32, 210], srt: "tree.srt", seed: 7, scale: 1.2 }],
    water: [{ rect: [[-560, -162], [-162, 100]], surface_y: 29 }],
  };
}

describe("obstaclesStore shape guard", () => {
  it("accepts the parsed object — the shape saveObstacles stores", () => {
    const parsed = parseObstacles(makeFile());
    expect(parsed.map).toBe("101_dday");
    expect(isObstacles(parsed)).toBe(true);
  });
  it("rejects the raw file JSON — it has no top-level map", () => {
    expect(isObstacles(makeFile())).toBe(false);
  });
  it("rejects corrupt or partial shapes", () => {
    expect(isObstacles(null)).toBe(false);
    expect(isObstacles({ map: "101_dday" })).toBe(false);
    const parsed = parseObstacles(makeFile()) as unknown as Record<string, unknown>;
    expect(isObstacles({ ...parsed, water: undefined })).toBe(false);
  });
  it("documents why load must not re-parse the stored object", () => {
    // parseObstacles validates the extractor's file format (manifest required); the
    // stored parsed object has no manifest, so re-parsing it throws and loadObstacles
    // used to return null forever — the saved obstacles never appeared.
    expect(() => parseObstacles(parseObstacles(makeFile()))).toThrow(/manifest/);
  });
});
