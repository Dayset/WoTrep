import { describe, expect, it } from "vitest";
import { terrainPlacement } from "../src/index";

describe("terrainPlacement", () => {
  it("places Overlord's real heights 300 m west of replay coordinates", () => {
    expect(terrainPlacement("101_dday")).toMatchObject({ offset: { dx: -300, dz: 0 }, chunkSizeM: 100 });
  });
  it("returns null for a map with no measured placement", () => {
    expect(terrainPlacement("101_dday_x")).toBeNull();
    expect(terrainPlacement("")).toBeNull();
  });
});
