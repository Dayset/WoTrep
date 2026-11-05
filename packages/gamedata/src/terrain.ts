/** Placement of a map's real heights (extracted from its game files) onto replay coordinates.
 *  Chunk-space x = replay x + offset.dx, chunk-space z = replay z + offset.dz. The offset is
 *  measured per map by fitting replay track heights against the extracted heights; it is NOT
 *  in the game files. Maps without an entry have no measured placement, so their real heights
 *  cannot be used yet. Open question (docs/FINDINGS.md, 2026-11-05): the offset may be the
 *  negative of the arena boundingBox centre — check against an arena XML when one is on hand. */
export interface TerrainPlacement {
  offset: { dx: number; dz: number };
  chunkSizeM: number;
  provenance: { why: string; n: number; date: string };
}
export const MAP_TERRAIN: Record<string, TerrainPlacement> = {
  "101_dday": {
    offset: { dx: -300, dz: 0 },
    chunkSizeM: 100,
    provenance: {
      why: "fit of 51,469 track heights from the Lesta 1.46 Overlord fixture against heights extracted from the EU 2.4 client 101_dday.pkg (median err +0.03 m, median |err| 0.23 m)",
      n: 51469,
      date: "2026-11-05",
    },
  },
};
export function terrainPlacement(map: string): TerrainPlacement | null { return MAP_TERRAIN[map] ?? null; }
