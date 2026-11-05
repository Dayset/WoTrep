/** Map obstacles extracted from a map's game files (docs/FINDINGS.md, 2026-11-05).
 *  The extractor (extract_obstacles_local.py) reads BSMO/BSMI/SpTr/BWWa out of the map's
 *  space.bin and writes one JSON: models (per model type: collision AABB, static/falling/
 *  fragile, per-part materials), placements (per instance: 4x4 transform, oriented footprint
 *  quad from the collision AABB, height), trees (SpTr positions + scale), water (surface
 *  rectangles). Positions are replay/world coords: world x = space x + 300 (the heights fit
 *  says chunk-space x = world x - 300; the first extractor version had the sign backwards and
 *  was caught 2026-11-05 by the Y check — with +300 placements sit on the real terrain to a
 *  median -0.02 m). The JSON is user data under ADR-0003: never bundled, never committed.
 *
 *  What the boxes are (and are not): a footprint is the collision AABB, an UPPER bound on the
 *  solid object — a rock cluster's box covers the gaps between the rocks, a cliff face's box
 *  covers the air in front of the slope. Verified 2026-11-05 on the Overlord fixture: tanks
 *  park at footprint edges and drive over rubble/trenches inside boxes, so the boxes are
 *  usable as-is for SIGHT (a rock cluster blocks sight across its whole box) but too crude
 *  for hard drive-blocking (exact .havok meshes would fix that). */

import type { Unit } from "@wotrep/model";
import { heightAt, type HeightField } from "./terrain";

export type Vec3 = [number, number, number];
/** A footprint quad as (x, z) corners in loop order (the y of the lower AABB corners is
 *  dropped: heights come from the placement's heightM and the HeightField). */
export type Quad = [[number, number], [number, number], [number, number], [number, number]];
export type ObstacleKind = "building" | "rock" | "fence" | "tree" | "prop" | "other";
export type HitType = "static" | "falling" | "fragile";

export interface ObstacleModel {
  id: number; name: string; hitType: HitType;
  hullMin: Vec3 | null; hullMax: Vec3 | null; hullH: number;
  kind: ObstacleKind; destructible: boolean; destroyedModelIndex: number | null; materials: string[];
}
export interface ObstaclePlacement {
  modelId: number; matrix: number[]; pos: Vec3; yaw: number;
  footprint: Quad | null; heightM: number | null; baseY: number | null;
  kind: ObstacleKind; destructible: boolean; extras: number; visibilityMask: number;
}
export interface ObstacleTree { pos: Vec3; srt: string; seed: number; scale: number }
export interface WaterBody { rect: [[number, number], [number, number]]; surfaceY: number }
export interface Obstacles { map: string; models: ObstacleModel[]; placements: ObstaclePlacement[]; trees: ObstacleTree[]; water: WaterBody[] }

const KINDS: ObstacleKind[] = ["building", "rock", "fence", "tree", "prop", "other"];
const HITS: HitType[] = ["static", "falling", "fragile"];

/** Outland filter margin (m). BrainNav's rule, via the obstacles research 2026-11-05: a placement
 *  is outland scenery, not an obstacle, when its position lies outside the arena box + 25 m.
 *  Unfiltered, the ring mountains read as blocked (60.1% of nuTerra's monastery map). */
export const OUTLAND_MARGIN_M = 25;
/** Terrain sampling step (m) for line of sight. Matches the finest HeightField cell (5 m with
 *  real heights loaded), so no terrain feature the field knows about is stepped over. 2026-11-05. */
export const LOS_STEP_M = 5;
/** Commander's eye above the ground (m). A tank's viewport is ~2.5 m up; the sight line runs
 *  eye to eye. Initial guess — the exact per-tank height is not decoded. 2026-11-05. */
export const EYE_HEIGHT_M = 2.5;
/** Tree canopy radius at scale 1 (m). SpTr gives position + scale only, no canopy size; a
 *  broadleaf canopy is ~4 m across. Initial guess — refine from .srt data later. 2026-11-05. */
