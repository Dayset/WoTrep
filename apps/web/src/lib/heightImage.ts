import { heightAt, type HeightField } from "@wotrep/analysis";

/** Colour-and-hillshade picture of an estimated height field (docs/METRICS.md §3.19). North is up (higher z = higher on the picture).
 *  Cells that tanks actually drove through are solid; filled-in guesses are faded and crossed by thin diagonal lines. */
export function heightImage(f: HeightField, scale = 4): { canvas: HTMLCanvasElement; min: number; max: number; x0: number; z0: number; w: number; h: number } {
  const w = f.cols * scale, h = f.rows * scale, cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d")!, img = g.createImageData(w, h);
  let min = Infinity, max = -Infinity; for (const v of f.h) { if (v < min) min = v; if (v > max) max = v; } if (!Number.isFinite(min)) { min = 0; max = 1; }
  const ramp = (k: number): [number, number, number] => { const a: [number, number, number][] = [[58, 110, 120], [96, 150, 100], [190, 190, 110], [170, 120, 80], [235, 235, 235]], p = Math.min(0.999, Math.max(0, k)) * (a.length - 1), i = Math.floor(p), t = p - i; return [0, 1, 2].map((c) => a[i]![c]! * (1 - t) + a[i + 1]![c]! * t) as [number, number, number]; };
  const cm = f.cell / scale, wx = (px: number) => f.x0 - f.cell / 2 + (px + 0.5) * cm, wz = (py: number) => f.z0 - f.cell / 2 + (f.rows * scale - py - 0.5) * cm;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = wx(px), z = wz(py), y = heightAt(f, x, z), dx = heightAt(f, x + f.cell * 0.5, z) - heightAt(f, x - f.cell * 0.5, z), dz = heightAt(f, x, z + f.cell * 0.5) - heightAt(f, x, z - f.cell * 0.5);
    const shade = Math.max(0.55, Math.min(1.35, 1 + (-dx * 0.7 + dz * 0.7) / f.cell * 1.2)), [r, gg, b] = ramp((y - min) / Math.max(1, max - min));
    const c = Math.min(f.cols - 1, Math.max(0, Math.round((x - f.x0) / f.cell))), rr = Math.min(f.rows - 1, Math.max(0, Math.round((z - f.z0) / f.cell))), seen = f.seen[rr * f.cols + c] === 1, hatch = !seen && (px + py) % 6 < 1;
    const o = (py * w + px) * 4; img.data[o] = Math.min(255, r * shade); img.data[o + 1] = Math.min(255, gg * shade); img.data[o + 2] = Math.min(255, b * shade); img.data[o + 3] = seen ? 235 : hatch ? 150 : 95;
  }
  g.putImageData(img, 0, 0); return { canvas: cv, min, max, x0: f.x0 - f.cell / 2, z0: f.z0 - f.cell / 2, w: f.cols * f.cell, h: f.rows * f.cell };
}
