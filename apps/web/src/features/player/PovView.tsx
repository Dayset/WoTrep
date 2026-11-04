import { useEffect, useRef } from "react";
import * as THREE from "three";
import { stateAt, type BattleTimeline } from "@wotrep/model";
import { tracerLines, aimAt, heightField, heightAt } from "@wotrep/analysis";
import type { MapBounds } from "../../lib/mapStore";
import { VIEW_ALPHA, VIEW_FOV_DEG, VIEW_RANGE_M, trainerMatch, type TrainerSel } from "./viewConfig";

/** Seeded per-pixel noise (dithering) as a canvas texture: a base colour with a small random spread per pixel. */
function noiseTexture(size: number, base: [number, number, number], spread: number): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d")!, img = g.createImageData(size, size);
  let seed = 987654321; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < size * size; i++) { const d = (rnd() - 0.5) * spread; for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.max(0, Math.min(255, base[k]! + d)); img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const tx = new THREE.CanvasTexture(c); tx.magFilter = THREE.NearestFilter; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; return tx;
}

/** Low-poly 3D view of the replay on flat ground (docs/UX.md §4, simple mode). First person sits at the followed tank, chase view behind it.
 *  Heights and cover are not known yet, so ground is flat and nothing blocks the view. Hull direction is used for the camera (gun aim is not decoded). Shell traces from tracer start to end point show for 1.2 s; names float above tanks. */