export const TREE_CANOPY_R_M = 2;
/** Tree height at scale 1 (m). A mature broadleaf is ~10 m tall. Initial guess — only the sight
 *  top matters (any tree taller than the sight line blocks the same rays); refine later. 2026-11-05. */
export const TREE_HEIGHT_M = 10;
/** Bush/shrub height at scale 1 (m). Bushes are concealment, not hard cover: a 1.5 m bush does
 *  not block an eye-level (2.5 m) sight line, so including them at this height keeps them
 *  visible on the map without wrongly marking sight unknown. Initial guess. 2026-11-05. */
export const BUSH_HEIGHT_M = 1.5;
/** Blocker grid cell (m) for the line-of-sight index. 50 m cells keep a 445 m sight line to a
 *  handful of candidate footprints instead of all ~1,800. 2026-11-05. */
export const BLOCKER_CELL_M = 50;
/** Tank hull radius (m) for line-of-sight: a tank is a cylinder the sight line must clear.
 *  A hull is ~3 m wide and ~6-7 m long; a circle cannot match both, so 3 m splits the
 *  difference and errs toward blocking — claiming a shot is blocked when it might squeeze
 *  past is the safer side for a trainer (and for a threat marker: fewer false alarms).
 *  Initial guess. 2026-11-05. */
export const TANK_BLOCK_R_M = 3;
/** Tank top height above the ground (m): hull ~1.8 m + turret ~0.9 m. The sight line runs
 *  eye to eye at EYE_HEIGHT_M, so on flat ground a tank in the way blocks it; an elevated
 *  shooter can clear it. Per-vehicle heights are not decoded — initial guess. 2026-11-05. */
export const TANK_HEIGHT_M = 2.7;

// ---- parsing (strict: the JSON is user-supplied, replay data is untrusted) ----
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const err = (m: string): Error => new Error(`obstacles: ${m}`);
function num(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw err(`${what} must be a finite number`);
  return v;
}
function vec3(v: unknown, what: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) throw err(`${what} must be [x, y, z]`);
  return [num(v[0], `${what}[0]`), num(v[1], `${what}[1]`), num(v[2], `${what}[2]`)];
}
function kind(v: unknown, what: string): ObstacleKind {
  if (typeof v !== "string" || !(KINDS as string[]).includes(v)) throw err(`${what} must be one of ${KINDS.join(", ")}`);
  return v as ObstacleKind;
}

/** Parses + validates an obstacles JSON (the extractor's output). Throws a readable error on
 *  bad input: wrong shape, non-finite numbers, a footprint that is not 4 corners, a matrix
 *  that is not 16 floats, a placement naming an unknown model. */
