/** Trainer view cones. Values are game-wide, not per tank, so a tank with a shorter view range is drawn too far out.
 *  Thresholds live here with provenance, per AGENTS.md §8. */
export const VIEW_RANGE_M = { value: 445, why: "game maximum view range, same as packages/analysis maxSpotterM", n: 0, date: "2026-11-04" } as const;
export const VIEW_FOV_DEG = { value: 65, why: "horizontal field of view used by the POV camera and minimap", n: 0, date: "2026-11-04" } as const;
export const VIEW_ALPHA = { value: 0.2, why: "trainer cones drawn at 20% visibility so overlaps stay readable", n: 0, date: "2026-11-04" } as const;
