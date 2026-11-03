import { useEffect, useMemo, useRef, useState } from "react";
import { heatGrid, tracerLines, type HeatLayer } from "@wotrep/analysis";
import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";
import { loadMap, type MapBounds } from "../../lib/mapStore";
import { MapLoader } from "../player/MapLoader";

type Layer = HeatLayer | "tracers";
const LAYERS: Layer[] = ["presence", "dmgdealt", "dmgrecv", "deaths", "routes", "spots", "tracers"];
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
  const hl: HeatLayer = layer === "tracers" ? "presence" : layer;
  const grid = useMemo(() => heatGrid(tl, hl, { bounds, cellM: cell, team: layer === "spots" ? "enemy" : team, vid: onlyMe ? tl.recorder.vid : undefined, ...span }), [tl, hl, layer, team, span, onlyMe, bounds, cell]);
  const shots = useMemo(() => (layer === "tracers" ? tracerLines(tl, { team, vid: onlyMe ? tl.recorder.vid : undefined, ...span }) : []), [tl, layer, team, onlyMe, span]);

  const aspect = (bounds.z1 - bounds.z0) / (bounds.x1 - bounds.x0);
  useEffect(() => {
    const c = cv.current; if (!c) return; const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = Math.round(W * aspect);
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.height = `${H}px`;
    const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = css("--panel"); g.fillRect(0, 0, W, H);
    const sx = (x: number) => ((x - bounds.x0) / (bounds.x1 - bounds.x0)) * W, sy = (z: number) => (1 - (z - bounds.z0) / (bounds.z1 - bounds.z0)) * H;
    if (img) g.drawImage(img.el, sx(img.b.x0), sy(img.b.z1), sx(img.b.x1) - sx(img.b.x0), sy(img.b.z0) - sy(img.b.z1));
    else { g.strokeStyle = css("--line"); g.lineWidth = 1; for (let x = Math.ceil(bounds.x0 / 100) * 100; x < bounds.x1; x += 100) { g.beginPath(); g.moveTo(sx(x), 0); g.lineTo(sx(x), H); g.stroke(); } for (let z = Math.ceil(bounds.z0 / 100) * 100; z < bounds.z1; z += 100) { g.beginPath(); g.moveTo(0, sy(z)); g.lineTo(W, sy(z)); g.stroke(); } }
    const col = layer === "dmgrecv" || layer === "deaths" || layer === "spots" ? css("--enemy") : css("--accent");
    g.fillStyle = col; const cw = W / grid.cols, ch = H / grid.rows;
    if (layer === "tracers") { g.lineWidth = 1.2; g.globalAlpha = 0.45; for (const l of shots) { g.strokeStyle = l.team === tl.recorder.team ? css("--accent") : css("--enemy"); g.beginPath(); g.moveTo(sx(l.x0), sy(l.z0)); g.lineTo(sx(l.x1), sy(l.z1)); g.stroke(); } g.globalAlpha = 1; }
    else for (let r = 0; r < grid.rows; r++) for (let q = 0; q < grid.cols; q++) { const v = grid.values[r * grid.cols + q]!; if (v <= 0) continue; g.globalAlpha = 0.12 + 0.78 * Math.sqrt(v / grid.max); g.fillRect(q * cw, (grid.rows - 1 - r) * ch, cw + 0.5, ch + 0.5); }
    g.globalAlpha = 1;
    if (pick) { g.strokeStyle = css("--text"); g.lineWidth = 2; g.strokeRect(pick.c * cw, (grid.rows - 1 - pick.r) * ch, cw, ch); }
  }, [grid, img, bounds, aspect, layer, pick, shots, tl]);

  const tap = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); setPick({ c: Math.min(grid.cols - 1, Math.floor(((e.clientX - r.left) / r.width) * grid.cols)), r: Math.min(grid.rows - 1, Math.floor((1 - (e.clientY - r.top) / r.height) * grid.rows)) }); };
  const val = pick ? grid.values[pick.r * grid.cols + pick.c]! : null;
  const fmt = (v: number) => grid.unit === "s" ? `${Math.round(v)} s` : grid.unit === "hp" ? `${Math.round(v).toLocaleString()} HP` : String(Math.round(v));
  const chip = <T extends string>(cur: T, set: (v: T) => void, items: readonly T[], key: string) => items.map((k) => <button type="button" key={k} aria-pressed={cur === k} onClick={() => set(k)}>{t(`${key}.${k}`)}</button>);

  return (
    <div className="mappage" data-testid="mappage">
      <div className="pctl"><button type="button" onClick={onClose}>← {t("player.back")}</button><b>{tl.arena.mapDisplayName}</b><button type="button" onClick={() => setPanel(true)}>🗺 {t("map.open")}</button></div>
      <div className="chips" role="group" aria-label={t("mp.layer")}>{chip(layer, setLayer, LAYERS, "mp.l")}</div>
      <div className="chips">{layer !== "spots" && chip(team, setTeam, TEAMS, "mp.team")}<span className="sep" />{chip(win, setWin, WINDOWS, "mp.win")}<label><input type="checkbox" checked={onlyMe} onChange={(e) => setOnlyMe(e.target.checked)} /> {t("mp.onlyme")}</label></div>
      <div className="mpwrap"><canvas ref={cv} onPointerDown={tap} aria-label={t("mp.aria")} role="img" />
        {panel && <MapLoader mapName={tl.arena.map} onSaved={() => setTick((x) => x + 1)} onClose={() => setPanel(false)} />}
        {!img && <div className="pnote">{t("player.nomap")}</div>}</div>
      <p className="muted mplegend">{layer === "tracers" ? t("mp.tracers.legend", { n: String(shots.length) }) : t("mp.legend", { max: fmt(grid.max), cell: String(grid.cellM), total: fmt(grid.total) })}{layer !== "tracers" && val != null ? ` · ${t("mp.cell", { v: fmt(val) })}` : ""}</p>
      <details className="how" open><summary>{t("mp.how")}</summary><p>{t(`mp.l.${layer}.how`)}</p><p><b>{t("mp.mean")}</b> {t(`mp.l.${layer}.mean`)}</p></details>
      <p className="muted">{t("mp.agg")}</p>
    </div>
  );
}