export function parseObstacles(value: unknown): Obstacles {
  if (!isRec(value)) throw err("top level must be an object");
  const manifest = value["manifest"];
  if (!isRec(manifest) || typeof manifest["map"] !== "string" || manifest["map"] === "") throw err("manifest.map must be a non-empty string");
  const modelsRaw = value["models"], placementsRaw = value["placements"], treesRaw = value["trees"], waterRaw = value["water"];
  if (!Array.isArray(modelsRaw) || !Array.isArray(placementsRaw) || !Array.isArray(treesRaw) || !Array.isArray(waterRaw)) throw err("models, placements, trees and water must be arrays");
  const models: ObstacleModel[] = modelsRaw.map((m, i) => {
    if (!isRec(m)) throw err(`models[${i}] must be an object`);
    if (typeof m["hit_type"] !== "string" || !(HITS as string[]).includes(m["hit_type"])) throw err(`models[${i}].hit_type must be one of ${HITS.join(", ")}`);
    const hullMin = m["hull_min"], hullMax = m["hull_max"];
    if (!((hullMin === null && hullMax === null) || (Array.isArray(hullMin) && Array.isArray(hullMax)))) throw err(`models[${i}] hull_min/hull_max must both be [x, y, z] or both null`);
    const materials = m["materials"];
    if (!Array.isArray(materials) || !materials.every((s) => typeof s === "string")) throw err(`models[${i}].materials must be string[]`);
    const fragile = m["fragile"];
    // destroyed_model_index is null for 8 models in the real file (already-destroyed wrecks
    // with no destroyed state) — a fragile model with nowhere to go when hit.
    if (!(fragile === null || (isRec(fragile) && (fragile["destroyed_model_index"] === null || typeof fragile["destroyed_model_index"] === "number")))) throw err(`models[${i}].fragile must be null or {destroyed_model_index: number | null}`);
    return {
      id: num(m["id"], `models[${i}].id`), name: typeof m["name"] === "string" ? m["name"] : (() => { throw err(`models[${i}].name must be a string`); })(),
      hitType: m["hit_type"] as HitType,
      hullMin: hullMin === null ? null : vec3(hullMin, `models[${i}].hull_min`),
      hullMax: hullMax === null ? null : vec3(hullMax, `models[${i}].hull_max`),
      hullH: num(m["hull_h"], `models[${i}].hull_h`), kind: kind(m["kind"], `models[${i}].kind`),
      // a model is destructible when it has a destroyed state (fragile !== null); the JSON
      // carries no separate destructible flag on models (only on placements).
      destructible: fragile !== null,
      destroyedModelIndex: fragile === null ? null : (fragile as Record<string, unknown>)["destroyed_model_index"] as number | null,
      materials: materials as string[],
    };
  });
  const byId = new Map(models.map((m) => [m.id, m]));
  const placements: ObstaclePlacement[] = placementsRaw.map((p, i) => {
    if (!isRec(p)) throw err(`placements[${i}] must be an object`);
    const modelId = num(p["model_id"], `placements[${i}].model_id`);
    if (!byId.has(modelId)) throw err(`placements[${i}].model_id ${modelId} names no model`);
    const matrix = p["matrix"];
    if (!Array.isArray(matrix) || matrix.length !== 16 || !matrix.every((v) => typeof v === "number" && Number.isFinite(v))) throw err(`placements[${i}].matrix must be 16 finite numbers`);
    const fp = p["footprint"];
    let footprint: Quad | null = null, baseY: number | null = null;
    if (fp !== null) {
      if (!Array.isArray(fp) || fp.length !== 4 || !fp.every((c) => Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === "number" && Number.isFinite(v)))) throw err(`placements[${i}].footprint must be 4 [x, y, z] corners or null`);
      footprint = (fp as number[][]).map((c) => [c[0]!, c[2]!] as [number, number]) as Quad;
      // the footprint corners are the AABB's LOWER corners: their y is the model's base height,
      // the bottom of the extruded box (height_m is the top). pos.y is the model origin, which
      // can sit above or below the base when the model is tilted or scaled.
      baseY = Math.min(...(fp as number[][]).map((c) => c[1]!));
    }
    const heightM = p["height_m"];
    if (!(heightM === null || (typeof heightM === "number" && Number.isFinite(heightM)))) throw err(`placements[${i}].height_m must be a finite number or null`);
    return {
      modelId, matrix: matrix as number[], pos: vec3(p["pos"], `placements[${i}].pos`),
      yaw: num(p["yaw"], `placements[${i}].yaw`), footprint, heightM: heightM as number | null, baseY,
      kind: kind(p["kind"], `placements[${i}].kind`),
      destructible: typeof p["destructible"] === "boolean" ? p["destructible"] : (() => { throw err(`placements[${i}].destructible must be a boolean`); })(),
      extras: num(p["extras"], `placements[${i}].extras`),
      visibilityMask: num(p["visibility_mask"], `placements[${i}].visibility_mask`),
    };
  });
  const trees: ObstacleTree[] = treesRaw.map((tr, i) => {
    if (!isRec(tr)) throw err(`trees[${i}] must be an object`);
    return { pos: vec3(tr["pos"], `trees[${i}].pos`), srt: typeof tr["srt"] === "string" ? tr["srt"] : "", seed: num(tr["seed"], `trees[${i}].seed`), scale: num(tr["scale"], `trees[${i}].scale`) };
  });
  const water: WaterBody[] = waterRaw.map((w, i) => {
    if (!isRec(w)) throw err(`water[${i}] must be an object`);
    const rect = w["rect"];
    if (!Array.isArray(rect) || rect.length !== 2 || !rect.every((c) => Array.isArray(c) && c.length === 2 && c.every((v) => typeof v === "number" && Number.isFinite(v)))) throw err(`water[${i}].rect must be [[x, z], [x, z]]`);
    return { rect: [[(rect[0] as number[])[0]!, (rect[0] as number[])[1]!], [(rect[1] as number[])[0]!, (rect[1] as number[])[1]!]] as [[number, number], [number, number]], surfaceY: num(w["surface_y"], `water[${i}].surface_y`) };
  });
  return { map: manifest["map"] as string, models, placements, trees, water };
}