export default function PovView({ tl, clock, vid, mode, img, bounds, zoom, lock, resync, trails, trainer }: {
  tl: BattleTimeline; clock: { current: { t: number } }; vid: number; mode: "fp" | "chase"; img: HTMLImageElement | null; bounds: MapBounds; zoom: number; lock: boolean; resync: number; trails: boolean; trainer: { on: boolean; sel: TrainerSel };
}) {
  const host = useRef<HTMLDivElement>(null), look = useRef({ yaw: 0, pitch: 0.28, dist: 16 }), live = useRef({ vid, mode, zoom, lock, trails, trainer }); live.current = { vid, mode, zoom, lock, trails, trainer };
  useEffect(() => { look.current = { yaw: 0, pitch: 0.28, dist: look.current.dist }; }, [resync, lock]);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const css = (n: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;
    const ally = new THREE.Color(css("--accent", "#4aa3ff")), foe = new THREE.Color(css("--enemy", "#ff5a5a"));
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); el.appendChild(renderer.domElement); renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xbcd4e6); scene.fog = new THREE.Fog(0xbcd4e6, 300, 1400);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667766, 1.1)); const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(-200, 400, 150); scene.add(sun);
    const W = bounds.x1 - bounds.x0, D = bounds.z1 - bounds.z0, field = heightField(tl, bounds, 25), gh = (x: number, z: number) => heightAt(field, x, z);
    let hMin = Infinity, hMax = -Infinity; for (const v of field.h) { hMin = Math.min(hMin, v); hMax = Math.max(hMax, v); }
    if (!Number.isFinite(hMin)) { hMin = 0; hMax = 1; }
    const geo = new THREE.BufferGeometry(), nv = field.cols * field.rows, pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), idx: number[] = [];
    for (let r = 0; r < field.rows; r++) for (let c = 0; c < field.cols; c++) {
      const i = r * field.cols + c, x = field.x0 + c * field.cell, z = field.z0 + r * field.cell, y = field.h[i]!, k = (y - hMin) / Math.max(1, hMax - hMin);
      pos.set([x, y, -z], i * 3); uv.set([(x - bounds.x0) / W, (z - bounds.z0) / D], i * 2); col.set([0.27 + 0.10 * k, 0.27 + 0.10 * k, 0.28 + 0.10 * k], i * 3);
      if (r < field.rows - 1 && c < field.cols - 1) idx.push(i, i + 1, i + field.cols, i + 1, i + field.cols + 1, i + field.cols);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    let tex: THREE.Texture | null = null; if (img) { tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; }
    const grain = noiseTexture(128, [72, 72, 74], 46); grain.repeat.set(W / 12, D / 12);
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex ?? grain, vertexColors: !tex, flatShading: true })); scene.add(ground);
    // sky dome: blue dithering that stays with the camera
    const skyTex = noiseTexture(64, [186, 210, 232], 34); skyTex.repeat.set(28, 14);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1; scene.add(sky);
    const hull = new THREE.BoxGeometry(3.2, 1.5, 6.4), tur = new THREE.BoxGeometry(2, 0.9, 2.4), gun = new THREE.BoxGeometry(0.25, 0.25, 3.6);
    const tanks = new Map<number, { g: THREE.Group; mat: THREE.MeshLambertMaterial }>();
    for (const v of tl.vehicles) {
      const mat = new THREE.MeshLambertMaterial({ color: v.team === tl.recorder.team ? ally : foe, flatShading: true, transparent: true }), g = new THREE.Group();
      const h = new THREE.Mesh(hull, mat); h.position.y = 1.1; const tu = new THREE.Mesh(tur, mat); tu.position.set(0, 2.25, 0.3); const gn = new THREE.Mesh(gun, mat); gn.position.set(0, 2.3, -2.2);
      const tg = new THREE.Group(); tg.add(tu, gn); g.add(h, tg); g.visible = false; scene.add(g); tanks.set(v.vid, { g, mat });
    }
    // trainer cones: a pie slice (FOV) and a range ring per vehicle, reshaped each frame around the tank's heading
    const CN = 24, RN = 64, vcones = new Map<number, { fan: THREE.Mesh; fanPos: Float32Array; ring: THREE.LineLoop; ringPos: Float32Array }>();
    const fanIdx: number[] = []; for (let i = 0; i < CN; i++) fanIdx.push(0, i + 1, i + 2);
    for (const v of tl.vehicles) {
      const c = v.team === tl.recorder.team ? ally : foe;
      const fanPos = new Float32Array((CN + 2) * 3), fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.BufferAttribute(fanPos, 3)); fg.setIndex(fanIdx);
      const fan = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: VIEW_ALPHA.value, depthWrite: false, side: THREE.DoubleSide }));
      const ringPos = new Float32Array(RN * 3), rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.BufferAttribute(ringPos, 3));
      const ring = new THREE.LineLoop(rg, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: VIEW_ALPHA.value }));
      fan.visible = ring.visible = false; fan.frustumCulled = ring.frustumCulled = false; fan.renderOrder = 2; scene.add(fan, ring);
      vcones.set(v.vid, { fan, fanPos, ring, ringPos });
    }
    // smoke over destroyed tanks: a few low-poly puffs per tank, rising high and staying visible from far away
    const puffGeo = new THREE.IcosahedronGeometry(1, 0), SMOKE_END_S = 120;
    const deathAt = new Map<number, number>(); for (const e of tl.events) if (e.k === "kill" && e.t >= 0 && !deathAt.has(e.victim)) deathAt.set(e.victim, e.t);
    const smoke = new Map<number, { puffs: THREE.Mesh[]; mat: THREE.MeshLambertMaterial }>();
    for (const v of tl.vehicles) { if (!deathAt.has(v.vid)) continue;
      const mat = new THREE.MeshLambertMaterial({ color: 0x8c8c8c, flatShading: true, transparent: true, opacity: 0, depthWrite: false });
      const puffs = Array.from({ length: 5 }, () => { const m = new THREE.Mesh(puffGeo, mat); m.visible = false; m.frustumCulled = false; scene.add(m); return m; });
      smoke.set(v.vid, { puffs, mat }); }
    const labels: THREE.Sprite[] = [], shots = tracerLines(tl, {}), MAXS = 80;
    for (const v of tl.vehicles) {
      const c = document.createElement("canvas"); c.width = 256; c.height = 64; const g2 = c.getContext("2d")!; g2.font = "bold 34px sans-serif"; g2.textAlign = "center"; g2.fillStyle = "rgba(0,0,0,0.55)"; g2.fillRect(0, 8, 256, 48); g2.fillStyle = v.team === tl.recorder.team ? "#9fd0ff" : "#ffb0b0"; g2.fillText(v.name.slice(0, 14), 128, 46);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true })); sp.scale.set(16, 4, 1); sp.position.y = 6; sp.renderOrder = 5; tanks.get(v.vid)!.g.add(sp); labels.push(sp);
    }
    const tgeo = new THREE.BufferGeometry(), tpos = new Float32Array(MAXS * 6); tgeo.setAttribute("position", new THREE.BufferAttribute(tpos, 3)); tgeo.setDrawRange(0, 0);
    const tlines = new THREE.LineSegments(tgeo, new THREE.LineBasicMaterial({ color: 0xffe066 })); tlines.frustumCulled = false; scene.add(tlines);
    // decoration only (no map data yet): seeded trees, bushes, clouds and far mountains
    let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const deco: THREE.BufferGeometry[] = [], decoMat: THREE.Material[] = [];
    const place = (g: THREE.BufferGeometry, m: THREE.Material, n: number, fn: (o: THREE.Object3D) => void) => { deco.push(g); decoMat.push(m); const im = new THREE.InstancedMesh(g, m, n), o = new THREE.Object3D(); for (let i = 0; i < n; i++) { fn(o); o.updateMatrix(); im.setMatrixAt(i, o.matrix); } scene.add(im); };
    const rx = () => bounds.x0 + rnd() * W, rz = () => -(bounds.z0 + rnd() * D);
    const trunk = new THREE.CylinderGeometry(0.4, 0.5, 3, 5); trunk.translate(0, 1.5, 0); const crown = new THREE.ConeGeometry(2.6, 7, 6); crown.translate(0, 6, 0);
    // trees and bushes: a solid copy and a 70% transparent copy of every instance; the ones close in front of the camera use the transparent copy (they are not real cover)
    type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number };
    const trees: Item[] = Array.from({ length: 220 }, () => { const x = rx(), z = rz(), k = 0.8 + rnd() * 0.7; return { x, y: gh(x, -z), z, sx: k, sy: k, sz: k }; });
    const bushes: Item[] = Array.from({ length: 260 }, () => { const x = rx(), z = rz(); return { x, y: gh(x, -z), z, sx: 0.8 + rnd(), sy: 0.6 + rnd() * 0.6, sz: 0.8 + rnd() }; });
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    const dual: { items: Item[]; solid: THREE.InstancedMesh; ghost: THREE.InstancedMesh; faded: Map<Item, boolean> }[] = [];
    const addDual = (g: THREE.BufferGeometry, color: number, items: Item[]) => {
      deco.push(g); const ms = new THREE.MeshLambertMaterial({ color, flatShading: true }), mg = new THREE.MeshLambertMaterial({ color, flatShading: true, transparent: true, opacity: 0.3, depthWrite: false }); decoMat.push(ms, mg);
      const solid = new THREE.InstancedMesh(g, ms, items.length), ghost = new THREE.InstancedMesh(g, mg, items.length); solid.frustumCulled = false; ghost.frustumCulled = false; ghost.renderOrder = 3; scene.add(solid, ghost);
      items.forEach((it, i) => { M.compose(P.set(it.x, it.y, it.z), Q, S.set(it.sx, it.sy, it.sz)); solid.setMatrixAt(i, M); ghost.setMatrixAt(i, ZERO); }); dual.push({ items, solid, ghost, faded: new Map() });
    };
    addDual(trunk, 0x6b4a2b, trees); addDual(crown, 0x2f6b34, trees);
    const bush = new THREE.IcosahedronGeometry(1.4, 0); bush.translate(0, 0.9, 0); addDual(bush, 0x3f7a3c, bushes);
    const updateFade = (camPos: THREE.Vector3, fwd: THREE.Vector3, halfFovH: number) => {
      const fl = Math.hypot(fwd.x, fwd.z) || 1, fx = fwd.x / fl, fz = fwd.z / fl, cosMax = Math.cos(halfFovH + 0.17);
      for (const d of dual) { let changed = false;
        d.items.forEach((it, i) => { const dx = it.x - camPos.x, dz = it.z - camPos.z, dist = Math.hypot(dx, dz), f = dist < 170 && dist > 0.5 && (dx * fx + dz * fz) / dist > cosMax; if (d.faded.get(it) === f && d.faded.has(it)) return; d.faded.set(it, f); changed = true; M.compose(P.set(it.x, it.y, it.z), Q, S.set(it.sx, it.sy, it.sz)); d.solid.setMatrixAt(i, f ? ZERO : M); d.ghost.setMatrixAt(i, f ? M : ZERO); });
        if (changed) { d.solid.instanceMatrix.needsUpdate = true; d.ghost.instanceMatrix.needsUpdate = true; } }
    };
    const cloud = new THREE.IcosahedronGeometry(1, 1);
    place(cloud, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false }), 28, (o) => { o.position.set(bounds.x0 - 400 + rnd() * (W + 800), hMax + 160 + rnd() * 120, -(bounds.z0 - 400 + rnd() * (D + 800))); o.scale.set(40 + rnd() * 60, 10 + rnd() * 8, 25 + rnd() * 30); });
    const mount = new THREE.ConeGeometry(1, 1, 5);
    place(mount, new THREE.MeshLambertMaterial({ color: 0x6f7f95, flatShading: true, fog: false }), 26, (o) => { const a = rnd() * Math.PI * 2, R = Math.max(W, D) * (0.95 + rnd() * 0.5), h = 120 + rnd() * 220; o.position.set((bounds.x0 + bounds.x1) / 2 + Math.cos(a) * R, hMin + h / 2 - 5, -(bounds.z0 + bounds.z1) / 2 + Math.sin(a) * R); o.scale.set(h * 1.6, h, h * 1.6); });
    // track marks: a flat ribbon behind every tank we have seen, only along stretches where it was visible
    const TRAIL_S = 25, PTS = 60, QMAX = tl.vehicles.length * PTS, tpos2 = new Float32Array(QMAX * 4 * 3), tcol2 = new Float32Array(QMAX * 4 * 4), tidx = new Uint32Array(QMAX * 6);
    for (let q = 0; q < QMAX; q++) tidx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
    const rgeo = new THREE.BufferGeometry(); rgeo.setAttribute("position", new THREE.BufferAttribute(tpos2, 3)); rgeo.setAttribute("color", new THREE.BufferAttribute(tcol2, 4)); rgeo.setIndex(new THREE.BufferAttribute(tidx, 1)); rgeo.setDrawRange(0, 0);
    const ribbon = new THREE.Mesh(rgeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide })); ribbon.frustumCulled = false; ribbon.renderOrder = 2; scene.add(ribbon);
    const visAt = (tr: { visible: [number, number][] }, tt: number) => tr.visible.some(([a, b]) => tt >= a && tt <= b);
    const cam = new THREE.PerspectiveCamera(65, 1, 0.5, 4000);
    const size = () => { const w = el.clientWidth || 640, h = el.clientHeight || 360; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    const dom = renderer.domElement, ptr = new Map<number, { x: number; y: number }>(); let pinch = 0; dom.style.touchAction = "none"; dom.style.cursor = "grab";
    const down = (e: PointerEvent) => { if (live.current.lock) return; dom.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y); } };
    const move = (e: PointerEvent) => { const q = ptr.get(e.pointerId); if (!q) return; const L = look.current;
      if (ptr.size === 2) { ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); const [a, b] = [...ptr.values()]; const d = Math.hypot(a!.x - b!.x, a!.y - b!.y); if (pinch > 0) L.dist = Math.min(120, Math.max(5, L.dist * (pinch / d))); pinch = d; return; }
      L.yaw -= (e.clientX - q.x) * 0.006; L.pitch = Math.min(1.45, Math.max(-0.35, L.pitch + (e.clientY - q.y) * 0.005)); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); };
    const up = (e: PointerEvent) => { ptr.delete(e.pointerId); pinch = 0; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); look.current.dist = Math.min(120, Math.max(5, look.current.dist * (e.deltaY > 0 ? 1.12 : 0.89))); };
    const reset = () => { look.current = { yaw: 0, pitch: 0.28, dist: look.current.dist }; };
    dom.addEventListener("pointerdown", down); dom.addEventListener("pointermove", move); dom.addEventListener("pointerup", up); dom.addEventListener("pointercancel", up); dom.addEventListener("wheel", wheel, { passive: false }); dom.addEventListener("dblclick", reset);
    size(); const ro = new ResizeObserver(size); ro.observe(el);
    let pitchNow = 0, raf = 0, lastMs = performance.now(), lastT = clock.current.t; const smY = new Map<number, { h: number; g: number }>(); const TAU = Math.PI * 2, wrap = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    const loop = () => {
      raf = requestAnimationFrame(loop); const nowMs = performance.now(), dtS = Math.min(0.25, (nowMs - lastMs) / 1000); lastMs = nowMs; const jump = Math.abs(clock.current.t - lastT) > 1.2; lastT = clock.current.t; const kS = 1 - Math.exp(-dtS / 0.16);   // rotation is smoothed over ~0.16 s; seeks snap let turretYaw = 0, turretPitch = 0, onTarget = false; const L = live.current, s = stateAt(tl, clock.current.t), me = s.units.find((u) => u.vid === L.vid);
      let turretYaw = 0, turretPitch = 0, onTarget = false, hullYawS = 0; const L = live.current, s = stateAt(tl, clock.current.t), me = s.units.find((u) => u.vid === L.vid);
      const hit = new Set<number>(); for (const e of tl.events) if (e.k === "damage" && e.target === L.vid && e.t <= clock.current.t && e.t >= clock.current.t - 4) hit.add(e.attacker);
      for (const u of s.units) {
        const k = tanks.get(u.vid)!; k.g.visible = u.known !== "never" && !(L.mode === "fp" && u.vid === L.vid && u.alive);
        k.g.position.set(u.x, gh(u.x, u.z), -u.z); const aim0 = u.alive ? aimAt(tl, u.vid, clock.current.t) : null, sm = smY.get(u.vid) ?? { h: u.yaw, g: aim0 ? aim0.yaw : u.yaw }; if (jump || !smY.has(u.vid)) { sm.h = u.yaw; sm.g = aim0 ? aim0.yaw : u.yaw; } else { sm.h += wrap(u.yaw - sm.h) * kS; sm.g += wrap((aim0 ? aim0.yaw : u.yaw) - sm.g) * kS; } smY.set(u.vid, sm); k.g.rotation.y = -sm.h; k.mat.opacity = !u.alive ? 0.5 : u.known === "ghost" ? 0.3 : 1;
        k.mat.color.copy(!u.alive ? new THREE.Color(0x444444) : hit.has(u.vid) ? new THREE.Color(0xffd23f) : u.team === tl.recorder.team ? ally : foe);
        { const cn = vcones.get(u.vid)!, show = L.trainer.on && u.known === "live" && u.alive && trainerMatch(L.trainer.sel, u.vid, u.team, tl.recorder.team);
          cn.fan.visible = cn.ring.visible = show;
          if (show) {
            const R = VIEW_RANGE_M.value, half = (VIEW_FOV_DEG.value * Math.PI) / 360;
            // heading convention as in the 2D view: a point at angle a sits at (x + R sin a, z - R cos a); 3D z is -z
            const pt = (a: number, r: number, out: Float32Array, at: number) => { const px = u.x + r * Math.sin(a), pz = u.z - r * Math.cos(a); out[at] = px; out[at + 1] = gh(px, pz) + 0.4; out[at + 2] = -pz; };
            pt(0, 0, cn.fanPos, 0); cn.fanPos[0] = u.x; cn.fanPos[1] = gh(u.x, u.z) + 0.4; cn.fanPos[2] = -u.z;
            for (let i = 0; i <= CN; i++) pt(u.yaw - half + (2 * half * i) / CN, R, cn.fanPos, (i + 1) * 3);
            for (let j = 0; j < RN; j++) pt((2 * Math.PI * j) / RN, R, cn.ringPos, j * 3);
            (cn.fan.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
            (cn.ring.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
          } }
        { const sk = smoke.get(u.vid), dth = deathAt.get(u.vid);
          if (sk) { const age = dth != null ? clock.current.t - dth : -1, on = age >= 0 && age < SMOKE_END_S;
            sk.puffs.forEach((p) => { p.visible = on; });
            if (on) { sk.mat.opacity = 0.8 * Math.max(0, 1 - Math.max(0, age - 60) / 60);
              const rise = Math.min(age, 90) * 3.5, base = gh(u.x, u.z) + 6;
              sk.puffs.forEach((p, j) => { const a = age * 0.25 + j * 1.3, sway = 4 + age * 0.08;
                p.position.set(u.x + Math.sin(a) * sway, base + rise - j * 5, -u.z + Math.cos(a) * sway);
                p.scale.setScalar(Math.min(45, 7 + age * 0.35 + j * 2.5)); p.rotation.set(a, a * 0.7, 0); }); } } }
        k.g.scale.y = u.alive ? 1 : 0.5; k.g.children[2]!.visible = u.vid !== L.vid; const aim = aim0; (k.g.children[1] as THREE.Group).rotation.y = aim ? sm.h - sm.g : 0; if (u.vid === L.vid) { turretYaw = sm.g; hullYawS = sm.h; onTarget = !!aim?.onTarget; turretPitch = aim ? aim.pitch : 0; }
      }
      let n = 0; for (const sh of shots) { if (sh.t > clock.current.t) break; if (sh.t < clock.current.t - 1.2 || n >= MAXS) continue; tpos.set([sh.x0, (sh.y0 ?? gh(sh.x0, sh.z0)) + 2.6, -sh.z0, sh.x1, (sh.y1 ?? gh(sh.x1, sh.z1)) + 0.6, -sh.z1], n * 6); n++; }
      tgeo.setDrawRange(0, n * 2); (tgeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      if (me && me.known !== "never") {
        const p = new THREE.Vector3(me.x, gh(me.x, me.z), -me.z), K = look.current, ay = -(L.mode === "fp" ? turretYaw : hullYawS) + K.yaw, cp = Math.cos(K.pitch);
        pitchNow += (turretPitch - pitchNow) * 0.15;
        sky.position.copy(cam.position);
        if (L.mode === "fp") { cam.position.set(p.x, p.y + 2.9, p.z); cam.lookAt(p.x - Math.sin(ay) * 50, p.y + 2.9 + Math.tan(pitchNow) * 50 - (K.pitch - 0.28) * 50, p.z - Math.cos(ay) * 50); }
        else { const cx = p.x + Math.sin(ay) * cp * K.dist, cz = p.z + Math.cos(ay) * cp * K.dist; cam.position.set(cx, Math.max(gh(cx, -cz) + 1.2, p.y + 1.5 + Math.sin(K.pitch) * K.dist), cz); cam.lookAt(p.x, p.y + 2, p.z); }
      }
      { const dir = new THREE.Vector3(); cam.getWorldDirection(dir); updateFade(cam.position, dir, Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect)); }
      { let q = 0; const T = clock.current.t;
        if (L.trails) for (const v of tl.vehicles) {
          const tr = tl.tracks[v.vid]; if (!tr || !tr.t.length) continue; const mine = v.team === tl.recorder.team, rgb = mine ? ally : foe;
          let hi = 0; { let lo = 0, up = tr.t.length - 1; while (lo < up) { const m = (lo + up + 1) >> 1; if (tr.t[m]! <= T) lo = m; else up = m - 1; } hi = lo; }
          let prev: { x: number; z: number; t: number } | null = null, nx = 0, nz = 0;
          for (let i = hi, got = 0; i >= 0 && got < PTS && tr.t[i]! >= T - TRAIL_S && q < QMAX; i -= 1) {
            const tt = tr.t[i]!; if (prev && prev.t - tt < 0.3) continue; if (!visAt(tr, tt)) { prev = null; continue; }
            const x = tr.x[i]!, z = tr.z[i]!;
            if (prev) { const dx = x - prev.x, dz = z - prev.z, len = Math.hypot(dx, dz); if (prev.t - tt > 1.5 || len > 30 || len < 0.2) { prev = len > 30 || prev.t - tt > 1.5 ? null : prev; if (!prev) { prev = { x, z, t: tt }; } continue; }
              nx = -dz / len * 0.4; nz = dx / len * 0.4; const a0 = 0.25, a1 = 0.25, y0 = gh(prev.x, prev.z) + 0.2, y1 = gh(x, z) + 0.2, o = q * 12, c = q * 16;
              tpos2.set([prev.x - nx, y0, -(prev.z - nz), prev.x + nx, y0, -(prev.z + nz), x - nx, y1, -(z - nz), x + nx, y1, -(z + nz)], o);
              tcol2.set([rgb.r, rgb.g, rgb.b, a0, rgb.r, rgb.g, rgb.b, a0, rgb.r, rgb.g, rgb.b, a1, rgb.r, rgb.g, rgb.b, a1], c); q++; got++; }
            prev = { x, z, t: tt };
          }
        }
        rgeo.setDrawRange(0, q * 6); (rgeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true; (rgeo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true; }
      { const k = cam.fov / 65; labels.forEach((l, i) => { const g = tanks.get(tl.vehicles[i]!.vid)!.g, d = cam.position.distanceTo(g.position), m = Math.min(1.4, Math.max(0.3, d / 90)); l.scale.set(16 * k * m, 4 * k * m, 1); }); }
      const wantFov = L.mode === "fp" && L.zoom > 1 && onTarget ? (2 * Math.atan(Math.tan((65 * Math.PI) / 360) / L.zoom) * 180) / Math.PI : 65;
      if (Math.abs(cam.fov - wantFov) > 0.05) { cam.fov += (wantFov - cam.fov) * 0.18; cam.updateProjectionMatrix(); }
      renderer.render(scene, cam);
    }; loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); rgeo.dispose(); (ribbon.material as THREE.Material).dispose(); dom.removeEventListener("pointerdown", down); dom.removeEventListener("pointermove", move); dom.removeEventListener("pointerup", up); dom.removeEventListener("pointercancel", up); dom.removeEventListener("wheel", wheel); dom.removeEventListener("dblclick", reset); for (const g of deco) g.dispose(); for (const m of decoMat) m.dispose(); renderer.dispose(); tgeo.dispose(); for (const l of labels) { (l.material as THREE.SpriteMaterial).map?.dispose(); l.material.dispose(); } geo.dispose(); hull.dispose(); tur.dispose(); gun.dispose(); tex?.dispose(); for (const k of tanks.values()) k.mat.dispose(); el.removeChild(renderer.domElement); };
  }, [tl, img, bounds, clock]);
  return <div ref={host} className="povhost" data-testid="pov" data-mode={mode} />;
}
