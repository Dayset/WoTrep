import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { VIEW_ALPHA, VIEW_FOV_DEG, VIEW_RANGE_M, trainerMatch, type TrainerSel } from "./viewConfig";
import { sfxStart, sfxShot, type ShotKind } from "./sfx";
import { stateAt, type BattleTimeline, type Unit } from "@wotrep/model";
import { vehicleLabel } from "@wotrep/gamedata";
import { wpSeries } from "@wotrep/analysis";
import type { Finding } from "@wotrep/coach";
import { t } from "../../i18n";
import { loadMap, type MapBounds } from "../../lib/mapStore";
import { MapLoader } from "./MapLoader";
import { MiniMap } from "./MiniMap";
import { heightImage } from "../../lib/heightImage";
const PovView = lazy(() => import("./PovView"));
import { DamageLog } from "./DamageLog";
import { flankModel, flankState, seriesFor, aimAt, heightField, estimateReload, reloadProgress, shotTimes, type ReloadEstimate } from "@wotrep/analysis";
import { goodPlaysAll, dangerSpots, type GoodPlay, type DangerSpot } from "@wotrep/coach";
import { FindingCard } from "../report/Findings";

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const GHOST_FADE_S = 30, TRAIL_S = 10, GRID_M = 100;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const now = () => performance.now() / 1000;
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

interface Cam { cx: number; cz: number; s: number }

/** 2D tactical player (docs/UX.md §3), first cut: grid map (no minimap image until game data lands), units with fog-of-war ghosts,
 *  trails, shots/hits/kills, team bars with win probability, timeline with kill ticks, keyboard controls. Canvas 2D, no map assets. */