// ---- filtering ----
/** Drops placements whose footprint centroid (or position when the footprint is null) lies
 *  outside the arena box + margin, and trees outside the same box. Water is untouched (the
 *  sea rectangle legitimately extends past the arena). Models are kept whole — placements
 *  reference them by id. Returns a new object; the input is not mutated. */
export function filterOutland(obs: Obstacles, bounds: { x0: number; x1: number; z0: number; z1: number }, marginM = OUTLAND_MARGIN_M): Obstacles {
  const x0 = bounds.x0 - marginM, x1 = bounds.x1 + marginM, z0 = bounds.z0 - marginM, z1 = bounds.z1 + marginM;
  const inBox = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  const placements = obs.placements.filter((p) => {
    if (p.footprint) {
      const cx = (p.footprint[0][0] + p.footprint[1][0] + p.footprint[2][0] + p.footprint[3][0]) / 4;
      const cz = (p.footprint[0][1] + p.footprint[1][1] + p.footprint[2][1] + p.footprint[3][1]) / 4;
      return inBox(cx, cz);
    }
    return inBox(p.pos[0], p.pos[2]);
  });
  return { ...obs, placements, trees: obs.trees.filter((t) => inBox(t.pos[0], t.pos[2])) };
}

// ---- blocker sets ----
/** Drive-blocking footprints in the nuTerra sense: static models too tall to drive over
 *  (hull_h > 1 m; DRIVE_OVER_MAX_H). Fragile models are not here — a shell can destroy them,
 *  but that is not the same as driving through them; see blockingStructures. */
export function solidFootprints(obs: Obstacles): ObstaclePlacement[] {
  const byId = new Map(obs.models.map((m) => [m.id, m]));
  return obs.placements.filter((p) => {
    const m = byId.get(p.modelId);
    return !!m && m.hitType === "static" && m.hullH > 1 && p.footprint !== null;
  });
}

/** Structures that block sight and (until destroyed) movement: the solid footprints plus
 *  fragile models tall enough not to be crushable (hull_h >= 3.5 m; CRUSH_MAX_H). A 30 m
 *  fragile basilica still blocks — fragile means a shell can destroy it, not that a tank
 *  drives through it. This is the set the 3D view extrudes. */
export function blockingStructures(obs: Obstacles): ObstaclePlacement[] {
  const byId = new Map(obs.models.map((m) => [m.id, m]));
  return obs.placements.filter((p) => {
    const m = byId.get(p.modelId);
    if (!m || p.footprint === null) return false;
    return (m.hitType === "static" && m.hullH > 1) || (m.hitType === "fragile" && m.hullH >= 3.5);
  });
}

/** One sight blocker: a footprint quad with the height of its top. */
export interface SightBlocker { quad: Quad; top: number; kind: ObstacleKind }
/** Everything a sight line can hit: blocking structures plus trees as small canopy quads.
 *  Trees block sight only — a tank drives through (crushes) them. Bushes and shrubs are
 *  included at bush height: they are concealment, not hard cover, and an eye-level line
 *  passes over them. The tree tops are documented approximations (TREE_HEIGHT_M /
 *  BUSH_HEIGHT_M): SpTr gives position + scale, not a height. */
export function sightBlockers(obs: Obstacles): SightBlocker[] {
  const out: SightBlocker[] = blockingStructures(obs).map((p) => ({ quad: p.footprint!, top: p.heightM ?? p.pos[1] + 5, kind: p.kind }));
  for (const t of obs.trees) {
    const r = TREE_CANOPY_R_M * Math.max(0.2, t.scale);
    const bush = /bush|shrub/i.test(t.srt);
    const top = t.pos[1] + (bush ? BUSH_HEIGHT_M : TREE_HEIGHT_M) * Math.max(0.2, t.scale);
    const [x, z] = [t.pos[0], t.pos[2]];
    out.push({ quad: [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]], top, kind: "tree" });
  }
  return out;
}

