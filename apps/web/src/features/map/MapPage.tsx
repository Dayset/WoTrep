import { useEffect, useMemo, useRef, useState } from "react";
import { heatGrid, tracerLines, vanishEvents, type HeatLayer, type HeatGrid } from "@wotrep/analysis";
import { dangerSpots } from "@wotrep/coach";
import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";
import { loadMap, type MapBounds } from "../../lib/mapStore";
import { MapLoader } from "../player/MapLoader";

type Layer = HeatLayer | "tracers" | "danger" | "vanish";
const LAYERS: Layer[] = ["presence", "dmgdealt", "dmgrecv", "deaths", "routes", "spots", "danger", "vanish", "tracers"];
const TEAMS = ["both", "own", "enemy"] as const, WINDOWS = ["all", "open", "mid", "end"] as const;
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Heatmaps for the loaded battle on the owner's local map image (docs/MAPPAGE.md). */
export function MapPage({ tl, onClose }: { tl: BattleTimeline; onClose: () => void }) {
  const [layer, setLayer] = useState<Layer>("presence"), [team, setTeam] = useState<(typeof TEAMS)[number]>("both"), [win, setWin] = useState<(typeof WINDOWS)[number]>("all"), [onlyMe, setOnlyMe] = useState(false);
  const [img, setImg] = useState<{ el: HTMLImageElement; b: MapBounds } | null>(null), [panel, setPanel] = useState(false), [tick, setTick] = useState(0), [pick, setPick] = useState<{ c: number; r: number } | null>(null);
  const cv = useRef<HTMLCanvasElement>(null), end = Math.floor(tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0);

  useEffect(() => {
    let on = true, url = "";
    void loadMap(tl.arena.map).then((m) => { if (!m || !on) return; url = URL.createObjectURL(m.image); const el = new Image(); el.onload = () => on && setImg({ el, b: m.bounds }); el.src = url; });
    return () => { on = false; if (url) URL.revokeObjectURL(url); };
  }, [tl.arena.map, tick]);

  const bounds = useMemo<MapBounds>(() => {
    if (img) return img.b;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const tr of Object.values(tl.tracks)) for (let i = 0; i < tr.x.length; i++) { x0 = Math.min(x0, tr.x[i]!); x1 = Math.max(x1, tr.x[i]!); z0 = Math.min(z0, tr.z[i]!); z1 = Math.max(z1, tr.z[i]!); }
    return { x0: x0 - 40, x1: x1 + 40, z0: z0 - 40, z1: z1 + 40 };
  }, [tl, img]);
  const cell = Math.max(10, Math.round((bounds.x1 - bounds.x0) / 56 / 5) * 5);
  const span = useMemo(() => (win === "open" ? { t0: 0, t1: 60 } : win === "mid" ? { t0: 60, t1: Math.max(60, end - 60) } : win === "end" ? { t0: Math.max(0, end - 60), t1: end } : layer === "routes" ? { t0: 0, t1: 60 } : {}), [win, layer, end]);
  const hl: HeatLayer = layer === "tracers" || layer === "danger" || layer === "vanish" ? "presence" : layer;
  const grid = useMemo((): HeatGrid => {
    const base = { bounds, cellM: cell, team: layer === "spots" ? "enemy" as const : team, vid: onlyMe ? tl.recorder.vid : undefined, ...span };
    if (layer !== "danger" && layer !== "vanish") return heatGrid(tl, hl, base);
    const cols = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / cell)), rows = Math.max(1, Math.ceil((bounds.z1 - bounds.z0) / cell)), values = new Float32Array(cols * rows); let total = 0, max = 0;
    if (layer === "vanish") {
      for (const d of vanishEvents(tl)) {
        if (d.t < (span.t0 ?? 0) || d.t > (span.t1 ?? Infinity) || (onlyMe && d.spotter !== tl.recorder.vid)) continue;
        const c = Math.floor((d.x - bounds.x0) / cell), r = Math.floor((d.z - bounds.z0) / cell); if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const k = r * cols + c; values[k] = values[k]! + 1; total++; max = Math.max(max, values[k]!);
      }
      return { cols, rows, cellM: cell, values, total, max, unit: "count" };
    }
    for (const d of dangerSpots(tl)) {
      if (d.x == null || d.z == null || d.tStart < (span.t0 ?? 0) || d.tStart > (span.t1 ?? Infinity)) continue;
      if (onlyMe && d.vid !== tl.recorder.vid) continue;
      if (team !== "both" && (team === "own") !== (d.team === tl.recorder.team)) continue;
      const c = Math.floor((d.x - bounds.x0) / cell), r = Math.floor((d.z - bounds.z0) / cell); if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const k = r * cols + c; values[k] = values[k]! + 1; total++; max = Math.max(max, values[k]!);
    }
    return { cols, rows, cellM: cell, values, total, max, unit: "count" };
  }, [tl, hl, layer, team, span, onlyMe, bounds, cell]);
  const shots = useMemo(() => (layer === "tracers" ? tracerLines(tl, { team, vid: onlyMe ? tl.recorder.vid : undefined, ...span }) : []), [tl, layer, team, onlyMe, span]);

  const aspect = (bounds.z1 - bounds.z0) / (bounds.x1 - bounds.x0);
  const [view, setView] = useState({ zoom: 1, cx: (bounds.x0 + bounds.x1) / 2, cz: (bounds.z0 + bounds.z1) / 2 }), viewRef = useRef(view); viewRef.current = view;
  useEffect(() => { setView({ zoom: 1, cx: (bounds.x0 + bounds.x1) / 2, cz: (bounds.z0 + bounds.z1) / 2 }); }, [bounds]);
  const vw = (v: { zoom: number; cx: number; cz: number }) => { const wx = (bounds.x1 - bounds.x0) / v.zoom, wz = (bounds.z1 - bounds.z0) / v.zoom; return { wx, wz, x0: v.cx - wx / 2, z0: v.cz - wz / 2 }; };
  const clampView = (v: { zoom: number; cx: number; cz: number }) => { const zoom = Math.min(8, Math.max(1, v.zoom)), w = vw({ ...v, zoom }); return { zoom, cx: Math.min(bounds.x1 - w.wx / 2, Math.max(bounds.x0 + w.wx / 2, v.cx)), cz: Math.min(bounds.z1 - w.wz / 2, Math.max(bounds.z0 + w.wz / 2, v.cz)) }; };
  useEffect(() => {
    const c = cv.current; if (!c) return; const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = Math.round(W * aspect), w = vw(view);
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.height = `${H}px`;
    const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = css("--panel"); g.fillRect(0, 0, W, H);
    const sx = (x: number) => ((x - w.x0) / w.wx) * W, sy = (z: number) => (1 - (z - w.z0) / w.wz) * H;
    if (img) g.drawImage(img.el, sx(img.b.x0), sy(img.b.z1), sx(img.b.x1) - sx(img.b.x0), sy(img.b.z0) - sy(img.b.z1));
    else { g.strokeStyle = css("--line"); g.lineWidth = 1; for (let x = Math.ceil(bounds.x0 / 100) * 100; x < bounds.x1; x += 100) { g.beginPath(); g.moveTo(sx(x), 0); g.lineTo(sx(x), H); g.stroke(); } for (let z = Math.ceil(bounds.z0 / 100) * 100; z < bounds.z1; z += 100) { g.beginPath(); g.moveTo(0, sy(z)); g.lineTo(W, sy(z)); g.stroke(); } }
    const col = layer === "dmgrecv" || layer === "deaths" || layer === "spots" ? css("--enemy") : css("--accent");
    g.fillStyle = col; const cwp = (grid.cellM / w.wx) * W, chp = (grid.cellM / w.wz) * H;
    if (layer === "tracers") { g.lineWidth = 1.2; g.globalAlpha = 0.45; for (const l of shots) { g.strokeStyle = l.team === tl.recorder.team ? css("--accent") : css("--enemy"); g.beginPath(); g.moveTo(sx(l.x0), sy(l.z0)); g.lineTo(sx(l.x1), sy(l.z1)); g.stroke(); } g.globalAlpha = 1; }
    else for (let r = 0; r < grid.rows; r++) for (let q = 0; q < grid.cols; q++) { const v = grid.values[r * grid.cols + q]!; if (v <= 0) continue; g.globalAlpha = 0.12 + 0.78 * Math.sqrt(v / grid.max); g.fillRect(sx(bounds.x0 + q * grid.cellM), sy(bounds.z0 + (r + 1) * grid.cellM), cwp + 0.5, chp + 0.5); }
    g.globalAlpha = 1;
    if (pick) { g.strokeStyle = css("--text"); g.lineWidth = 2; g.strokeRect(sx(bounds.x0 + pick.c * grid.cellM), sy(bounds.z0 + (pick.r + 1) * grid.cellM), cwp, chp); }
  }, [grid, img, bounds, aspect, layer, pick, shots, tl, view]);

  // pan (drag), pinch and wheel zoom; a press that barely moves is a tap that reads a cell
  const ptrs = useRef(new Map<number, { x: number; y: number }>()), moved = useRef(0), pinch0 = useRef<{ d: number; zoom: number } | null>(null);
  const zoomAt = (px: number, py: number, factor: number, r: DOMRect) => { const v = viewRef.current, w = vw(v), wx = w.x0 + (px / r.width) * w.wx, wz = w.z0 + (1 - py / r.height) * w.wz, zoom = Math.min(8, Math.max(1, v.zoom * factor)), nw = vw({ ...v, zoom }); setView(clampView({ zoom, cx: wx - (px / r.width - 0.5) * nw.wx, cz: wz - (0.5 - py / r.height) * nw.wz })); };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => { e.currentTarget.setPointerCapture(e.pointerId); ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved.current = 0; if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()]; pinch0.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: viewRef.current.zoom }; } };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = ptrs.current.get(e.pointerId); if (!p) return; const r = e.currentTarget.getBoundingClientRect(), dx = e.clientX - p.x, dy = e.clientY - p.y; moved.current += Math.abs(dx) + Math.abs(dy);
    if (ptrs.current.size === 2 && pinch0.current) { ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); const [a, b] = [...ptrs.current.values()]; const d = Math.hypot(a!.x - b!.x, a!.y - b!.y); zoomAt(((a!.x + b!.x) / 2) - r.left, ((a!.y + b!.y) / 2) - r.top, (pinch0.current.zoom * d) / pinch0.current.d / viewRef.current.zoom, r); return; }
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); const v = viewRef.current, w = vw(v); if (v.zoom > 1) setView(clampView({ ...v, cx: v.cx - (dx / r.width) * w.wx, cz: v.cz + (dy / r.height) * w.wz }));
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasTap = ptrs.current.size === 1 && moved.current < 8; ptrs.current.delete(e.pointerId); if (ptrs.current.size < 2) pinch0.current = null;
    if (wasTap) { const r = e.currentTarget.getBoundingClientRect(), w = vw(viewRef.current), x = w.x0 + ((e.clientX - r.left) / r.width) * w.wx, z = w.z0 + (1 - (e.clientY - r.top) / r.height) * w.wz; setPick({ c: Math.min(grid.cols - 1, Math.max(0, Math.floor((x - bounds.x0) / grid.cellM))), r: Math.min(grid.rows - 1, Math.max(0, Math.floor((z - bounds.z0) / grid.cellM))) }); }
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.25 : 0.8, r); };

  const val = pick ? grid.values[pick.r * grid.cols + pick.c]! : null;
  const fmt = (v: number) => grid.unit === "s" ? `${Math.round(v)} s` : grid.unit === "hp" ? `${Math.round(v).toLocaleString()} HP` : String(Math.round(v));
  const chip = <T extends string>(cur: T, set: (v: T) => void, items: readonly T[], key: string) => items.map((k) => <button type="button" key={k} aria-pressed={cur === k} onClick={() => set(k)}>{t(`${key}.${k}`)}</button>);

  return (
    <div className="mappage" data-testid="mappage">
      <div className="pctl"><button type="button" onClick={onClose}>← {t("player.back")}</button><b>{tl.arena.mapDisplayName}</b><button type="button" onClick={() => setPanel(true)}>🗺 {t("map.open")}</button></div>
      <div className="chips" role="group" aria-label={t("mp.layer")}>{chip(layer, setLayer, LAYERS, "mp.l")}</div>
      <div className="chips">{layer !== "spots" && chip(team, setTeam, TEAMS, "mp.team")}<span className="sep" />{chip(win, setWin, WINDOWS, "mp.win")}<label><input type="checkbox" checked={onlyMe} onChange={(e) => setOnlyMe(e.target.checked)} /> {t("mp.onlyme")}</label></div>
      <div className="mpwrap"><canvas ref={cv} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} aria-label={t("mp.aria")} role="img" data-zoom={view.zoom.toFixed(2)} />
        <div className="mpzoom" onPointerDown={(e) => e.stopPropagation()}><button type="button" aria-label={t("player.zoomin")} onClick={() => { const c = cv.current; if (c) zoomAt(c.clientWidth / 2, c.clientHeight / 2, 1.5, c.getBoundingClientRect()); }}>+</button><button type="button" aria-label={t("player.zoomout")} onClick={() => { const c = cv.current; if (c) zoomAt(c.clientWidth / 2, c.clientHeight / 2, 1 / 1.5, c.getBoundingClientRect()); }}>−</button><button type="button" aria-label={t("mp.reset")} onClick={() => setView({ zoom: 1, cx: (bounds.x0 + bounds.x1) / 2, cz: (bounds.z0 + bounds.z1) / 2 })}>⤢</button></div>
        {panel && <MapLoader mapName={tl.arena.map} onSaved={() => setTick((x) => x + 1)} onClose={() => setPanel(false)} />}
        {!img && <div className="pnote">{t("player.nomap")}</div>}</div>
      <p className="muted mplegend">{layer === "tracers" ? t("mp.tracers.legend", { n: String(shots.length) }) : t("mp.legend", { max: fmt(grid.max), cell: String(grid.cellM), total: fmt(grid.total) })}{layer !== "tracers" && val != null ? ` · ${t("mp.cell", { v: fmt(val) })}` : ""}</p>
      <details className="how" open><summary>{t("mp.how")}</summary><p>{t(`mp.l.${layer}.how`)}</p><p><b>{t("mp.mean")}</b> {t(`mp.l.${layer}.mean`)}</p></details>
      <p className="muted">{t("mp.agg")}</p>
    </div>
  );
}
