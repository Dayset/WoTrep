/** Draw a ghost reach disc with its impossible parts cut out: 50 m holes around living friendlies
 *  and the path shadow behind each of them. The cutouts are punched on a shared offscreen canvas
 *  (destination-out), so overlapping holes/shadows subtract correctly — unlike an evenodd fill,
 *  where two overlapping cutouts would cancel each other out. The caller draws in CSS pixels
 *  (the main contexts carry a dpr transform); the offscreen matches the backing store. */

const offscreens = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

export interface ReachHole { x: number; y: number; r: number }
export type ReachShadow = { x: number; y: number }[]; // polyline points, closed by closePath

export function drawReachDisc(
  g: CanvasRenderingContext2D, canvas: HTMLCanvasElement,
  o: { cx: number; cy: number; r: number; color: string; alpha: number; holes: ReachHole[]; shadows: ReachShadow[] },
): void {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (o.r < 3 || W <= 0 || H <= 0) return;
  let off = offscreens.get(canvas);
  if (!off || off.width !== canvas.width || off.height !== canvas.height) {
    off = document.createElement("canvas"); off.width = canvas.width; off.height = canvas.height;
    offscreens.set(canvas, off);
  }
  const dpr = canvas.width / W, c = off.getContext("2d")!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  c.fillStyle = o.color; c.globalAlpha = 0.08 * o.alpha;
  c.beginPath(); c.arc(o.cx, o.cy, o.r, 0, 7); c.fill();
  c.globalCompositeOperation = "destination-out"; c.globalAlpha = 1;
  for (const h of o.holes) { c.beginPath(); c.arc(h.x, h.y, h.r, 0, 7); c.fill(); }
  for (const s of o.shadows) {
    if (s.length < 3) continue;
    c.beginPath(); c.moveTo(s[0]!.x, s[0]!.y);
    for (let i = 1; i < s.length; i++) c.lineTo(s[i]!.x, s[i]!.y);
    c.closePath(); c.fill();
  }
  c.globalCompositeOperation = "source-over";
  g.drawImage(off, 0, 0, W, H);
  // Dotted outlines: outer circle, holes, shadow edges. The shadow's closing chord is not drawn —
  // it lies inside the bubble, already cut, so it would be a stray line across the hole.
  g.save();
  g.setLineDash([3, 4]); g.strokeStyle = o.color; g.globalAlpha = 0.55 * o.alpha; g.lineWidth = 1.5;
  g.beginPath(); g.arc(o.cx, o.cy, o.r, 0, 7); g.stroke();
  for (const h of o.holes) { g.beginPath(); g.arc(h.x, h.y, h.r, 0, 7); g.stroke(); }
  for (const s of o.shadows) {
    if (s.length < 3) continue;
    g.beginPath(); g.moveTo(s[0]!.x, s[0]!.y);
    for (let i = 1; i < s.length; i++) g.lineTo(s[i]!.x, s[i]!.y);
    g.stroke();
  }
  g.restore();
}