// ---- geometry ----
/** True when (x, z) lies inside the convex quad (same sign of the cross product on all four
 *  edges; a point on an edge counts as inside). */
export function pointInQuad(x: number, z: number, quad: Quad): boolean {
  let s: boolean | null = null;
  for (let i = 0; i < 4; i++) {
    const [x1, z1] = quad[i]!, [x2, z2] = quad[(i + 1) % 4]!;
    const c = (x2 - x1) * (z - z1) - (z2 - z1) * (x - x1);
    if (c === 0) continue;
    if (s === null) s = c > 0;
    else if ((c > 0) !== s) return false;
  }
  return true;
}

/** Uniform-grid index over blocker quads, so a sight line only tests the footprints near it. */
export interface BlockerIndex { cell: number; x0: number; z0: number; cols: number; rows: number; cells: number[][] }
export function buildBlockerIndex(blockers: SightBlocker[], cellM = BLOCKER_CELL_M): BlockerIndex {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of blockers) for (const [x, z] of b.quad) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  if (!Number.isFinite(x0)) return { cell: cellM, x0: 0, z0: 0, cols: 0, rows: 0, cells: [] };
  const cols = Math.max(1, Math.ceil((x1 - x0) / cellM) + 1), rows = Math.max(1, Math.ceil((z1 - z0) / cellM) + 1);
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  blockers.forEach((b, i) => {
    const xs = b.quad.map((q) => q[0]), zs = b.quad.map((q) => q[1]);
    const c0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / cellM)), c1 = Math.min(cols - 1, Math.floor((Math.max(...xs) - x0) / cellM));
    const r0 = Math.max(0, Math.floor((Math.min(...zs) - z0) / cellM)), r1 = Math.min(rows - 1, Math.floor((Math.max(...zs) - z0) / cellM));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * cols + c]!.push(i);
  });
  return { cell: cellM, x0, z0, cols, rows, cells };
}

export interface BlockerHit { kind: ObstacleKind | "terrain"; at: Vec3; t: number }
/** First thing the straight line from `from` to `to` hits, or null when the line is clear.
 *  Terrain blocks when the HeightField rises above the line; a footprint blocks when the
 *  2D segment crosses its quad and the line is below the obstacle's top there. `from`/`to`
 *  are eye positions (ground + EYE_HEIGHT_M). The earliest hit along the segment wins. */
export function segmentBlocked(from: Vec3, to: Vec3, field: HeightField, blockers: SightBlocker[], index?: BlockerIndex): BlockerHit | null {
  const dx = to[0] - from[0], dz = to[2] - from[2], dy = to[1] - from[1];
  const len2d = Math.hypot(dx, dz);
  if (len2d < 1e-9) return null;
  // terrain: the first sample where the field rises above the line. The field is the same one
  // the heights overlay draws (estimated where no real heights are loaded), so a "blocked"
  // here is only as good as the field. The terrain hit is an upper bound: a footprint
  // crossing earlier than it still wins.
  let terrainT: number | null = null;
  const steps = Math.max(1, Math.ceil(len2d / LOS_STEP_M));
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = from[0] + dx * t, z = from[2] + dz * t;
    if (heightAt(field, x, z) > from[1] + dy * t) { terrainT = t; break; }
  }
  const limit = terrainT ?? 1;
  // footprints: candidates from the index (or all blockers without one); a crossing counts
  // only when the line is below the top at the crossing, and only before the terrain hit.
  let candidates: number[];
  if (index && index.cols > 0) {
    const set = new Set<number>();
    const minX = Math.min(from[0], to[0]), maxX = Math.max(from[0], to[0]), minZ = Math.min(from[2], to[2]), maxZ = Math.max(from[2], to[2]);
    const c0 = Math.max(0, Math.floor((minX - index.x0) / index.cell)), c1 = Math.min(index.cols - 1, Math.floor((maxX - index.x0) / index.cell));
    const r0 = Math.max(0, Math.floor((minZ - index.z0) / index.cell)), r1 = Math.min(index.rows - 1, Math.floor((maxZ - index.z0) / index.cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) for (const i of index.cells[r * index.cols + c]!) set.add(i);
    candidates = [...set];
  } else candidates = blockers.map((_, i) => i);
  let best: BlockerHit | null = null;
  for (const i of candidates) {
    const b = blockers[i]!;
    const t = segmentQuadCross(from[0], from[2], to[0], to[2], b.quad);
    if (t === null || t >= limit) continue;
    if (from[1] + dy * t < b.top && (!best || t < best.t)) best = { kind: b.kind, at: [from[0] + dx * t, from[1] + dy * t, from[2] + dz * t], t };
  }
  if (best) return best;
  if (terrainT !== null) return { kind: "terrain", at: [from[0] + dx * terrainT, from[1] + dy * terrainT, from[2] + dz * terrainT], t: terrainT };
  return null;
}