/** Smoke over a destroyed tank: puffs drift up for ~45 s, then fade out by 60 s. Deterministic per frame. */
const SMOKE_S = 60;
function smoke(g: CanvasRenderingContext2D, X: number, Y: number, age: number) {
  const life = Math.max(0, 1 - age / SMOKE_S), rise = Math.min(age, 45) * 3;
  for (let k = 0; k < 6; k++) {
    const sway = Math.sin(k * 1.3 + age * 0.4) * (3 + age * 0.12);
    g.globalAlpha = 0.5 * life * (1 - k * 0.1); g.fillStyle = "rgb(120,120,120)";
    g.beginPath(); g.arc(X + sway, Y - 10 - rise - k * 6, 4 + age * 0.1 + k * 0.8, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}

export function Player({ tl, findings, startAt, seekTo }: { tl: BattleTimeline; findings: Finding[]; startAt?: number; seekTo?: { t: number; n: number } }) {
  const OUTRO_S = 10, matchEnd = Math.floor(tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0), end = matchEnd + OUTRO_S;
  // outcome for the outro: the recorder's side won, lost, or the battle was drawn
  const outcome = tl.arena.winnerTeam == null || tl.arena.winnerTeam === 0 ? "draw" : tl.arena.winnerTeam === tl.recorder.team ? "win" : "lose";
  const outroRef = useRef<HTMLDivElement>(null), outro3dRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [uiT, setUiT] = useState(Math.max(0, startAt ?? 0));
  const [coach, setCoach] = useState(false), [seenIds, setSeenIds] = useState<string[]>([]);
  const [pauseOn, setPauseOn] = useState<string[]>(["mistake", "good", "info"]), [resumeS, setResumeS] = useState(0), [resumeGoodS, setResumeGoodS] = useState(8), [slowS, setSlowS] = useState(6), coachPaused = useRef<string | false>(false);
  const [view3d, setView3d] = useState<"off" | "fp" | "chase">("chase"), [scope, setScope] = useState(6), [lockView, setLockView] = useState(false), [resync, setResync] = useState(0), [follow, setFollow] = useState(false), [names, setNames] = useState(true), [trails, setTrails] = useState(true), [logOn, setLogOn] = useState(() => window.matchMedia?.("(min-width: 1100px)").matches === true), [setOpen, setSetOpen] = useState(false), [sel, setSel] = useState<number | null>(null);
  const [reloadOn, setReloadOn] = useState(true);
  const reloadData = useMemo(() => new Map(tl.vehicles.map((v) => { const ts = shotTimes(tl, v.vid); return [v.vid, { ts, est: estimateReload(ts) }] as const; })), [tl]);
  const reloadRef = useRef(reloadData); reloadRef.current = reloadData;
  const [sfxOn, setSfxOn] = useState(true), sfxRef = useRef(true), sfxLast = useRef(0), [trainer, setTrainer] = useState(false), [trainerSel, setTrainerSel] = useState<TrainerSel>("all");
  const shotList = useMemo(() => { const tm = new Map(tl.vehicles.map((v) => [v.vid, v.team])); return tl.events.flatMap((e) => e.k === "shot" ? [{ t: e.t, kind: (e.shooter === tl.recorder.vid ? "own" : tm.get(e.shooter) === tl.recorder.team ? "ally" : "enemy") as ShotKind }] : []).sort((a, b) => a.t - b.t); }, [tl]);
  const shotsRef = useRef(shotList); shotsRef.current = shotList;
  const deathT = useMemo(() => { const d = new Map<number, number>(); for (const e of tl.events) if (e.k === "kill" && e.t >= 0 && !d.has(e.victim)) d.set(e.victim, e.t); return d; }, [tl]);
  const clock = useRef({ t: Math.max(0, startAt ?? 0), playing: false, speed: 1 }), cam = useRef<Cam | null>(null), opts = useRef({ follow: false, names: true, trails: true, sel: null as number | null, trainer: null as TrainerSel | null, reload: true });
  const canvas = useRef<HTMLCanvasElement>(null), tline = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null);
  const maxHp = useMemo(() => { const m = { 1: 0, 2: 0 }; for (const v of tl.vehicles) m[v.team] += v.maxHealth; return m; }, [tl]);
  const curveKind = useRef<"wp" | "dmg" | "dpm" | "hit" | "flank">("wp");
  const crew = useMemo(() => goodPlaysAll(tl).filter((p) => p.vid !== tl.recorder.vid), [tl]), [dot, setDot] = useState<GoodPlay | null>(null), dangers = useMemo(() => dangerSpots(tl).filter((d) => d.vid !== tl.recorder.vid), [tl]), [dg, setDg] = useState<DangerSpot | null>(null);
  const flank = useMemo(() => flankModel(tl), [tl]), flankRef = useRef(flank); flankRef.current = flank;
  const [curve, setCurve] = useState<"wp" | "dmg" | "dpm" | "hit" | "flank">("wp"), curveCv = useRef<HTMLCanvasElement>(null), curveVidRef = useRef(tl.recorder.vid);
  const [mapInfo, setMapInfo] = useState<{ img: HTMLImageElement; b: MapBounds } | null>(null), [mapPanel, setMapPanel] = useState(false), [mapTick, setMapTick] = useState(0);
  useEffect(() => { let url = "", on = true; void loadMap(tl.arena.map).then((m) => { if (!m || !on) return; url = URL.createObjectURL(m.image); const i = new Image(); i.onload = () => { if (on) { cam.current = null; setMapInfo({ img: i, b: m.bounds }); } }; i.src = url; }); return () => { on = false; if (url) URL.revokeObjectURL(url); }; }, [tl.arena.map, mapTick]);
  const trackBounds = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const tr of Object.values(tl.tracks)) for (let i = 0; i < tr.x.length; i++) { x0 = Math.min(x0, tr.x[i]!); x1 = Math.max(x1, tr.x[i]!); z0 = Math.min(z0, tr.z[i]!); z1 = Math.max(z1, tr.z[i]!); }
    return { x0: x0 - 40, x1: x1 + 40, z0: z0 - 40, z1: z1 + 40 };
  }, [tl]);
  const bounds = mapInfo?.b ?? trackBounds;
  const [heights, setHeights] = useState(false), hmap = useMemo(() => (heights ? heightImage(heightField(tl, bounds, 25)) : null), [tl, bounds, heights]);
  const wp = useMemo(() => wpSeries(tl, tl.recorder.team, 1), [tl]);
  const kills = useMemo(() => tl.events.flatMap((e) => (e.k === "kill" && e.t >= 0 ? [e] : [])), [tl]);
  const vehicle = useMemo(() => new Map(tl.vehicles.map((v) => [v.vid, v])), [tl]);
  opts.current = { follow, names, trails, sel, trainer: trainer ? trainerSel : null, reload: reloadOn };
  const marks = useMemo(() => findings.filter((f) => f.kind !== "info" || f.tStart > 0).map((f) => ({ f, pt: Math.max(0, f.tStart - f.leadS) })).sort((a, b) => a.pt - b.pt), [findings]);
  const crewAll = useMemo(() => goodPlaysAll(tl), [tl]), dangersAll = useMemo(() => dangerSpots(tl), [tl]);
  const xmarks = useMemo(() => {
    const nm = (vid: number) => tl.vehicles.find((v) => v.vid === vid)?.name ?? "";
    const out: { id: string; pt: number; tEnd: number; text: string }[] = [];
    if (pauseOn.includes("danger")) for (const d of dangersAll) out.push({ id: `xd:${d.vid}:${d.tStart}`, pt: Math.max(0, d.tStart - 4), tEnd: d.tEnd, text: `${nm(d.vid)} · ${t("dg.spot", { got: String(d.got), dealt: String(d.dealt) })} · ${t(`dg.cause.${d.cause}`)} · ${t(`dg.do.${d.cause}`)}` });
    if (pauseOn.includes("crew")) for (const g of crewAll) if (g.vid !== tl.recorder.vid) out.push({ id: `xg:${g.vid}:${g.tStart}`, pt: Math.max(0, g.tStart - 3), tEnd: g.tEnd, text: `${nm(g.vid)} · ${t("crew.play", { dealt: String(g.dealt), got: String(g.got) })} · ${t(`crew.${g.enabled}`)}` });
    if (pauseOn.includes("death")) for (const e of tl.events) if (e.k === "kill" && e.victim === tl.recorder.vid) out.push({ id: `xk:${e.t}`, pt: Math.max(0, e.t - 5), tEnd: e.t, text: t("pause.deathCard") });
    return out.sort((a, b) => a.pt - b.pt);
  }, [tl, pauseOn, dangersAll, crewAll]);
  const pauses = useMemo(() => [...marks.filter((m) => pauseOn.includes(m.f.kind)).map((m) => ({ id: m.f.id, pt: m.pt, kind: m.f.kind as string })), ...xmarks.map((m) => ({ id: m.id, pt: m.pt, kind: m.id.startsWith("xg:") ? "good" : "other" }))].sort((a, b) => a.pt - b.pt), [marks, xmarks, pauseOn]);
  const coachRef = useRef({ on: false, seen: new Set<string>(), marks, pauses, slowS: 6 });
  coachRef.current.on = coach; coachRef.current.marks = marks; coachRef.current.pauses = pauses; coachRef.current.slowS = slowS; coachRef.current.seen = new Set(seenIds);

  // sound is on by default, but browsers only allow audio after a gesture: start the context on the first tap
  useEffect(() => { const go = () => sfxStart(); window.addEventListener("pointerdown", go, { once: true }); return () => window.removeEventListener("pointerdown", go); }, []);
  const seek = useCallback((x: number) => { clock.current.t = Math.min(end, Math.max(0, x)); setUiT(clock.current.t); }, [end]);
  const fit = useCallback((w: number, h: number) => {
    const s = Math.min(w / (bounds.x1 - bounds.x0), h / (bounds.z1 - bounds.z0));
    cam.current = { cx: (bounds.x0 + bounds.x1) / 2, cz: (bounds.z0 + bounds.z1) / 2, s };
  }, [bounds]);

  // ---- drawing ----
  const draw = useCallback(() => {
    const c = canvas.current, b = box.current; if (!c || !b) return;
    const dpr = window.devicePixelRatio || 1, W = b.clientWidth, H = b.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = `${W}px`; c.style.height = `${H}px`; }
    if (!cam.current) fit(W, H);
    const cm = cam.current!, T = clock.current.t, o = opts.current, g = c.getContext("2d")!; b.dataset.scale = cm.s.toFixed(3);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const you = css("--c-you"), foe = css("--c-foe"), ink = css("--c-ink"), grid = css("--c-grid"), bg = css("--panel"), muted = css("--muted"), me = css("--me");
    const snap = stateAt(tl, T), by = new Map(snap.units.map((u) => [u.vid, u]));
    if (o.follow) { const r = by.get(o.sel ?? tl.recorder.vid); if (r && r.known !== "never") { cm.cx = r.x; cm.cz = r.z; } }
    const sx = (x: number) => W / 2 + (x - cm.cx) * cm.s, sy = (z: number) => H / 2 - (z - cm.cz) * cm.s;
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    if (hmap) { g.imageSmoothingEnabled = true; g.globalAlpha = mapInfo ? 0.55 : 0.9; g.drawImage(hmap.canvas, sx(hmap.x0), sy(hmap.z0 + hmap.h), hmap.w * cm.s, hmap.h * cm.s); g.globalAlpha = 1; }
    if (mapInfo) { g.globalAlpha = hmap ? 0.45 : 0.9; g.drawImage(mapInfo.img, sx(mapInfo.b.x0), sy(mapInfo.b.z1), (mapInfo.b.x1 - mapInfo.b.x0) * cm.s, (mapInfo.b.z1 - mapInfo.b.z0) * cm.s); g.globalAlpha = 1; }
    // grid every 100 m, labels A.. / 1.. like the in-game minimap squares
    g.lineWidth = 1; g.strokeStyle = grid; g.font = "10px system-ui"; g.fillStyle = muted; g.textBaseline = "top";
    const gx0 = Math.floor(bounds.x0 / GRID_M) * GRID_M, gz0 = Math.floor(bounds.z0 / GRID_M) * GRID_M;
    for (let x = gx0; x <= bounds.x1; x += GRID_M) { g.beginPath(); g.moveTo(sx(x), sy(bounds.z0)); g.lineTo(sx(x), sy(bounds.z1)); g.stroke(); g.fillText(String.fromCharCode(65 + Math.round((x - gx0) / GRID_M) % 26), sx(x) + 3, sy(bounds.z1) + 2); }
    for (let z = gz0; z <= bounds.z1; z += GRID_M) { g.beginPath(); g.moveTo(sx(bounds.x0), sy(z)); g.lineTo(sx(bounds.x1), sy(z)); g.stroke(); g.fillText(String(Math.round((z - gz0) / GRID_M) + 1), sx(bounds.x0) + 3, sy(z) + 2); }
    const col = (team: number) => (team === tl.recorder.team ? you : foe);
    // trails: only through real samples, broken at gaps (never interpolated across fog)
    if (o.trails) for (const u of snap.units) {
      const tr = tl.tracks[u.vid]; if (!tr || !u.alive) continue;
      g.strokeStyle = col(u.team); g.globalAlpha = 0.35; g.lineWidth = 1.5; g.beginPath(); let pen = false, prev = -1e9;
      for (let i = 0; i < tr.t.length; i++) { const ti = tr.t[i]!; if (ti < T - TRAIL_S) continue; if (ti > T) break; if (ti - prev > 1) pen = false; if (pen) g.lineTo(sx(tr.x[i]!), sy(tr.z[i]!)); else { g.moveTo(sx(tr.x[i]!), sy(tr.z[i]!)); pen = true; } prev = ti; }
      g.stroke(); g.globalAlpha = 1;
    }
    const arrow = (u: Unit, r: number, fill: boolean, alpha: number) => {
      const X = sx(u.x), Y = sy(u.z), dx = Math.sin(u.yaw), dy = -Math.cos(u.yaw);
      g.globalAlpha = alpha; g.beginPath();
      g.moveTo(X + dx * r * 1.3, Y + dy * r * 1.3); g.lineTo(X - dx * r * 0.9 - dy * r * 0.8, Y - dy * r * 0.9 + dx * r * 0.8); g.lineTo(X - dx * r * 0.9 + dy * r * 0.8, Y - dy * r * 0.9 - dx * r * 0.8); g.closePath();
      g.lineWidth = 2; g.strokeStyle = col(u.team); if (fill) { g.fillStyle = col(u.team); g.fill(); } g.stroke(); g.globalAlpha = 1;
    };
    // trainer: view range circle and field-of-view cone for every known live tank, friend or foe, at 20% opacity
    if (o.trainer !== null) for (const u of snap.units) {
      if (u.known !== "live" || !u.alive || !trainerMatch(o.trainer, u.vid, u.team, tl.recorder.team)) continue;
      const X = sx(u.x), Y = sy(u.z), R = VIEW_RANGE_M.value * cm.s, half = (VIEW_FOV_DEG.value * Math.PI) / 360, mid = u.yaw - Math.PI / 2;
      g.globalAlpha = VIEW_ALPHA.value; g.fillStyle = col(u.team); g.strokeStyle = col(u.team); g.lineWidth = 1;
      g.beginPath(); g.moveTo(X, Y); g.arc(X, Y, R, mid - half, mid + half); g.closePath(); g.fill();
      g.setLineDash([4, 4]); g.beginPath(); g.arc(X, Y, R, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.globalAlpha = 1;
    }
    // dead tanks: small cross at last position; ghosts: hollow, fading over 30 s with age; live: filled
    for (const u of snap.units) {
      if (u.known === "never") continue;
      const X = sx(u.x), Y = sy(u.z), isMe = u.vid === tl.recorder.vid;
      if (!u.alive) { const dth = deathT.get(u.vid); if (dth != null && T >= dth && T - dth < SMOKE_S) smoke(g, X, Y, T - dth); }
      if (!u.alive) { g.strokeStyle = muted; g.globalAlpha = 0.6; g.lineWidth = 2; g.beginPath(); g.moveTo(X - 4, Y - 4); g.lineTo(X + 4, Y + 4); g.moveTo(X + 4, Y - 4); g.lineTo(X - 4, Y + 4); g.stroke(); g.globalAlpha = 1; continue; }
      if (u.known === "ghost") { const a = Math.max(0, 1 - (u.ageS ?? 0) / GHOST_FADE_S); if (a <= 0.03) continue; arrow(u, 7, false, 0.15 + 0.6 * a); if (o.names) { g.fillStyle = muted; g.globalAlpha = 0.3 + 0.5 * a; g.textBaseline = "top"; g.fillText(`${Math.round(u.ageS ?? 0)}s`, X + 9, Y - 5); g.globalAlpha = 1; } continue; }
      arrow(u, 8, true, 1);
      if (o.reload && u.alive && u.known === "live") { const rd = reloadRef.current.get(u.vid); const rp = rd ? reloadProgress(rd.ts, rd.est, T) : null;
        if (rp != null) { g.strokeStyle = ink; g.globalAlpha = 0.9; g.lineWidth = 2.5; g.beginPath(); g.arc(X, Y, 19, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * rp); g.stroke(); g.globalAlpha = 1; } }
      if (isMe) { g.strokeStyle = me; g.lineWidth = 2; g.beginPath(); g.arc(X, Y, 13, 0, 7); g.stroke(); }
      if (o.sel === u.vid) { g.strokeStyle = ink; g.lineWidth = 1.5; g.beginPath(); g.arc(X, Y, 16, 0, 7); g.stroke(); }
      const frac = Math.max(0, Math.min(1, u.hp / (vehicle.get(u.vid)?.maxHealth || 1)));
      g.fillStyle = grid; g.fillRect(X - 10, Y + 11, 20, 3); g.fillStyle = frac > 0.3 ? col(u.team) : ink; g.fillRect(X - 10, Y + 11, 20 * frac, 3);
      if (o.names) { g.fillStyle = ink; g.textBaseline = "bottom"; g.fillText(vehicle.get(u.vid)?.name.slice(0, 12) ?? "", X - 10, Y - 11); }
    }
    // combat: fire lines (0.4 s), shot flashes (0.35 s), damage floaters (1.5 s), kill crosses (4 s)
    for (const e of tl.events) {
      if (e.t > T) break; const age = T - e.t;
      if (e.k === "damage" && age < 0.4) { const a = by.get(e.attacker), v = by.get(e.target); if (a && v && a.known !== "never" && v.known !== "never") { g.strokeStyle = col(a.team); g.globalAlpha = 1 - age / 0.4; g.lineWidth = 2; g.beginPath(); g.moveTo(sx(a.x), sy(a.z)); g.lineTo(sx(v.x), sy(v.z)); g.stroke(); g.globalAlpha = 1; } }
      if (e.k === "shot" && age < 0.35) { const a = by.get(e.shooter); if (a && a.known === "live") { g.strokeStyle = col(a.team); g.globalAlpha = 1 - age / 0.35; g.lineWidth = 2; g.beginPath(); g.arc(sx(a.x), sy(a.z), 10 + age * 40, 0, 7); g.stroke(); g.globalAlpha = 1; } }
      if (e.k === "damage" && age < 1.5) { const v = by.get(e.target); if (v && v.known !== "never") { g.globalAlpha = 1 - age / 1.5; g.fillStyle = ink; g.font = "bold 12px system-ui"; g.textBaseline = "bottom"; g.fillText(`−${e.amount}`, sx(v.x) + 8, sy(v.z) - 14 - age * 18); g.font = "10px system-ui"; g.globalAlpha = 1; } }
      if (e.k === "kill" && age < 4) { const v = by.get(e.victim); if (v && v.known !== "never") { g.globalAlpha = 1 - age / 4; g.strokeStyle = ink; g.lineWidth = 3; g.beginPath(); g.arc(sx(v.x), sy(v.z), 14 + age * 6, 0, 7); g.stroke(); g.globalAlpha = 1; } }
    }
    // evidence of the finding being shown (docs/contracts/findings.md `Evidence`)
    const act = coachRef.current.marks.find((m) => T >= m.pt && T <= m.f.tEnd + 1.5)?.f, accent = css("--accent");
    if (act) for (const ev of act.evidence) {
      g.save(); g.lineWidth = 2;
      if (ev.k === "zone") { g.strokeStyle = ev.style === "exposed" ? foe : ev.style === "cover" ? you : accent; g.setLineDash([6, 5]); g.globalAlpha = 0.9; g.beginPath(); g.arc(sx(ev.x), sy(ev.z), ev.r * cm.s, 0, 7); g.stroke(); g.globalAlpha = 0.07; g.fillStyle = g.strokeStyle; g.fill(); }
      else if (ev.k === "path") { const tr = tl.tracks[ev.vid]; if (tr) { g.strokeStyle = ev.style === "actual" ? ink : accent; g.lineWidth = ev.style === "actual" ? 3 : 2; if (ev.style === "suggested") g.setLineDash([6, 5]); g.beginPath(); let pen = false, prev = -1e9; for (let i = 0; i < tr.t.length; i++) { const ti = tr.t[i]!; if (ti < ev.t0) continue; if (ti > Math.min(ev.t1, T + 0.01)) break; if (ti - prev > 1) pen = false; if (pen) g.lineTo(sx(tr.x[i]!), sy(tr.z[i]!)); else { g.moveTo(sx(tr.x[i]!), sy(tr.z[i]!)); pen = true; } prev = ti; } g.stroke(); } }
      else if (ev.k === "line") { const a = by.get(ev.from), b2 = by.get(ev.to); if (a && b2 && a.known !== "never" && b2.known !== "never") { g.strokeStyle = ev.style === "threat" ? foe : ev.style === "fire" ? ink : accent; g.setLineDash(ev.style === "spot" ? [2, 4] : ev.style === "threat" ? [8, 5] : []); g.globalAlpha = 0.85; g.beginPath(); g.moveTo(sx(a.x), sy(a.z)); g.lineTo(sx(b2.x), sy(b2.z)); g.stroke(); } }
      else if (ev.k === "unit") { const u = by.get(ev.vid); if (u && u.known !== "never") { g.strokeStyle = ink; g.setLineDash([]); g.lineWidth = 2; g.beginPath(); g.arc(sx(u.x), sy(u.z), 17 + 2 * Math.sin(now() * 6), 0, 7); g.stroke(); if (ev.label) { g.fillStyle = ink; g.font = "bold 11px system-ui"; g.textBaseline = "top"; g.fillText(ev.label.startsWith("coach.ev.") ? t(ev.label) : ev.label, sx(u.x) + 20, sy(u.z) + 8); } } }
      else if (ev.k === "timer") { const u = by.get(ev.vid); if (u && u.known !== "never") { g.fillStyle = ink; g.font = "bold 11px system-ui"; g.textBaseline = "top"; g.fillText(`${ev.label} ${Math.max(0, ev.secondsLeft - (T - ev.t)).toFixed(1)}s`, sx(u.x) + 12, sy(u.z) - 24); } }
      g.restore();
    }
    // timeline strip: win probability curve, kill ticks, playhead
    const tc = tline.current;
    if (tc) {
      const tw = tc.clientWidth, th = tc.clientHeight; if (tc.width !== Math.round(tw * dpr)) { tc.width = Math.round(tw * dpr); tc.height = Math.round(th * dpr); }
      const k = tc.getContext("2d")!; k.setTransform(dpr, 0, 0, dpr, 0, 0); k.fillStyle = bg; k.fillRect(0, 0, tw, th);
      const X = (v: number) => (v / Math.max(1, end)) * tw;
      k.strokeStyle = grid; k.beginPath(); k.moveTo(0, th * 0.5); k.lineTo(tw, th * 0.5); k.stroke();
      k.strokeStyle = you; k.lineWidth = 2; k.beginPath(); wp.t.forEach((v, i) => { const y = 4 + (1 - wp.wp[i]!) * (th - 18); if (i) k.lineTo(X(v), y); else k.moveTo(X(v), y); }); k.stroke();
      for (const p of crew) { const ally = p.team === tl.recorder.team, y = ally ? th - 31 : th - 20; k.globalAlpha = 0.35 + 0.65 * p.coverage; k.fillStyle = ally ? you : foe; k.beginPath(); k.arc(X(p.tStart), y, 3.5, 0, 7); k.fill(); k.globalAlpha = 1; if (p.enabled === "carried") { k.strokeStyle = ink; k.lineWidth = 1.5; k.beginPath(); k.arc(X(p.tStart), y, 6, 0, 7); k.stroke(); } if (dot === p) { k.strokeStyle = accent; k.lineWidth = 2; k.beginPath(); k.arc(X(p.tStart), y, 9, 0, 7); k.stroke(); } }
      for (const d of dangers) { const ally = d.team === tl.recorder.team, y = ally ? th - 31 : th - 20, x = X(d.tStart); k.globalAlpha = 0.35 + 0.65 * d.coverage; k.strokeStyle = ally ? you : foe; k.lineWidth = 2; k.beginPath(); k.moveTo(x - 3.5, y - 3.5); k.lineTo(x + 3.5, y + 3.5); k.moveTo(x + 3.5, y - 3.5); k.lineTo(x - 3.5, y + 3.5); k.stroke(); k.globalAlpha = 1; if (dg === d) { k.strokeStyle = accent; k.beginPath(); k.arc(x, y, 9, 0, 7); k.stroke(); } }
      for (const e of kills) { const victimTeam = vehicle.get(e.victim)?.team; k.fillStyle = victimTeam === tl.recorder.team ? foe : you; k.beginPath(); k.arc(X(e.t), th - 7, 3.5, 0, 7); k.fill(); }
      k.font = "bold 11px system-ui"; k.textBaseline = "top"; for (const { f } of coachRef.current.marks) { k.fillStyle = f.kind === "mistake" ? foe : f.kind === "good" ? you : muted; k.fillRect(X(f.tStart) - 6, 1, 12, 13); k.fillStyle = bg; k.fillText(f.kind === "mistake" ? "!" : f.kind === "good" ? "✓" : "i", X(f.tStart) - 2.5, 2); }
      k.strokeStyle = ink; k.lineWidth = 2; k.beginPath(); k.moveTo(X(T), 0); k.lineTo(X(T), th); k.stroke();
    }
    // linked curve: the chosen running metric for the followed player, same clock, flags from the findings
    const cc = curveCv.current;
    if (cc) {
      const cw = cc.clientWidth, ch = cc.clientHeight; if (cc.width !== Math.round(cw * dpr)) { cc.width = Math.round(cw * dpr); cc.height = Math.round(ch * dpr); }
      const q = cc.getContext("2d")!; q.setTransform(dpr, 0, 0, dpr, 0, 0); q.fillStyle = bg; q.fillRect(0, 0, cw, ch);
      const sr = seriesFor(tl, curveVidRef.current), kind = curveKind.current;
      if (kind === "flank") {
        const fm = flankRef.current, rh = (ch - 10) / 3, X3 = (v: number) => (v / Math.max(1, end)) * cw;
        if (!fm) { q.fillStyle = muted; q.font = "12px system-ui"; q.textBaseline = "top"; q.fillText(t("curve.flank.none"), 8, 8); }
        else for (let b = 0; b < 3; b++) for (let i = 0; i < fm.t.length; i++) {
          const st = flankState(fm.ratio[b]![i]!); if (!st) continue; q.globalAlpha = 0.85; q.fillStyle = st === "ahead" ? you : st === "behind" ? foe : muted;
          q.fillRect(X3(fm.t[i]!), 5 + b * rh, Math.max(1, X3(fm.t[1] ?? 5) - X3(0)) + 0.5, rh - 2);
        }
        q.globalAlpha = 1; q.fillStyle = ink; q.font = "bold 10px system-ui"; q.textBaseline = "top"; ["L", "C", "R"].forEach((l, b) => q.fillText(l, 3, 7 + b * rh));
      }
      const ys: (number | null)[] = kind === "flank" ? [] : kind === "wp" ? Array.from({ length: end + 1 }, (_, i) => wp.wp[Math.min(wp.wp.length - 1, i)] ?? null) : kind === "dmg" ? sr.dmg : kind === "dpm" ? sr.dpm : sr.hitRate;
      const mx = kind === "wp" || kind === "hit" || kind === "flank" ? 1 : Math.max(1, ...ys.map((v) => v ?? 0)), X2 = (v: number) => (v / Math.max(1, end)) * cw, Y2 = (v: number) => 6 + (1 - v / mx) * (ch - 14);
      q.strokeStyle = grid; q.lineWidth = 1; q.beginPath(); q.moveTo(0, Y2(mx / 2)); q.lineTo(cw, Y2(mx / 2)); q.stroke();
      q.strokeStyle = you; q.lineWidth = 2; q.beginPath(); let pen = false; ys.forEach((v, i) => { if (v == null) { pen = false; return; } const x = X2(i), y = Y2(v); if (pen) q.lineTo(x, y); else { q.moveTo(x, y); pen = true; } }); q.stroke();
      for (const { f } of coachRef.current.marks) { q.strokeStyle = f.kind === "mistake" ? foe : f.kind === "good" ? you : muted; q.setLineDash([3, 3]); q.beginPath(); q.moveTo(X2(f.tStart), 0); q.lineTo(X2(f.tStart), ch); q.stroke(); }
      q.setLineDash([]); q.strokeStyle = ink; q.lineWidth = 2; q.beginPath(); q.moveTo(X2(T), 0); q.lineTo(X2(T), ch); q.stroke();
      const i = Math.min(end, Math.floor(T)), cur = ys[i]; q.fillStyle = ink; q.font = "bold 11px system-ui"; q.textBaseline = "top";
      if (cur != null) q.fillText(kind === "wp" || kind === "hit" ? `${Math.round(cur * 100)}%` : Math.round(cur).toLocaleString(), Math.min(cw - 50, X2(T) + 4), 2);
    }
  }, [tl, bounds, wp, kills, vehicle, end, fit, mapInfo, crew, dot, dangers, dg, hmap]);

  // ---- clock loop ----
  useEffect(() => {
    let raf = 0, last = performance.now(), lastUi = -1;
    const frame = (now: number) => {
      const c = clock.current, dt = (now - last) / 1000; last = now;
      if (c.playing) {
        const cr = coachRef.current; let sp = c.speed;
        if (cr.on && cr.slowS > 0) for (const m of cr.pauses) if (!cr.seen.has(m.id) && c.t >= m.pt - cr.slowS && c.t < m.pt) sp = Math.min(sp, 0.5);
        const nt = Math.min(end, c.t + dt * sp);
        if (cr.on) for (const m of cr.pauses) if (!cr.seen.has(m.id) && c.t < m.pt && nt >= m.pt) { c.t = m.pt; c.playing = false; coachPaused.current = m.kind; setPlaying(false); setSeenIds((x) => [...x, m.id]); setUiT(m.pt); break; }
        if (c.playing) c.t = nt;
        if (c.t >= end) { c.playing = false; setPlaying(false); }
      }
      if (sfxRef.current && c.playing && c.t > sfxLast.current && c.t - sfxLast.current < 1.5) {
        const sh = shotsRef.current; let lo = 0, hi = sh.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sh[mid]!.t <= sfxLast.current) lo = mid + 1; else hi = mid; }
        for (let i = lo; i < sh.length && sh[i]!.t <= c.t; i++) sfxShot(sh[i]!.kind);
      }
      sfxLast.current = c.t;
      // outro: after the match, the scene fades smoothly to 50% black over OUTRO_S, the title fades in after 2 s
      { const p = Math.min(1, Math.max(0, (c.t - matchEnd) / OUTRO_S)), ease = p * p * (3 - 2 * p), els = [outroRef.current, outro3dRef.current];
        for (const el of els) if (el) { el.style.opacity = c.t > matchEnd ? "1" : "0"; el.style.setProperty("--fade", String(0.5 * ease));
          el.style.setProperty("--txt", String(Math.min(1, Math.max(0, (c.t - matchEnd - 2) / 2)))); } }
      const q = Math.floor(c.t * 10); if (q !== lastUi) { lastUi = q; setUiT(c.t); }
      draw(); raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame); return () => cancelAnimationFrame(raf);
  }, [draw, end, matchEnd]);
  useEffect(() => { clock.current.playing = playing; clock.current.speed = speed; }, [playing, speed]);

  useEffect(() => {
    if (playing) { coachPaused.current = false; return; }
    const kind = coachPaused.current, delay = kind === "good" ? resumeGoodS : resumeS;
    if (!kind || !coach || delay <= 0) return;
    const h = window.setTimeout(() => { coachPaused.current = false; setPlaying(true); }, delay * 1000); return () => window.clearTimeout(h);
  }, [playing, coach, resumeS, resumeGoodS]);
  // ---- input ----
  const jump = useCallback((dir: 1 | -1) => {
    const cur = clock.current.t, ms = coachRef.current.pauses, m = dir > 0 ? ms.find((x) => x.pt > cur + 0.05) : [...ms].reverse().find((x) => x.pt < cur - 0.05);
    if (m) { seek(m.pt); setPlaying(false); setSeenIds((x) => (x.includes(m.id) ? x : [...x, m.id])); }
  }, [seek]);
  const toggle = useCallback(() => { if (clock.current.t >= end) seek(0); setPlaying((p) => !p); }, [end, seek]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tg = (e.target as HTMLElement)?.tagName; if (tg === "INPUT" || tg === "SELECT" || tg === "TEXTAREA") return;
      if (!box.current || box.current.offsetParent === null) return; // player tab hidden
      if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowLeft") seek(clock.current.t - 5); else if (e.key === "ArrowRight") seek(clock.current.t + 5);
      else if (e.key === ",") seek(clock.current.t - 0.1); else if (e.key === ".") seek(clock.current.t + 0.1);
      else if (/^[1-6]$/.test(e.key)) setSpeed(SPEEDS[Number(e.key) - 1]!);
      else if (e.key === "f" || e.key === "F") setFollow((f) => !f);
      else if (e.key === "n" || e.key === "N") jump(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [toggle, seek, jump]);
  useEffect(() => { if (seekTo) { seek(seekTo.t); setView3d((v) => v); } }, [seekTo?.n])

  const ptrs = useRef(new Map<number, { x: number; y: number }>()), drag = useRef<{ moved: boolean; pinched: boolean } | null>(null), pinch = useRef<{ d: number; mx: number; my: number } | null>(null);
  const zoomAt = (mx: number, my: number, ns: number) => { const cm = cam.current; if (!cm) return; ns = Math.min(8, Math.max(0.2, ns)); cm.cx += mx / cm.s - mx / ns; cm.cz -= my / cm.s - my / ns; cm.s = ns; };
  const rel = (cx: number, cy: number) => { const r = box.current!.getBoundingClientRect(); return { x: cx - r.left - r.width / 2, y: cy - r.top - r.height / 2 }; };
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 1) drag.current = { moved: false, pinched: false };
    if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()] as [{ x: number; y: number }, { x: number; y: number }]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; if (drag.current) drag.current.pinched = true; setFollow(false); }
  };
  const onMove = (e: React.PointerEvent) => {
    const prev = ptrs.current.get(e.pointerId), cm = cam.current; if (!prev || !cm) return;
    if (ptrs.current.size >= 2 && pinch.current) {
      ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...ptrs.current.values()] as [{ x: number; y: number }, { x: number; y: number }], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, p = pinch.current;
      if (p.d > 0 && d > 0) { const c = rel(mx, my); cm.cx -= (mx - p.mx) / cm.s; cm.cz += (my - p.my) / cm.s; zoomAt(c.x, c.y, cm.s * (d / p.d)); }
      pinch.current = { d, mx, my }; return;
    }
    const dx = e.clientX - prev.x, dz = e.clientY - prev.y, dr = drag.current; if (!dr) return;
    if (Math.abs(dx) + Math.abs(dz) > 3 || dr.moved) { dr.moved = true; setFollow(false); cm.cx -= dx / cm.s; cm.cz += dz / cm.s; ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }
  };
  const onUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId); if (ptrs.current.size < 2) pinch.current = null;
    const d = drag.current; if (ptrs.current.size === 0) drag.current = null; const cm = cam.current, b = box.current; if (!d || d.moved || d.pinched || !cm || !b) return;
    const r = b.getBoundingClientRect(), wx = cm.cx + (e.clientX - r.left - r.width / 2) / cm.s, wz = cm.cz - (e.clientY - r.top - r.height / 2) / cm.s;
    let best: number | null = null, bd = 22 / cm.s; for (const u of stateAt(tl, clock.current.t).units) if (u.known !== "never" && u.alive) { const dd = Math.hypot(u.x - wx, u.z - wz); if (dd < bd) { bd = dd; best = u.vid; } }
    setSel(best);
  };
  const onWheel = (e: React.WheelEvent) => { const c = rel(e.clientX, e.clientY); zoomAt(c.x, c.y, (cam.current?.s ?? 1) * Math.exp(-e.deltaY * 0.0015)); };
  const zoomBtn = (f: number) => { zoomAt(0, 0, (cam.current?.s ?? 1) * f); };
  /** Zoom to where the tanks currently are (battle start has every tank in two small clusters, which looks like two dots when fitted to the whole map). */
  const fitUnits = useCallback(() => {
    const b = box.current, cm = cam.current; if (!b || !cm) return;
    const us = stateAt(tl, clock.current.t).units.filter((u) => u.known !== "never" && u.alive); if (!us.length) return;
    const xs = us.map((u) => u.x), zs = us.map((u) => u.z), w = Math.max(150, Math.max(...xs) - Math.min(...xs)) * 1.3, h = Math.max(150, Math.max(...zs) - Math.min(...zs)) * 1.3;
    cm.cx = (Math.max(...xs) + Math.min(...xs)) / 2; cm.cz = (Math.max(...zs) + Math.min(...zs)) / 2; cm.s = Math.min(8, Math.min(b.clientWidth / w, b.clientHeight / h)); setFollow(false);
  }, [tl]);
  const scrubC = (e: React.PointerEvent<HTMLCanvasElement>) => { if (e.type === "pointermove" && e.buttons !== 1) return; const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * end); };
  const scrub = (e: React.PointerEvent<HTMLCanvasElement>) => { if (e.type === "pointermove" && e.buttons !== 1) return; const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * end); };

  const xActive = coach ? xmarks.find((m) => uiT >= m.pt && uiT <= m.tEnd + 1.5) : undefined;
  const active = marks.find((m) => uiT >= m.pt && uiT <= m.f.tEnd + 1.5)?.f;
  const snap = stateAt(tl, uiT), r = tl.recorder.team, o = r === 1 ? 2 : 1;
  const curveVid = sel ?? tl.recorder.vid; curveVidRef.current = curveVid; curveKind.current = curve;
  const sr = useMemo(() => seriesFor(tl, curveVid), [tl, curveVid]);
  const wpNow = wp.wp[Math.min(wp.wp.length - 1, Math.round(uiT))] ?? 0.5;
  const su = sel != null ? snap.units.find((u) => u.vid === sel) : null, sv = sel != null ? vehicle.get(sel) : null;
  const view3dCtl = view3d !== "off" && <div className="p3dctl" onPointerDown={(e) => e.stopPropagation()}>
    <button type="button" aria-pressed={lockView} onClick={() => setLockView(!lockView)} title={t("pov.lock")} aria-label={t("pov.lock")}>{lockView ? "🔒" : "🔓"}</button>
    <button type="button" onClick={() => setResync((n) => n + 1)} title={t("pov.resync.tip")} aria-label={t("pov.resync")}>⟲</button>
    {view3d === "fp" && <select value={scope} onChange={(e) => setScope(Number(e.target.value))} aria-label={t("pov.scope")} data-testid="scope">{[1, 3, 6, 12].map((z) => <option key={z} value={z}>{z === 1 ? "1×" : `${z}×`}</option>)}</select>}
  </div>;
  const chk = (v: boolean, set: (x: boolean) => void, key: string, testid?: string) => <label className="opt"><input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} data-testid={testid} /> {t(key)}</label>;
  return (
    <div className="player" data-testid="player">
      <div className="pmain">
      <div className="pbars">
        <div className="pteam you"><b>{snap.alive[r]}</b> · {Math.round(snap.teamHp[r]).toLocaleString()}<i style={{ width: `${(snap.teamHp[r] / maxHp[r]) * 100}%` }} /></div>
        <div className="pwp" title={t("player.wp")}>{Math.round(wpNow * 100)}%</div>
        <div className="pteam foe"><b>{snap.alive[o]}</b> · {Math.round(snap.teamHp[o]).toLocaleString()}<i style={{ width: `${(snap.teamHp[o] / maxHp[o]) * 100}%` }} /></div>
      </div>
      <canvas ref={tline} className="ptimeline povtl" onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; const hit = crew.find((p) => Math.abs((p.tStart / Math.max(1, end)) * r.width - x) <= 9 && Math.abs((p.team === tl.recorder.team ? r.height - 31 : r.height - 20) - y) <= 9); const dh = hit ? undefined : dangers.find((d) => Math.abs((d.tStart / Math.max(1, end)) * r.width - x) <= 9 && Math.abs((d.team === tl.recorder.team ? r.height - 31 : r.height - 20) - y) <= 9); if (hit) { setDot(hit); setDg(null); seek(hit.tStart - 3); } else if (dh) { setDg(dh); setDot(null); seek(dh.tStart - 3); } else { setDot(null); setDg(null); scrub(e); } }} onPointerMove={(e) => { e.stopPropagation(); scrub(e); }} aria-label={t("player.timeline")} role="slider" aria-valuemin={0} aria-valuemax={end} aria-valuenow={Math.round(uiT)} />
      <div className="pmap" ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} onDoubleClick={() => { const b = box.current; if (b) fit(b.clientWidth, b.clientHeight); setFollow(false); }}>
        <div className="pstage"><canvas ref={canvas} aria-label={t("player.aria")} role="img" />
          <div ref={outroRef} className={`outro ${outcome}`} aria-hidden="true" style={{ opacity: 0 }}><b>{t(`outro.${outcome}`)}</b></div></div>
        {view3d !== "off" && <div className="povwrap" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}><MiniMap tl={tl} clock={clock} vid={sel ?? tl.recorder.vid} img={mapInfo?.img ?? null} bounds={bounds} fp={view3d === "fp"} /><Suspense fallback={<p className="muted">…</p>}><PovView reload={reloadOn} trainer={{ on: trainer, sel: trainerSel }} tl={tl} clock={clock} vid={sel ?? tl.recorder.vid} mode={view3d} img={mapInfo?.img ?? null} bounds={bounds} zoom={scope} lock={lockView} resync={resync} trails={trails} /></Suspense>{<div ref={outro3dRef} className={`outro ${outcome}`} aria-hidden="true" style={{ opacity: 0, zIndex: 4 }}><b>{t(`outro.${outcome}`)}</b></div>}{(() => { const a = aimAt(tl, sel ?? tl.recorder.vid, uiT); return a ? <><b className="scope" aria-hidden="true" hidden={!(view3d === "fp" && scope > 1 && a.onTarget)} /><div className="aimhud" aria-live="off"><i style={{ width: `${Math.round(70 - 54 * a.aimProgress)}px`, height: `${Math.round(70 - 54 * a.aimProgress)}px` }} data-done={a.aimProgress >= 1} /><span>{a.aimS.toFixed(1)} / 2.3 s{a.moving ? ` · ${t("pov.turning")}` : ""}</span></div></> : null; })()}</div>}
        <div className="pviewsw" role="group" aria-label={t("pov.view")} onPointerDown={(e) => e.stopPropagation()}>{(["off", "fp", "chase"] as const).map((m) => <button type="button" key={m} aria-pressed={view3d === m} onClick={() => setView3d(m)} title={t(`pov.${m}`)} data-testid={`v3d-${m}`}>{t(`ui.v.${m}`)}</button>)}</div>
        {view3dCtl}
        {sv && su && <div className="pinfo"><b>{sv.name}</b> · {vehicleLabel(sv.vehicleType).label}<div>{su.alive ? `${Math.round(su.hp)} / ${sv.maxHealth} HP` : "✕"}{su.known === "ghost" ? ` · ${t("player.lastseen", { s: Math.round(su.ageS ?? 0) })}` : ""}</div></div>}
        {hmap && view3d === "off" && <div className="hlegend" onPointerDown={(e) => e.stopPropagation()}><i /><span>{Math.round(hmap.min)} m</span><span>{Math.round(hmap.max)} m</span><small>{t("player.heights.note")}</small></div>}
        {view3d === "off" && <div className="pzoom" onPointerDown={(e) => e.stopPropagation()}><button type="button" onClick={() => zoomBtn(1.4)} aria-label={t("player.zoomin")}>+</button><button type="button" onClick={() => zoomBtn(1 / 1.4)} aria-label={t("player.zoomout")}>−</button><button type="button" onClick={fitUnits} aria-label={t("player.fitunits")} title={t("player.fitunits")}>◎</button><button type="button" onClick={() => { const b = box.current; if (b) fit(b.clientWidth, b.clientHeight); }} aria-label={t("player.fitmap")} title={t("player.fitmap")}>⤢</button><button type="button" onClick={() => setMapPanel(true)} aria-label={t("map.open")} title={t("map.open")}>🗺</button></div>}
        {!active && xActive && <div className="pcard" onPointerDown={(e) => e.stopPropagation()}><p>{xActive.text}</p>{!playing && <button type="button" onClick={() => { coachPaused.current = false; setPlaying(true); }}>{t("coach.continue")}</button>}</div>}
        {active && <div className="pcard" onPointerDown={(e) => e.stopPropagation()}><FindingCard f={active} actions={!playing && <><button type="button" onClick={() => setPlaying(true)}>{t("coach.continue")}</button> <button type="button" onClick={() => { setSel(active.vid); seek(active.tStart - 4); setView3d("fp"); }}>{t("pov.show")}</button></>} /></div>}
        {!mapInfo && view3d === "off" && <div className="pnote">{t("player.nomap")}</div>}
        {mapPanel && <MapLoader mapName={tl.arena.map} onSaved={() => setMapTick((x) => x + 1)} onClose={() => setMapPanel(false)} />}
      </div>
      <div className="pctl ptransport">
        <button type="button" onClick={toggle} aria-label={playing ? t("player.pause") : t("player.play")} className="pbig" data-testid="play">{playing ? "⏸" : "▶"}</button>
        <button type="button" onClick={() => jump(-1)} aria-label={t("coach.prev")} title={t("coach.prev")}>⏮</button>
        <button type="button" onClick={() => seek(uiT - 5)} aria-label="−5 s" title="−5 s">⏪</button><button type="button" onClick={() => seek(uiT + 5)} aria-label="+5 s" title="+5 s">⏩</button>
        <button type="button" onClick={() => jump(1)} aria-label={t("coach.next")} title={t("coach.next")}>⏭</button>
        <span className="ptime">{mmss(uiT)} / {mmss(end)}</span>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label={t("player.speed")}>{SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}</select>
      </div>
      </div>
      <aside className="pside">
        <div className="prow">
          <select className="pwho" value={sel ?? ""} onChange={(e) => setSel(e.target.value === "" ? null : Number(e.target.value))} data-testid="who" aria-label={t("pov.who")} title={t("pov.who")}>
            <option value="">👁 {vehicle.get(tl.recorder.vid)?.name} ({t("pov.me")})</option>
            <optgroup label={t("pov.team")}>{tl.vehicles.filter((v) => v.team === tl.recorder.team && !v.isRecorder).sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.vid} value={v.vid}>{v.name}</option>)}</optgroup>
            <optgroup label={t("pov.foes")}>{tl.vehicles.filter((v) => v.team !== tl.recorder.team).sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.vid} value={v.vid}>{v.name}</option>)}</optgroup>
          </select>
          {sel != null && <button type="button" onClick={() => setSel(null)} data-testid="backme" title={t("pov.me")} aria-label={t("pov.me")}>↩</button>}
          <button type="button" aria-pressed={reloadOn} onClick={() => setReloadOn(!reloadOn)} data-testid="reloadbtn">⏱ {t("player.reload")}</button>
          <button type="button" aria-pressed={trainer} onClick={() => setTrainer(!trainer)} data-testid="trainerbtn">🎯 {t("player.trainer")}</button>
          {trainer && <label><select className="pick" value={String(trainerSel)} onChange={(e) => { const v = e.target.value; setTrainerSel(v === "all" || v === "ally" || v === "enemy" ? v : Number(v)); }} data-testid="trainersel">
            <option value="all">{t("viz.side.all")}</option><option value="ally">{t("viz.cmp.allies")}</option><option value="enemy">{t("viz.cmp.enemies")}</option>
            {tl.vehicles.map((v) => <option key={v.vid} value={v.vid}>{v.name}</option>)}
          </select></label>}
          <button type="button" aria-pressed={sfxOn} onClick={() => { const on = !sfxOn; if (on) sfxStart(); sfxRef.current = on; setSfxOn(on); }} data-testid="sfxbtn">🔊 {t("player.sound")}</button>
          <button type="button" aria-pressed={coach} onClick={() => setCoach(!coach)} data-testid="coachbtn">🎓 {t("ui.coach")}</button>
          <button type="button" aria-pressed={setOpen} onClick={() => setSetOpen(!setOpen)} aria-label={t("ui.settings")} title={t("ui.settings")} data-testid="settings">⚙</button>
        </div>
        {setOpen && <div className="psettings" data-testid="psettings">
          <div className="optgrid">
            {chk(follow, setFollow, "player.follow")}{chk(names, setNames, "player.names")}{chk(trails, setTrails, "player.trails")}
            {chk(heights, setHeights, "player.heights", "heights")}{chk(logOn, setLogOn, "log.toggle")}
          </div>
          {coach && <fieldset className="pauseopts"><legend>{t("pause.title")}</legend><div className="optgrid">
            {(["mistake", "good", "info", "danger", "crew", "death"] as const).map((k) => <label className="opt" key={k}><input type="checkbox" checked={pauseOn.includes(k)} onChange={(e) => setPauseOn((x) => (e.target.checked ? [...x, k] : x.filter((y) => y !== k)))} /> {t(`pause.${k}`)}</label>)}</div>
            <label className="opt">{t("pause.slow")} <select value={slowS} onChange={(e) => setSlowS(Number(e.target.value))}>{[0, 3, 6, 10].map((n) => <option key={n} value={n}>{n === 0 ? t("pause.off") : `${n} s`}</option>)}</select></label>
            <label className="opt">{t("pause.resumeGood")} <select value={resumeGoodS} onChange={(e) => setResumeGoodS(Number(e.target.value))} data-testid="resumegood">{[0, 5, 8, 10].map((n) => <option key={n} value={n}>{n === 0 ? t("pause.off") : `${n} s`}</option>)}</select></label>
            <label className="opt">{t("pause.resume")} <select value={resumeS} onChange={(e) => setResumeS(Number(e.target.value))}>{[0, 5, 10, 20].map((n) => <option key={n} value={n}>{n === 0 ? t("pause.off") : `${n} s`}</option>)}</select></label>
          </fieldset>}
          <p className="muted pdotleg">{t("crew.legend")}</p>{view3d !== "off" && <p className="muted pdotleg">{t("pov.note")}</p>}
        </div>}
        {dot && <div className="pdot" onPointerDown={(e) => e.stopPropagation()}><b className={dot.team === tl.recorder.team ? "ally" : "enemy"}>{vehicle.get(dot.vid)?.name}</b> · {t("crew.play", { dealt: String(dot.dealt), got: String(dot.got) })} · <b>{t(`crew.${dot.enabled}`)}</b>{dot.absorbedHp > 0 ? ` · ${t("crew.absorbed", { hp: String(dot.absorbedHp) })}` : ""}{dot.sacrificed.length ? ` · ${t("crew.sacrificed", { n: String(dot.sacrificed.length) })}` : ""}{dot.coverage < 0.75 ? ` · ${t("crew.lowcov", { p: String(Math.round(dot.coverage * 100)) })}` : ""}</div>}
        {dg && <div className="pdot" onPointerDown={(e) => e.stopPropagation()}><b className={dg.team === tl.recorder.team ? "ally" : "enemy"}>{vehicle.get(dg.vid)?.name}</b> · {t("dg.spot", { got: String(dg.got), dealt: String(dg.dealt) })} · <b>{t(`dg.cause.${dg.cause}`)}</b> · {t(`dg.do.${dg.cause}`)}{dg.coverage < 0.75 ? ` · ${t("crew.lowcov", { p: String(Math.round(dg.coverage * 100)) })}` : ""} <button type="button" onClick={() => { setSel(dg.vid); seek(dg.tStart - 4); setView3d("fp"); }}>{t("pov.show")}</button></div>}
        <div className="pcurve">
          <div className="segbar sm" role="tablist" aria-label={t("curve.aria")} onPointerDown={(e) => e.stopPropagation()}>
            {(["wp", "dmg", "dpm", "hit", "flank"] as const).map((k) => <button type="button" role="tab" key={k} aria-selected={curve === k} onClick={() => setCurve(k)}>{t(`curve.${k}`)}</button>)}
          </div>
          <canvas ref={curveCv} className="ptimeline" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubC(e); }} onPointerMove={scrubC} aria-label={t("curve.aria")} />
          <details className="how"><summary>{sv ? sv.name : tl.recorder.name} · ?</summary><p className="muted pcurvenote">{t(`curve.${curve}.how`)}{curve !== "wp" && sr.officialDmg != null && sr.officialDmg > 0 && sr.finalDmg < sr.officialDmg * 0.98 ? ` ${t("curve.partial", { p: Math.round((sr.finalDmg / sr.officialDmg) * 100) })}` : ""}</p></details>
        </div>
        {logOn && <DamageLog tl={tl} now={uiT} onSeek={seek} />}
      </aside>
    </div>
  );
}
