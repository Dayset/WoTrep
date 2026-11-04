import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { stateAt, type BattleTimeline, type Unit } from "@wotrep/model";
import { vehicleLabel } from "@wotrep/gamedata";
import { wpSeries } from "@wotrep/analysis";
import type { Finding } from "@wotrep/coach";
import { t } from "../../i18n";
import { loadMap, type MapBounds } from "../../lib/mapStore";
import { MapLoader } from "./MapLoader";
const PovView = lazy(() => import("./PovView"));
import { DamageLog } from "./DamageLog";
import { flankModel, flankState, seriesFor, aimAt } from "@wotrep/analysis";
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
export function Player({ tl, findings, startAt, onClose }: { tl: BattleTimeline; findings: Finding[]; startAt?: number; onClose: () => void }) {
  const end = Math.floor(tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0);
  const [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [uiT, setUiT] = useState(Math.max(0, startAt ?? 0));
  const [coach, setCoach] = useState(false), [seenIds, setSeenIds] = useState<string[]>([]);
  const [view3d, setView3d] = useState<"off" | "fp" | "chase">("off"), [follow, setFollow] = useState(false), [names, setNames] = useState(true), [trails, setTrails] = useState(true), [logOn, setLogOn] = useState(false), [sel, setSel] = useState<number | null>(null);
  const clock = useRef({ t: Math.max(0, startAt ?? 0), playing: false, speed: 1 }), cam = useRef<Cam | null>(null), opts = useRef({ follow: false, names: true, trails: true, sel: null as number | null });
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
  const wp = useMemo(() => wpSeries(tl, tl.recorder.team, 1), [tl]);
  const kills = useMemo(() => tl.events.flatMap((e) => (e.k === "kill" && e.t >= 0 ? [e] : [])), [tl]);
  const vehicle = useMemo(() => new Map(tl.vehicles.map((v) => [v.vid, v])), [tl]);
  opts.current = { follow, names, trails, sel };
  const marks = useMemo(() => findings.filter((f) => f.kind !== "info" || f.tStart > 0).map((f) => ({ f, pt: Math.max(0, f.tStart - f.leadS) })).sort((a, b) => a.pt - b.pt), [findings]);
  const coachRef = useRef({ on: false, seen: new Set<string>(), marks });
  coachRef.current.on = coach; coachRef.current.marks = marks; coachRef.current.seen = new Set(seenIds);

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
    if (o.follow) { const r = by.get(tl.recorder.vid); if (r && r.known !== "never") { cm.cx = r.x; cm.cz = r.z; } }
    const sx = (x: number) => W / 2 + (x - cm.cx) * cm.s, sy = (z: number) => H / 2 - (z - cm.cz) * cm.s;
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    if (mapInfo) { g.globalAlpha = 0.9; g.drawImage(mapInfo.img, sx(mapInfo.b.x0), sy(mapInfo.b.z1), (mapInfo.b.x1 - mapInfo.b.x0) * cm.s, (mapInfo.b.z1 - mapInfo.b.z0) * cm.s); g.globalAlpha = 1; }
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
    // dead tanks: small cross at last position; ghosts: hollow, fading over 30 s with age; live: filled
    for (const u of snap.units) {
      if (u.known === "never") continue;
      const X = sx(u.x), Y = sy(u.z), isMe = u.vid === tl.recorder.vid;
      if (!u.alive) { g.strokeStyle = muted; g.globalAlpha = 0.6; g.lineWidth = 2; g.beginPath(); g.moveTo(X - 4, Y - 4); g.lineTo(X + 4, Y + 4); g.moveTo(X + 4, Y - 4); g.lineTo(X - 4, Y + 4); g.stroke(); g.globalAlpha = 1; continue; }
      if (u.known === "ghost") { const a = Math.max(0, 1 - (u.ageS ?? 0) / GHOST_FADE_S); if (a <= 0.03) continue; arrow(u, 7, false, 0.15 + 0.6 * a); if (o.names) { g.fillStyle = muted; g.globalAlpha = 0.3 + 0.5 * a; g.textBaseline = "top"; g.fillText(`${Math.round(u.ageS ?? 0)}s`, X + 9, Y - 5); g.globalAlpha = 1; } continue; }
      arrow(u, 8, true, 1);
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
      k.strokeStyle = you; k.lineWidth = 2; k.beginPath(); wp.t.forEach((v, i) => { const y = 4 + (1 - wp.wp[i]!) * (th - 18); i ? k.lineTo(X(v), y) : k.moveTo(X(v), y); }); k.stroke();
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
  }, [tl, bounds, wp, kills, vehicle, end, fit, mapInfo, crew, dot, dangers, dg]);

  // ---- clock loop ----
  useEffect(() => {
    let raf = 0, last = performance.now(), lastUi = -1;
    const frame = (now: number) => {
      const c = clock.current, dt = (now - last) / 1000; last = now;
      if (c.playing) {
        const cr = coachRef.current; let sp = c.speed;
        if (cr.on) for (const m of cr.marks) if (!cr.seen.has(m.f.id) && c.t >= m.pt - 6 && c.t < m.pt) sp = Math.min(sp, 0.5);
        const nt = Math.min(end, c.t + dt * sp);
        if (cr.on) for (const m of cr.marks) if (!cr.seen.has(m.f.id) && c.t < m.pt && nt >= m.pt) { c.t = m.pt; c.playing = false; setPlaying(false); setSeenIds((x) => [...x, m.f.id]); setUiT(m.pt); break; }
        if (c.playing) c.t = nt;
        if (c.t >= end) { c.playing = false; setPlaying(false); }
      }
      const q = Math.floor(c.t * 10); if (q !== lastUi) { lastUi = q; setUiT(c.t); }
      draw(); raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame); return () => cancelAnimationFrame(raf);
  }, [draw, end]);
  useEffect(() => { clock.current.playing = playing; clock.current.speed = speed; }, [playing, speed]);

  // ---- input ----
  const jump = useCallback((dir: 1 | -1) => {
    const cur = clock.current.t, ms = coachRef.current.marks, m = dir > 0 ? ms.find((x) => x.pt > cur + 0.05) : [...ms].reverse().find((x) => x.pt < cur - 0.05);
    if (m) { seek(m.pt); setPlaying(false); setSeenIds((x) => (x.includes(m.f.id) ? x : [...x, m.f.id])); }
  }, [seek]);
  const toggle = useCallback(() => { if (clock.current.t >= end) seek(0); setPlaying((p) => !p); }, [end, seek]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowLeft") seek(clock.current.t - 5); else if (e.key === "ArrowRight") seek(clock.current.t + 5);
      else if (e.key === ",") seek(clock.current.t - 0.1); else if (e.key === ".") seek(clock.current.t + 0.1);
      else if (/^[1-6]$/.test(e.key)) setSpeed(SPEEDS[Number(e.key) - 1]!);
      else if (e.key === "f" || e.key === "F") setFollow((f) => !f);
      else if (e.key === "n" || e.key === "N") jump(e.shiftKey ? -1 : 1); else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [toggle, seek, onClose, jump]);

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

  const active = marks.find((m) => uiT >= m.pt && uiT <= m.f.tEnd + 1.5)?.f;
  const snap = stateAt(tl, uiT), r = tl.recorder.team, o = r === 1 ? 2 : 1;
  const curveVid = sel ?? tl.recorder.vid; curveVidRef.current = curveVid; curveKind.current = curve;
  const sr = useMemo(() => seriesFor(tl, curveVid), [tl, curveVid]);
  const wpNow = wp.wp[Math.min(wp.wp.length - 1, Math.round(uiT))] ?? 0.5;
  const su = sel != null ? snap.units.find((u) => u.vid === sel) : null, sv = sel != null ? vehicle.get(sel) : null;
  return (
    <div className="player" data-testid="player">
      <div className="pbars">
        <div className="pteam you"><b>{snap.alive[r]}</b> · {Math.round(snap.teamHp[r]).toLocaleString()} HP<i style={{ width: `${(snap.teamHp[r] / maxHp[r]) * 100}%` }} /></div>
        <div className="pwp" title={t("player.wp")}>{t("player.wp")} {Math.round(wpNow * 100)}%</div>
        <div className="pteam foe"><b>{snap.alive[o]}</b> · {Math.round(snap.teamHp[o]).toLocaleString()} HP<i style={{ width: `${(snap.teamHp[o] / maxHp[o]) * 100}%` }} /></div>
      </div>
      <div className="pmap" ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} onDoubleClick={() => { const b = box.current; if (b) fit(b.clientWidth, b.clientHeight); setFollow(false); }}>
        <canvas ref={canvas} aria-label={t("player.aria")} role="img" />
        {view3d !== "off" && <div className="povwrap" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}><Suspense fallback={<p className="muted">…</p>}><PovView tl={tl} clock={clock} vid={sel ?? tl.recorder.vid} mode={view3d} img={mapInfo?.img ?? null} bounds={bounds} /></Suspense>{(() => { const a = aimAt(tl, sel ?? tl.recorder.vid, uiT); return a ? <div className="aimhud" aria-live="off"><i style={{ width: `${Math.round(70 - 54 * a.aimProgress)}px`, height: `${Math.round(70 - 54 * a.aimProgress)}px` }} data-done={a.aimProgress >= 1} /><span>{t("pov.aim")} {a.aimS.toFixed(1)} / 2.3 s{a.moving ? ` · ${t("pov.turning")}` : ""}</span></div> : null; })()}</div>}
        {sv && su && <div className="pinfo"><b>{sv.name}</b> · {vehicleLabel(sv.vehicleType).label}<div>{su.alive ? `${Math.round(su.hp)} / ${sv.maxHealth} HP` : "✕"}{su.known === "ghost" ? ` · ${t("player.lastseen", { s: Math.round(su.ageS ?? 0) })}` : ""}</div></div>}
        <div className="pzoom" onPointerDown={(e) => e.stopPropagation()}><button type="button" onClick={() => zoomBtn(1.4)} aria-label={t("player.zoomin")}>+</button><button type="button" onClick={() => zoomBtn(1 / 1.4)} aria-label={t("player.zoomout")}>−</button><button type="button" onClick={fitUnits} aria-label={t("player.fitunits")} title={t("player.fitunits")}>◎</button><button type="button" onClick={() => { const b = box.current; if (b) fit(b.clientWidth, b.clientHeight); }} aria-label={t("player.fitmap")} title={t("player.fitmap")}>⤢</button><button type="button" onClick={() => setMapPanel(true)} aria-label={t("map.open")} title={t("map.open")}>🗺</button></div>
        {active && <div className="pcard" onPointerDown={(e) => e.stopPropagation()}><FindingCard f={active} actions={!playing && <><button type="button" onClick={() => setPlaying(true)}>{t("coach.continue")}</button> <button type="button" onClick={() => { setSel(tl.recorder.vid); seek(active.tStart - 4); setView3d("fp"); }}>{t("pov.show")}</button></>} /></div>}
        {!mapInfo && <div className="pnote">{t("player.nomap")}</div>}
        {mapPanel && <MapLoader mapName={tl.arena.map} onSaved={() => setMapTick((x) => x + 1)} onClose={() => setMapPanel(false)} />}
      </div>
      <canvas ref={tline} className="ptimeline" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; const hit = crew.find((p) => Math.abs((p.tStart / Math.max(1, end)) * r.width - x) <= 9 && Math.abs((p.team === tl.recorder.team ? r.height - 31 : r.height - 20) - y) <= 9); const dh = hit ? undefined : dangers.find((d) => Math.abs((d.tStart / Math.max(1, end)) * r.width - x) <= 9 && Math.abs((d.team === tl.recorder.team ? r.height - 31 : r.height - 20) - y) <= 9); if (hit) { setDot(hit); setDg(null); seek(hit.tStart - 3); } else if (dh) { setDg(dh); setDot(null); seek(dh.tStart - 3); } else { setDot(null); setDg(null); scrub(e); } }} onPointerMove={scrub} aria-label={t("player.timeline")} role="slider" aria-valuemin={0} aria-valuemax={end} aria-valuenow={Math.round(uiT)} />
      {dot && <div className="pdot" onPointerDown={(e) => e.stopPropagation()}><b className={dot.team === tl.recorder.team ? "ally" : "enemy"}>{vehicle.get(dot.vid)?.name}</b> · {t("crew.play", { dealt: String(dot.dealt), got: String(dot.got) })} · <b>{t(`crew.${dot.enabled}`)}</b>{dot.absorbedHp > 0 ? ` · ${t("crew.absorbed", { hp: String(dot.absorbedHp) })}` : ""}{dot.sacrificed.length ? ` · ${t("crew.sacrificed", { n: String(dot.sacrificed.length) })}` : ""}{dot.coverage < 0.75 ? ` · ${t("crew.lowcov", { p: String(Math.round(dot.coverage * 100)) })}` : ""}</div>}
      {dg && <div className="pdot" onPointerDown={(e) => e.stopPropagation()}><b className={dg.team === tl.recorder.team ? "ally" : "enemy"}>{vehicle.get(dg.vid)?.name}</b> · {t("dg.spot", { got: String(dg.got), dealt: String(dg.dealt) })} · <b>{t(`dg.cause.${dg.cause}`)}</b> · {t(`dg.do.${dg.cause}`)}{dg.coverage < 0.75 ? ` · ${t("crew.lowcov", { p: String(Math.round(dg.coverage * 100)) })}` : ""} <button type="button" onClick={() => { setSel(dg.vid); seek(dg.tStart - 4); setView3d("fp"); }}>{t("pov.show")}</button></div>}
      <p className="muted pdotleg">{t("crew.legend")}</p>
      {view3d !== "off" && <p className="muted pdotleg">{t("pov.note")}</p>}
      <div className="pcurve">
        <div className="pcurvebar" onPointerDown={(e) => e.stopPropagation()}>
          {(["wp", "dmg", "dpm", "hit", "flank"] as const).map((k) => <button type="button" key={k} aria-pressed={curve === k} onClick={() => setCurve(k)}>{t(`curve.${k}`)}</button>)}
          <span className="muted">{sv ? sv.name : tl.recorder.name}</span>
        </div>
        <canvas ref={curveCv} className="ptimeline" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubC(e); }} onPointerMove={scrubC} aria-label={t("curve.aria")} />
        <p className="muted pcurvenote">{t(`curve.${curve}.how`)}{curve !== "wp" && sr.officialDmg != null && sr.officialDmg > 0 && sr.finalDmg < sr.officialDmg * 0.98 ? ` ${t("curve.partial", { p: Math.round((sr.finalDmg / sr.officialDmg) * 100) })}` : ""}</p>
      </div>
      {logOn && <DamageLog tl={tl} now={uiT} onSeek={seek} />}
      <div className="pctl">
        <button type="button" onClick={onClose}>← {t("player.back")}</button>
        <button type="button" onClick={toggle} aria-label={playing ? t("player.pause") : t("player.play")}>{playing ? "⏸" : "▶"}</button>
        <button type="button" onClick={() => seek(uiT - 5)} aria-label="−5 s">⏪</button><button type="button" onClick={() => seek(uiT + 5)} aria-label="+5 s">⏩</button>
        <span className="ptime">{mmss(uiT)} / {mmss(end)}</span>
        <span className="pspeed">{SPEEDS.map((s) => <button type="button" key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}</span>
        <button type="button" onClick={() => jump(-1)} aria-label={t("coach.prev")} title={t("coach.prev")}>⏮</button><button type="button" onClick={() => jump(1)} aria-label={t("coach.next")} title={t("coach.next")}>⏭</button>
        <span className="pview" role="group" aria-label={t("pov.view")}>{(["off", "fp", "chase"] as const).map((m) => <button type="button" key={m} aria-pressed={view3d === m} onClick={() => setView3d(m)}>{t(`pov.${m}`)}</button>)}</span>
        <label><input type="checkbox" checked={coach} onChange={(e) => setCoach(e.target.checked)} /> {t("coach.mode")}</label>
        <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {t("player.follow")}</label>
        <label><input type="checkbox" checked={logOn} onChange={(e) => setLogOn(e.target.checked)} /> {t("log.toggle")}</label>
        <label><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> {t("player.names")}</label>
        <label><input type="checkbox" checked={trails} onChange={(e) => setTrails(e.target.checked)} /> {t("player.trails")}</label>
      </div>
    </div>
  );
}