/** One tank as a sight blocker: position, top height, and id (so the shooter and the
 *  target can be excluded — a tank never blocks its own shot or a shot aimed at itself). */
export interface TankBlocker { x: number; z: number; top: number; vid: number }

/** Alive, live-known tanks as sight blockers. Dead tanks are wrecks and do not block
 *  (a wreck's turret is gone and the hull sits low); ghosts are not here at all — their
 *  position is unknown, so the last-known spot is not a blocker, the tank may have moved. */
export function tankBlockers(units: Unit[], field: HeightField): TankBlocker[] {
  return units.filter((u) => u.alive && u.known === "live").map((u) => ({ x: u.x, z: u.z, top: heightAt(field, u.x, u.z) + TANK_HEIGHT_M, vid: u.vid }));
}

/** First parameter t in [0, 1] where the sight line from `from` to `to` enters a tank's
 *  cylinder, or null. The same shape as segmentBlocked's footprint test but for a circle:
 *  the line is blocked only when it is below the tank's top at the crossing. `exclude`
 *  holds the vids that never block (the shooter and the target). `from`/`to` are eye
 *  positions (ground + EYE_HEIGHT_M), as in segmentBlocked. */
export function segmentTankBlocked(from: Vec3, to: Vec3, tanks: TankBlocker[], exclude: ReadonlySet<number>): number | null {
  const dx = to[0] - from[0], dz = to[2] - from[2], dy = to[1] - from[1];
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-12) return null;
  const r = TANK_BLOCK_R_M;
  let best: number | null = null;
  for (const t of tanks) {
    if (exclude.has(t.vid)) continue;
    const fx = from[0] - t.x, fz = from[2] - t.z;
    const c = fx * fx + fz * fz - r * r;
    if (c <= 0) { // starts inside the tank's circle: blocked at t = 0 unless the line is above it
      if (from[1] < t.top) return 0;
      continue;
    }
    const b = 2 * (fx * dx + fz * dz), disc = b * b - 4 * len2 * c;
    if (disc < 0) continue;
    const tt = (-b - Math.sqrt(disc)) / (2 * len2);
    if (tt < 0 || tt > 1) continue;
    if (from[1] + dy * tt < t.top && (best === null || tt < best)) best = tt;
  }
  return best;
}

/** First parameter t in [0, 1] where the 2D segment crosses the quad, or null. An endpoint
 *  inside the quad crosses at t = 0 (from) or t = 1 (to). */
function segmentQuadCross(x0: number, z0: number, x1: number, z1: number, quad: Quad): number | null {
  if (pointInQuad(x0, z0, quad)) return 0;
  if (pointInQuad(x1, z1, quad)) return 1;
  let best: number | null = null;
  const dx = x1 - x0, dz = z1 - z0;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = quad[i]!, [bx, bz] = quad[(i + 1) % 4]!;
    const ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue; // parallel
    const t = ((ax - x0) * ez - (az - z0) * ex) / den, u = ((ax - x0) * dz - (az - z0) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}
