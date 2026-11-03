import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stateAt, type BattleTimeline, type Unit } from "@wotrep/model";
import { vehicleLabel } from "@wotrep/gamedata";
import { wpSeries } from "@wotrep/analysis";
import type { Finding } from "@wotrep/coach";
import { t } from "../../i18n";
import { FindingCard } from "../report/Findings";

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const GHOST_FADE_S = 30, TRAIL_S = 10, GRID_M = 100;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

interface Cam { cx: number; cz: number; s: number }

/** 2D tactical player (docs/UX.md §3), first cut: grid map (no minimap image until game data lands), units with fog-of-war ghosts,
 *  trails, shots/hits/kills, team bars with win probability, timeline with kill ticks, keyboard controls. Canvas 2D, no map assets. */
export function Player({ tl, findings, startAt, onClose }: { tl: BattleTimeline; findings: Finding[]; startAt?: number; onClose: () => void }) {
  const end = Math.floor(tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0);
  const [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [uiT, setUiT] = useState(Math.max(0, startAt ?? 0));
  const [coach, setCoach] = useState(false), [seenIds, setSeenIds] = useState<string[]>([]);
  const [follow, setFollow] = useState(false), [names, setNames] = useState(true), [trails, setTrails] = useState(true), [sel, setSel] = useState<number | null>(null);
  const clock = useRef({ t: Math.max(0, startAt ?? 0), playing: false, speed: 1 }), cam = useRef<Cam | null>(null), opts = useRef({ follow: false, names: true, trails: true, sel: null as number | null });
  const canvas = useRef<HTMLCanvasElement>(null), tline = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null);
  const maxHp = useMemo(() => { const m = { 1: 0, 2: 0 }; for (const v of tl.vehicles) m[v.team] += v.maxHealth; return m; }, [tl]);
  const bounds = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const tr of Object.values(tl.tracks)) for (let i = 0; i < tr.x.length; i++) { x0 = Math.min(x0, tr.x[i]!); x1 = Math.max(x1, tr.x[i]!); z0 = Math.min(z0, tr.z[i]!); z1 = Math.max(z1, tr.z[i]!); }
    return { x0: x0 - 40, x1: x1 + 40, z0: z0 - 40, z1: z1 + 40 };
  }, [tl]);
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
    // timeline strip: win probability curve, kill ticks, playhead
    const tc = tline.current;
    if (tc) {
      const tw = tc.clientWidth, th = tc.clientHeight; if (tc.width !== Math.round(tw * dpr)) { tc.width = Math.round(tw * dpr); tc.height = Math.round(th * dpr); }
      const k = tc.getContext("2d")!; k.setTransform(dpr, 0, 0, dpr, 0, 0); k.fillStyle = bg; k.fillRect(0, 0, tw, th);
      const X = (v: number) => (v / Math.max(1, end)) * tw;
      k.strokeStyle = grid; k.beginPath(); k.moveTo(0, th * 0.5); k.lineTo(tw, th * 0.5); k.stroke();
      k.strokeStyle = you; k.lineWidth = 2; k.beginPath(); wp.t.forEach((v, i) => { const y = 4 + (1 - wp.wp[i]!) * (th - 18); i ? k.lineTo(X(v), y) : k.moveTo(X(v), y); }); k.stroke();
      for (const e of kills) { const victimTeam = vehicle.get(e.victim)?.team; k.fillStyle = victimTeam === tl.recorder.team ? foe : you; k.beginPath(); k.arc(X(e.t), th - 7, 3.5, 0, 7); k.fill(); }
      k.font = "bold 11px system-ui"; k.textBaseline = "top"; for (const { f } of coachRef.current.marks) { k.fillStyle = f.kind === "mistake" ? foe : f.kind === "good" ? you : muted; k.fillRect(X(f.tStart) - 6, 1, 12, 13); k.fillStyle = bg; k.fillText(f.kind === "mistake" ? "!" : f.kind === "good" ? "✓" : "i", X(f.tStart) - 2.5, 2); }
      k.strokeStyle = ink; k.lineWidth = 2; k.beginPath(); k.moveTo(X(T), 0); k.lineTo(X(T), th); k.stroke();
    }
  }, [tl, bounds, wp, kills, vehicle, end, fit]);

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
  const scrub = (e: React.PointerEvent<HTMLCanvasElement>) => { if (e.type === "pointermove" && e.buttons !== 1) return; const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * end); };

  const active = marks.find((m) => uiT >= m.pt && uiT <= m.f.tEnd + 1.5)?.f;
  const snap = stateAt(tl, uiT), r = tl.recorder.team, o = r === 1 ? 2 : 1;
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
        {sv && su && <div className="pinfo"><b>{sv.name}</b> · {vehicleLabel(sv.vehicleType).label}<div>{su.alive ? `${Math.round(su.hp)} / ${sv.maxHealth} HP` : "✕"}{su.known === "ghost" ? ` · ${t("player.lastseen", { s: Math.round(su.ageS ?? 0) })}` : ""}</div></div>}
        <div className="pzoom" onPointerDown={(e) => e.stopPropagation()}><button type="button" onClick={() => zoomBtn(1.4)} aria-label={t("player.zoomin")}>+</button><button type="button" onClick={() => zoomBtn(1 / 1.4)} aria-label={t("player.zoomout")}>−</button><button type="button" onClick={fitUnits} aria-label={t("player.fitunits")} title={t("player.fitunits")}>◎</button><button type="button" onClick={() => { const b = box.current; if (b) fit(b.clientWidth, b.clientHeight); }} aria-label={t("player.fitmap")} title={t("player.fitmap")}>⤢</button></div>
        {active && <div className="pcard" onPointerDown={(e) => e.stopPropagation()}><FindingCard f={active} actions={!playing && <button type="button" onClick={() => setPlaying(true)}>{t("coach.continue")}</button>} /></div>}
        <div className="pnote">{t("player.nomap")}</div>
      </div>
      <canvas ref={tline} className="ptimeline" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }} onPointerMove={scrub} aria-label={t("player.timeline")} role="slider" aria-valuemin={0} aria-valuemax={end} aria-valuenow={Math.round(uiT)} />
      <div className="pctl">
        <button type="button" onClick={onClose}>← {t("player.back")}</button>
        <button type="button" onClick={toggle} aria-label={playing ? t("player.pause") : t("player.play")}>{playing ? "⏸" : "▶"}</button>
        <button type="button" onClick={() => seek(uiT - 5)} aria-label="−5 s">⏪</button><button type="button" onClick={() => seek(uiT + 5)} aria-label="+5 s">⏩</button>
        <span className="ptime">{mmss(uiT)} / {mmss(end)}</span>
        <span className="pspeed">{SPEEDS.map((s) => <button type="button" key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}</span>
        <button type="button" onClick={() => jump(-1)} aria-label={t("coach.prev")} title={t("coach.prev")}>⏮</button><button type="button" onClick={() => jump(1)} aria-label={t("coach.next")} title={t("coach.next")}>⏭</button>
        <label><input type="checkbox" checked={coach} onChange={(e) => setCoach(e.target.checked)} /> {t("coach.mode")}</label>
        <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {t("player.follow")}</label>
        <label><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> {t("player.names")}</label>
        <label><input type="checkbox" checked={trails} onChange={(e) => setTrails(e.target.checked)} /> {t("player.trails")}</label>
      </div>
    </div>
  );
}
