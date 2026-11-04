import type { BattleTimeline } from "@wotrep/model";

/** Terrain height estimated from where tanks drove (docs/METRICS.md §3.19). Every track sample is a point on the ground (x, z, y); cells with samples
 *  nearby get an inverse-distance average, the rest are filled from the nearest known cells. It is a smooth guess: peaks and valleys the tanks never
 *  visited are missing, and buildings, bridges and ramps are flattened. */
export interface HeightField { x0: number; z0: number; cell: number; cols: number; rows: number; h: Float32Array; seen: Uint8Array }
export function heightField(tl: BattleTimeline, b: { x0: number; x1: number; z0: number; z1: number }, cell = 25): HeightField {
  const cols = Math.max(2, Math.ceil((b.x1 - b.x0) / cell) + 1), rows = Math.max(2, Math.ceil((b.z1 - b.z0) / cell) + 1), sum = new Float64Array(cols * rows), wsum = new Float64Array(cols * rows);
  for (const tr of Object.values(tl.tracks)) for (let i = 0; i < tr.t.length; i += 2) {
    const y = tr.y[i]!; if (!(y > 0)) continue; const fx = (tr.x[i]! - b.x0) / cell, fz = (tr.z[i]! - b.z0) / cell, c0 = Math.floor(fx), r0 = Math.floor(fz);
    for (let r = r0 - 1; r <= r0 + 2; r++) for (let c = c0 - 1; c <= c0 + 2; c++) { if (c < 0 || r < 0 || c >= cols || r >= rows) continue; const d2 = (c - fx) ** 2 + (r - fz) ** 2, w = 1 / (0.15 + d2); sum[r * cols + c]! += w * y; wsum[r * cols + c]! += w; }
  }
  const h = new Float32Array(cols * rows), seen = new Uint8Array(cols * rows);
  for (let i = 0; i < h.length; i++) if (wsum[i]! > 0.3) { h[i] = sum[i]! / wsum[i]!; seen[i] = 1; }
  // fill unknown cells from known ones: repeated neighbour averaging, then a light smoothing pass
  let filled = seen.reduce((a, v) => a + v, 0); if (filled === 0) return { x0: b.x0, z0: b.z0, cell, cols, rows, h, seen };
  const known = Uint8Array.from(seen);
  for (let pass = 0; pass < cols + rows && filled < h.length; pass++) {
    const nk = Uint8Array.from(known), nh = Float32Array.from(h);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const i = r * cols + c; if (known[i]) continue; let s = 0, n = 0; for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue; const j = rr * cols + cc; if (known[j]) { s += h[j]!; n++; } } if (n) { nh[i] = s / n; nk[i] = 1; filled++; } }
    h.set(nh); known.set(nk);
  }
  const sm = Float32Array.from(h); for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) { const i = r * cols + c; sm[i] = seen[i] ? h[i]! : (h[i]! * 4 + h[i - 1]! + h[i + 1]! + h[i - cols]! + h[i + cols]!) / 8; }
  return { x0: b.x0, z0: b.z0, cell, cols, rows, h: sm, seen };
}
export function heightAt(f: HeightField, x: number, z: number): number {
  const fx = Math.min(f.cols - 1.001, Math.max(0, (x - f.x0) / f.cell)), fz = Math.min(f.rows - 1.001, Math.max(0, (z - f.z0) / f.cell)), c = Math.floor(fx), r = Math.floor(fz), tx = fx - c, tz = fz - r, i = r * f.cols + c;
  return f.h[i]! * (1 - tx) * (1 - tz) + f.h[i + 1]! * tx * (1 - tz) + f.h[i + f.cols]! * (1 - tx) * tz + f.h[i + f.cols + 1]! * tx * tz;
}
