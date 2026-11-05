/** Real terrain heights extracted from a map's game files (docs/FINDINGS.md, 2026-11-05).
 *  One grid per 100 m chunk: w x h samples, 0.76 m apart for the 133-sample chunks, row-major
 *  (row = z, column = x), values in metres. Chunk (lx, ly) covers chunk-space x in
 *  [lx*chunkSize, (lx+1)*chunkSize), z likewise. Chunk-space is replay (world) coordinates
 *  plus the map's measured offset (see @wotrep/gamedata terrainPlacement): Overlord's
 *  chunk-space x = world x - 300, z = world z. */

export interface RealHeightsChunk { locX: number; locY: number; w: number; h: number; data: Float32Array }
export interface RealHeights { chunkSize: number; chunks: Map<string, RealHeightsChunk>; minM: number; maxM: number }
/** Metres added to replay x/z to reach chunk space. */
export interface RealOffset { dx: number; dz: number }
export interface RealSource { heights: RealHeights; offset: RealOffset }

/** HeightField cell (m) used when real heights are loaded. Measured 2026-11-05 on the Overlord fixture:
 *  resampling the 0.76 m real grid to 25 m cells leaves 5% of the map >2 m off the measured ground
 *  (up to 14 m on the western cliffs, slope-driven); at 5 m cells the field is the direct sampler
 *  to 0.02 m median on a dense grid. The guessed field stays at 25 m — a finer guess would be
 *  noisier where tracks are sparse, and with real data loaded the guess barely matters. */
export const REAL_HEIGHT_CELL_M = 5;

/** Bilinear sample of the real heights at replay coordinates, or null outside the covered chunks. */
export function realHeightAt(real: RealHeights, offset: RealOffset, x: number, z: number): number | null {
  const cx = x + offset.dx, cz = z + offset.dz;
  const lx = Math.floor(cx / real.chunkSize), ly = Math.floor(cz / real.chunkSize);
  const ch = real.chunks.get(`${lx},${ly}`);
  if (!ch) return null;
  const fx = ((cx - lx * real.chunkSize) / real.chunkSize) * (ch.w - 1), fz = ((cz - ly * real.chunkSize) / real.chunkSize) * (ch.h - 1);
  if (!(fx >= 0 && fz >= 0 && fx <= ch.w - 1 && fz <= ch.h - 1)) return null;
  const x0 = Math.min(ch.w - 2, Math.floor(fx)), z0 = Math.min(ch.h - 2, Math.floor(fz)), tx = fx - x0, tz = fz - z0, i = z0 * ch.w + x0;
  return ch.data[i]! * (1 - tx) * (1 - tz) + ch.data[i + 1]! * tx * (1 - tz) + ch.data[i + ch.w]! * (1 - tx) * tz + ch.data[i + ch.w + 1]! * tx * tz;
}
