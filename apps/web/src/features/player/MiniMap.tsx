import { useEffect, useRef, useState } from "react";
import { stateAt, type BattleTimeline } from "@wotrep/model";
import { aimAt } from "@wotrep/analysis";
import { PROXIMITY_SPOT_M, ghostThreats, reachBlockers, shadowPolygon } from "./viewConfig";
import { drawReachDisc } from "./reachDraw";
import type { MapBounds } from "../../lib/mapStore";
import { t } from "../../i18n";

/** Small top-down map for the 3D views: the followed tank with its view wedge, everyone else as dots. Size S/M/L; "Near" zooms to ~350 m around the tank. */
// Ghosts older than this stop carrying a reach circle, same as the 2D player's ghost fade (GHOST_FADE_S there).
const GHOST_FADE_S = 30;
export function MiniMap({ tl, clock, vid, img, bounds, fp }: { tl: BattleTimeline; clock: { current: { t: number } }; vid: number; img: HTMLImageElement | null; bounds: MapBounds; fp: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null), [size, setSize] = useState<"s" | "m" | "l" | "x">(() => (window.matchMedia?.("(max-width: 600px)").matches ? "s" : "m")), [near, setNear] = useState(false), live = useRef({ vid, near, fp }); live.current = { vid, near, fp };
  useEffect(() => {
    const c = cv.current; if (!c) return; let raf = 0;
    const css = (n: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d, ally = css("--accent", "#4aa3ff"), foe = css("--enemy", "#ff5a5a");
    const draw = () => {
      raf = requestAnimationFrame(draw); const L = live.current, W = c.clientWidth, H = c.clientHeight, dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); const T = clock.current.t, s = stateAt(tl, T), me = s.units.find((u) => u.vid === L.vid);
      const bw = bounds.x1 - bounds.x0, bh = bounds.z1 - bounds.z0;
      let x0 = bounds.x0, z0 = bounds.z0, w = bw, h = bh;
      if (L.near && me && me.known !== "never") { const half = 175; w = h = half * 2; x0 = me.x - half; z0 = me.z - half; }
      const sx = (x: number) => ((x - x0) / w) * W, sy = (z: number) => (1 - (z - z0) / h) * H;
      g.fillStyle = "rgba(20,24,30,0.85)"; g.fillRect(0, 0, W, H);
      if (img) { g.save(); g.beginPath(); g.rect(0, 0, W, H); g.clip(); g.globalAlpha = 0.9; g.drawImage(img, sx(bounds.x0), sy(bounds.z1), sx(bounds.x1) - sx(bounds.x0), sy(bounds.z0) - sy(bounds.z1)); g.restore(); }
      else { g.strokeStyle = "rgba(255,255,255,0.12)"; for (let x = Math.ceil(x0 / 100) * 100; x < x0 + w; x += 100) { g.beginPath(); g.moveTo(sx(x), 0); g.lineTo(sx(x), H); g.stroke(); } for (let z = Math.ceil(z0 / 100) * 100; z < z0 + h; z += 100) { g.beginPath(); g.moveTo(0, sy(z)); g.lineTo(W, sy(z)); g.stroke(); } }
      for (const u of s.units) {
        if (u.known === "never") continue; const X = sx(u.x), Y = sy(u.z); if (X < -5 || Y < -5 || X > W + 5 || Y > H + 5) continue;
        // reach circle, same rule as the 2D player: dotted, radius = Unit.reachM, fades with the ghost,
        // faint fill with 50 m holes around living friendlies plus the shadow behind each bubble.
        if (u.known === "ghost" && u.alive && u.reachM && (u.ageS ?? 0) < GHOST_FADE_S) { const k = W / w, R = u.reachM * k, fade = 1 - (u.ageS ?? 0) / GHOST_FADE_S; if (R >= 3) {
          const blockers = reachBlockers(s.units, u, tl.recorder.team);
          drawReachDisc(g, c, { cx: X, cy: Y, r: R, color: u.team === tl.recorder.team ? ally : foe, alpha: fade,
            holes: blockers.map((b) => ({ x: sx(b.x), y: sy(b.z), r: PROXIMITY_SPOT_M.value * k })),
            shadows: blockers.map((b) => shadowPolygon(u.x, u.z, u.reachM!, b.x, b.z)).filter((p): p is { x: number; z: number }[] => p !== null).map((p) => p.map((q) => ({ x: sx(q.x), y: sy(q.z) }))),
          }); } }
        g.globalAlpha = u.known === "ghost" ? 0.4 : 1; g.fillStyle = u.team === tl.recorder.team ? ally : foe;
        if (!u.alive) { g.strokeStyle = "#999"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X - 3, Y - 3); g.lineTo(X + 3, Y + 3); g.moveTo(X + 3, Y - 3); g.lineTo(X - 3, Y + 3); g.stroke(); }
        else { g.beginPath(); g.arc(X, Y, u.vid === L.vid ? 5 : 3.2, 0, 7); g.fill(); }
        g.globalAlpha = 1;
      }
      // threat rings: living friendlies an enemy ghost could shoot, now or within its 30 s window.
      // No labels at this size — the ring is the warning; the 2D player carries the seconds.
      const threats = ghostThreats(s.units.filter((u) => u.known === "ghost"), s.units, tl.recorder.team);
      for (const [vid, th] of threats) { const f = s.units.find((u) => u.vid === vid); if (!f || f.known !== "live") continue; const X = sx(f.x), Y = sy(f.z); if (X < -5 || Y < -5 || X > W + 5 || Y > H + 5) continue;
        g.strokeStyle = foe; g.globalAlpha = 0.8 * th.alpha; g.lineWidth = 1.5; g.beginPath(); g.arc(X, Y, 6, 0, 7); g.stroke(); g.globalAlpha = 1; }
      if (me && me.known !== "never" && me.alive) {
        const a = aimAt(tl, L.vid, T), yaw = a ? a.yaw : me.yaw, X = sx(me.x), Y = sy(me.z), R = Math.min(W, H) * 0.45, fov = (L.fp ? (a?.onTarget ? 20 : 65) : 65) * Math.PI / 180;
        g.fillStyle = "rgba(255,255,255,0.18)"; g.strokeStyle = "#fff"; g.lineWidth = 1; g.beginPath(); g.moveTo(X, Y);
        for (let k = -1; k <= 1; k += 0.25) { const ang = yaw + k * fov / 2; g.lineTo(X + Math.sin(ang) * R, Y - Math.cos(ang) * R); } g.closePath(); g.fill(); g.stroke();
        g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(X, Y, 6, 0, 7); g.stroke();
      }
    }; draw(); return () => cancelAnimationFrame(raf);
  }, [tl, clock, img, bounds]);
  const px = { s: 110, m: 190, l: 280, x: 0 }[size];
  return (
    <div className="minimap" onPointerDown={(e) => e.stopPropagation()} data-testid="minimap">
      <canvas ref={cv} hidden={size === "x"} style={{ width: `min(${px}px, 42vw)`, height: `min(${Math.round(px * ((bounds.z1 - bounds.z0) / (bounds.x1 - bounds.x0)))}px, ${Math.round(42 * ((bounds.z1 - bounds.z0) / (bounds.x1 - bounds.x0)))}vw)` }} aria-label={t("mini.aria")} role="img" />
      <div className="minibtns"><button type="button" onClick={() => setSize(size === "s" ? "m" : size === "m" ? "l" : size === "l" ? "x" : "s")} aria-label={t("mini.size")} title={t("mini.size")}>{size === "x" ? "🗺" : size.toUpperCase()}</button>{size !== "x" && <button type="button" aria-pressed={near} onClick={() => setNear(!near)} title={t("mini.near")}>{t("mini.near")}</button>}</div>
    </div>
  );
}
