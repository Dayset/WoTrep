import { useEffect, useRef } from "react";
import * as THREE from "three";
import { stateAt, type BattleTimeline } from "@wotrep/model";
import { tracerLines, aimAt, heightField, heightAt, estimateReload, reloadProgress, shotTimes, REAL_HEIGHT_CELL_M, solidFootprints, sightBlockers, buildBlockerIndex, type RealSource, type ReloadEstimate, type Obstacles } from "@wotrep/analysis";
import type { MapBounds } from "../../lib/mapStore";
import { VIEW_ALPHA, VIEW_FOV_DEG, VIEW_RANGE_M, PROXIMITY_SPOT_M, ghostThreats, trainerMatch, type LosContext, type TrainerSel } from "./viewConfig";

/** Seeded per-pixel noise (dithering) as a canvas texture: a base colour with a small random spread per pixel. */
function noiseTexture(size: number, base: [number, number, number], spread: number): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d")!, img = g.createImageData(size, size);
  let seed = 987654321; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < size * size; i++) { const d = (rnd() - 0.5) * spread; for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.max(0, Math.min(255, base[k]! + d)); img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const tx = new THREE.CanvasTexture(c); tx.magFilter = THREE.NearestFilter; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; return tx;
}

/** Low-poly 3D view of the replay over the terrain (docs/UX.md §4, simple mode). First person sits at the followed tank, chase view behind it.
 *  Ground follows the height field (estimated from tank tracks, or real game heights when the player loaded them for this map);
 *  buildings and rocks are extruded from the map's obstacles file when loaded, trees use real SpTr positions (seeded decoration
 *  only as the fallback). The sight fans still do not check cover in 3D — the 2D trainer cones do. Hull direction is used for the camera (gun aim is not decoded). Shell traces from tracer start to end point show for 1.2 s; names float above tanks. */
export default function PovView({ tl, clock, vid, mode, img, bounds, zoom, lock, resync, trails, trainer, reload, real, obstacles }: {
  tl: BattleTimeline; clock: { current: { t: number } }; vid: number; mode: "fp" | "chase"; img: HTMLImageElement | null; bounds: MapBounds; zoom: number; lock: boolean; resync: number; trails: boolean; trainer: { on: boolean; sel: TrainerSel }; reload: boolean; real?: RealSource; obstacles?: Obstacles;
}) {
  const host = useRef<HTMLDivElement>(null), look = useRef({ yaw: 0, pitch: 0.28, dist: 16 }), live = useRef({ vid, mode, zoom, lock, trails, trainer, reload }); live.current = { vid, mode, zoom, lock, trails, trainer, reload };
  useEffect(() => { look.current = { yaw: 0, pitch: 0.28, dist: look.current.dist }; }, [resync, lock]);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const css = (n: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;
    const ally = new THREE.Color(css("--accent", "#4aa3ff")), foe = new THREE.Color(css("--enemy", "#ff5a5a"));
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); el.appendChild(renderer.domElement); renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xbcd4e6); scene.fog = new THREE.Fog(0xbcd4e6, 300, 1400);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667766, 1.1)); const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(-200, 400, 150); scene.add(sun);
    const W = bounds.x1 - bounds.x0, D = bounds.z1 - bounds.z0, field = heightField(tl, bounds, real ? REAL_HEIGHT_CELL_M : 25, real), gh = (x: number, z: number) => heightAt(field, x, z);
    // Line of sight for the threat rings: the same field the ground mesh uses plus the sight
    // blockers, built once per scene (not per frame). Null without obstacles — the threats
    // then stay range-only, as before. `obstacles` arrives already outland-filtered from the Player.
    const losBlockers = obstacles ? sightBlockers(obstacles) : null;
    const losCtx: LosContext | null = losBlockers ? { field, blockers: losBlockers, index: buildBlockerIndex(losBlockers) } : null;
    let hMin = Infinity, hMax = -Infinity; for (const v of field.h) { hMin = Math.min(hMin, v); hMax = Math.max(hMax, v); }
    if (!Number.isFinite(hMin)) { hMin = 0; hMax = 1; }
    const geo = new THREE.BufferGeometry(), nv = field.cols * field.rows, pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), idx: number[] = [];
    for (let r = 0; r < field.rows; r++) for (let c = 0; c < field.cols; c++) {
      const i = r * field.cols + c, x = field.x0 + c * field.cell, z = field.z0 + r * field.cell, y = field.h[i]!, k = (y - hMin) / Math.max(1, hMax - hMin);
      pos.set([x, y, -z], i * 3); uv.set([(x - bounds.x0) / W, (z - bounds.z0) / D], i * 2); col.set([0.75 * (0.33 + 0.30 * k) + 0.25 * (0.29 + 0.02 * k), 0.75 * (0.55 + 0.08 * k) + 0.25 * (0.29 + 0.02 * k), 0.75 * (0.30 + 0.12 * k) + 0.25 * (0.30 + 0.02 * k)], i * 3); // earlier earth tones, halfway back
      if (r < field.rows - 1 && c < field.cols - 1) idx.push(i, i + 1, i + field.cols, i + 1, i + field.cols + 1, i + field.cols);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    let tex: THREE.Texture | null = null; if (img) { tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; }
    const grain = noiseTexture(128, [74, 74, 76], 16); grain.repeat.set(W / 6, D / 6);
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
    // reach spheres: a wireframe bubble around a vanished tank's last known spot, radius = Unit.reachM.
    // Same rule as the 2D dotted circle: alive ghosts only, fades with the ghost over 30 s, gone on reappearance.
    // The fragment shader discards the wireframe within PROXIMITY_SPOT_M of any living friendly (proximity
    // spotting) and in the shadow behind each bubble — ground the ghost could only have reached by driving
    // through the bubble (straight line from the vanish point, uCenter, crosses it). Friend positions are
    // ground-plane (x, -z), shared across all sphere materials and refilled every frame; the vanish point
    // is per sphere.
    const SPHERE_FADE_S = 30, sphereGeo = new THREE.SphereGeometry(1, 24, 16);
    const friendPos = new Float32Array(15 * 2), friendUniform = { value: friendPos };
    const spheres = new Map<number, { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }>();
    for (const v of tl.vehicles) {
      const mat = new THREE.ShaderMaterial({
        wireframe: true, transparent: true, depthWrite: false,
        uniforms: {
          uFriends: friendUniform,
          uCount: { value: 0 },
          uCenter: { value: new THREE.Vector2() },
          uColor: { value: (v.team === tl.recorder.team ? ally : foe).clone() },
          uOpacity: { value: 0 },
        },
        vertexShader: "varying vec3 vWorld; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }",
        fragmentShader: `varying vec3 vWorld; uniform vec2 uFriends[15]; uniform int uCount; uniform vec2 uCenter; uniform vec3 uColor; uniform float uOpacity;
          void main() { for (int i = 0; i < 15; i++) { if (i >= uCount) break;
            vec2 fp = vWorld.xz - uFriends[i]; if (dot(fp, fp) < ${(PROXIMITY_SPOT_M.value ** 2).toFixed(1)}) discard;
            vec2 f = uCenter - uFriends[i]; if (dot(f, f) <= ${(PROXIMITY_SPOT_M.value ** 2).toFixed(1)}) continue;
            vec2 d = vWorld.xz - uCenter; float a = dot(d, d);
            if (a > 0.0) { float b = 2.0 * dot(f, d); float cc = dot(f, f) - ${(PROXIMITY_SPOT_M.value ** 2).toFixed(1)}; float disc = b*b - 4.0*a*cc;
              if (disc > 0.0) { float t = (-b - sqrt(disc)) / (2.0*a); if (t > 0.0 && t < 1.0) discard; } }
          } gl_FragColor = vec4(uColor, uOpacity); }`,
      });
      const mesh = new THREE.Mesh(sphereGeo, mat); mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 2; scene.add(mesh);
      spheres.set(v.vid, { mesh, mat });
    }
    // threat rings: a flat red ring on the ground under every living friendly an enemy ghost could
    // shoot, now or within its 30 s window. One shared geometry, one material per tank (opacity
    // varies per frame with the ghost's fade). No seconds label in 3D — the 2D player carries it.
    const ringGeo = new THREE.RingGeometry(6, 8, 32);
    const rings = new Map<number, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }>();
    for (const v of tl.vehicles) {
      const mat = new THREE.MeshBasicMaterial({ color: foe, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(ringGeo, mat); mesh.rotation.x = -Math.PI / 2; mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 2; scene.add(mesh);
      rings.set(v.vid, { mesh, mat });
    }
    // smoke over destroyed tanks: a few low-poly puffs per tank, rising high and staying visible from far away
    const puffGeo = new THREE.IcosahedronGeometry(1, 0), SMOKE_END_S = 120;
    const deathAt = new Map<number, number>(); for (const e of tl.events) if (e.k === "kill" && e.t >= 0 && !deathAt.has(e.victim)) deathAt.set(e.victim, e.t);
    const smoke = new Map<number, { puffs: THREE.Mesh[]; mat: THREE.MeshLambertMaterial }>();
    for (const v of tl.vehicles) { if (!deathAt.has(v.vid)) continue;
      const mat = new THREE.MeshLambertMaterial({ color: 0x8c8c8c, flatShading: true, transparent: true, opacity: 0, depthWrite: false });
      const puffs = Array.from({ length: 5 }, () => { const m = new THREE.Mesh(puffGeo, mat); m.visible = false; m.frustumCulled = false; scene.add(m); return m; });
      smoke.set(v.vid, { puffs, mat }); }
    // reload spinners: a camera-facing arc above each reloading tank, sweeping as the averaged reload runs out
    const spinTimes = new Map<number, number[]>(), spinEst = new Map<number, ReloadEstimate>(), SPIN_N = 24, SPIN_R = 2.2;
    const spins = new Map<number, { line: THREE.Line; pos: Float32Array; geo: THREE.BufferGeometry }>();
    for (const v of tl.vehicles) {
      const ts = shotTimes(tl, v.vid); spinTimes.set(v.vid, ts); spinEst.set(v.vid, estimateReload(ts));
      const pos = new Float32Array((SPIN_N + 1) * 3), geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setDrawRange(0, SPIN_N + 1);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, fog: false, depthTest: false, transparent: true, opacity: 0.9 })); line.visible = false; line.frustumCulled = false; line.renderOrder = 9; scene.add(line);
      spins.set(v.vid, { line, pos, geo });
    }
    const labels: THREE.Sprite[] = [], shots = tracerLines(tl, {}), MAXS = 80;
    for (const v of tl.vehicles) {
      const c = document.createElement("canvas"); c.width = 256; c.height = 64; const g2 = c.getContext("2d")!; g2.font = "bold 34px sans-serif"; g2.textAlign = "center"; g2.fillStyle = "rgba(0,0,0,0.55)"; g2.fillRect(0, 8, 256, 48); g2.fillStyle = v.team === tl.recorder.team ? "#9fd0ff" : "#ffb0b0"; g2.fillText(v.name.slice(0, 14), 128, 46);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true })); sp.scale.set(16, 4, 1); sp.position.y = 6; sp.renderOrder = 5; tanks.get(v.vid)!.g.add(sp); labels.push(sp);
    }
    // shot tracers: a thin flat ribbon per shot (not a 1 px line), bright and fading over TRACER_S
    const TRACER_S = 1.2, TRACER_HALF = 0.35, TRACER_NEAR_M = 5, GUN_LEN_M = 4;
    const tgeo = new THREE.BufferGeometry(), tpos = new Float32Array(MAXS * 18), tcolT = new Float32Array(MAXS * 18);
    tgeo.setAttribute("position", new THREE.BufferAttribute(tpos, 3)); tgeo.setAttribute("color", new THREE.BufferAttribute(tcolT, 3)); tgeo.setDrawRange(0, 0);
    const tlines = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false }));
    tlines.frustumCulled = false; tlines.renderOrder = 10; scene.add(tlines);
    // trees and bushes: real SpTr positions when the player loaded obstacles for this map, seeded
    // decoration only as the fallback (the seeded trees stood where the game has no trees — that was
    // the "bumps in the middle" Dayset saw). Bushes and shrubs are the srt names with bush/shrub in
    // them; everything else in trees[] is a tree. The y is the game's own placement height, which
    // sits on the real terrain to a median -0.02 m (verified 2026-11-05).
    let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const deco: THREE.BufferGeometry[] = [], decoMat: THREE.Material[] = [];
    const place = (g: THREE.BufferGeometry, m: THREE.Material, n: number, fn: (o: THREE.Object3D) => void) => { deco.push(g); decoMat.push(m); const im = new THREE.InstancedMesh(g, m, n), o = new THREE.Object3D(); for (let i = 0; i < n; i++) { fn(o); o.updateMatrix(); im.setMatrixAt(i, o.matrix); } scene.add(im); };
    const rx = () => bounds.x0 + rnd() * W, rz = () => -(bounds.z0 + rnd() * D);
    const trunk = new THREE.CylinderGeometry(0.4, 0.5, 3, 5); trunk.translate(0, 1.5, 0); const crown = new THREE.ConeGeometry(2.6, 7, 6); crown.translate(0, 6, 0);
    // trees and bushes: a solid copy and a 70% transparent copy of every instance; the ones close in front of the camera use the transparent copy (they are not real cover)
    type Item = { x: number; y: number; z: number; sx: number; sy: number; sz: number };
    const isBush = (srt: string) => /bush|shrub/i.test(srt);
    const realItem = (tr: { pos: [number, number, number]; scale: number }): Item => ({ x: tr.pos[0], y: tr.pos[1], z: -tr.pos[2], sx: tr.scale, sy: tr.scale, sz: tr.scale });
    const trees: Item[] = obstacles ? obstacles.trees.filter((tr) => !isBush(tr.srt)).map(realItem) : Array.from({ length: 220 }, () => { const x = rx(), z = rz(), k = 0.8 + rnd() * 0.7; return { x, y: gh(x, -z), z, sx: k, sy: k, sz: k }; });
    const bushes: Item[] = obstacles ? obstacles.trees.filter((tr) => isBush(tr.srt)).map(realItem) : Array.from({ length: 9000 }, () => { const x = rx(), z = rz(); return { x, y: gh(x, -z), z, sx: 0.8 + rnd(), sy: 0.6 + rnd() * 0.6, sz: 0.8 + rnd() }; });
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    const dual: { items: Item[]; solid: THREE.InstancedMesh; ghost: THREE.InstancedMesh; faded: Map<Item, boolean> }[] = [];
    const addDual = (g: THREE.BufferGeometry, color: number, items: Item[]) => {
      deco.push(g); const ms = new THREE.MeshLambertMaterial({ color, flatShading: true }), mg = new THREE.MeshLambertMaterial({ color, flatShading: true, transparent: true, opacity: 0.3, depthWrite: false }); decoMat.push(ms, mg);
      const solid = new THREE.InstancedMesh(g, ms, items.length), ghost = new THREE.InstancedMesh(g, mg, items.length); solid.frustumCulled = false; ghost.frustumCulled = false; ghost.renderOrder = 3; scene.add(solid, ghost);
      items.forEach((it, i) => { M.compose(P.set(it.x, it.y, it.z), Q, S.set(it.sx, it.sy, it.sz)); solid.setMatrixAt(i, M); ghost.setMatrixAt(i, ZERO); }); dual.push({ items, solid, ghost, faded: new Map() });
    };
    addDual(trunk, 0x6b4a2b, trees); addDual(crown, 0x2f6b34, trees);
    // bushes: two crossed low vertical quads, light green at 5% opacity, scattered across the map
    const cross = (() => { const a = new THREE.PlaneGeometry(2.4, 1.2); a.translate(0, 0.6, 0); const b = a.clone(); b.rotateY(Math.PI / 2);
      const g = new THREE.BufferGeometry(), pa = a.attributes.position!.array as Float32Array, pb = b.attributes.position!.array as Float32Array, ia = a.index!.array, ib = b.index!.array, n = pa.length / 3;
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([...pa, ...pb]), 3)); g.setIndex([...Array.from(ia), ...Array.from(ib, (i) => i + n)]); return g; })();
    const bushMat = new THREE.MeshBasicMaterial({ color: 0x9ccc6e, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false });
    const bushIm = new THREE.InstancedMesh(cross, bushMat, bushes.length), bo = new THREE.Object3D();
    bushes.forEach((b, i) => { bo.position.set(b.x, b.y, b.z); bo.rotation.set(0, rnd() * Math.PI, 0); bo.scale.set(b.sx * 1.4, b.sy * 0.7, b.sz * 1.4); bo.updateMatrix(); bushIm.setMatrixAt(i, bo.matrix); });
    bushIm.frustumCulled = false; scene.add(bushIm); deco.push(cross); decoMat.push(bushMat);
    // obstacles: solid footprints (static, hull > 1 m) extruded to boxes, one InstancedMesh, coloured
    // by kind. The box is the collision AABB — an upper bound on the solid object, so a rock cluster's
    // box covers the gaps between the rocks and a cliff face's box covers the air in front of the
    // slope (verified 2026-11-05). Rocks are NOT extruded: their AABBs are enormous (cliff faces
    // up to ~30 m tall) and cover drivable ground at the cliff base, so a tank driving there
    // renders inside the slab (seen 2026-11-05 at 4:26, RockCliffs boxes y 21-59 over a tank at
    // y 27.8). The cliffs are already in the terrain mesh, and rocks still draw as footprints on
    // the 2D map and still block sight — this is rendering only, not the LOS model. Base is the
    // footprint's lowest corner, top is height_m (the highest transformed AABB corner, absolute
    // world y). Tall fragile models (a 30 m basilica) block sight but are NOT extruded here — that
    // is the solid-footprints set, not the sight set.
    const solids = obstacles ? solidFootprints(obstacles).filter((p) => p.kind !== "rock") : [];
    if (solids.length) {
      const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
      const boxMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
      const boxes = new THREE.InstancedMesh(boxGeo, boxMat, solids.length);
      const boxColors: Record<string, number> = { building: 0xa07850, rock: 0x8c8c8c, fence: 0xb4a06e, tree: 0x2f6b34, prop: 0x9a9a9a, other: 0x9a9a9a };
      const bq = new THREE.Quaternion(), beu = new THREE.Euler(), bpos = new THREE.Vector3(), bsc = new THREE.Vector3(), bm = new THREE.Matrix4(), bcol = new THREE.Color();
      let bi = 0;
      for (const p of solids) {
        const fp = p.footprint!, baseY = p.baseY ?? p.pos[1], top = p.heightM ?? p.pos[1] + 5, h = top - baseY;
        if (h <= 0) continue;
        const cx = (fp[0][0] + fp[1][0] + fp[2][0] + fp[3][0]) / 4, cz = (fp[0][1] + fp[1][1] + fp[2][1] + fp[3][1]) / 4;
        const e1x = fp[1][0] - fp[0][0], e1z = fp[1][1] - fp[0][1], e2x = fp[3][0] - fp[0][0], e2z = fp[3][1] - fp[0][1];
        const w = Math.hypot(e1x, e1z), d = Math.hypot(e2x, e2z);
        if (w <= 0 || d <= 0) continue;
        beu.set(0, Math.atan2(e1z, e1x), 0); bq.setFromEuler(beu);
        bm.compose(bpos.set(cx, baseY, -cz), bq, bsc.set(w, h, d));
        boxes.setMatrixAt(bi, bm);
        boxes.setColorAt(bi, bcol.setHex(boxColors[p.kind] ?? 0x9a9a9a));
        bi++;
      }
      boxes.count = bi;
      boxes.frustumCulled = false; scene.add(boxes); deco.push(boxGeo); decoMat.push(boxMat);
    }
    // water: one flat translucent plane per body at its surface height over its rectangle
    for (const w of obstacles?.water ?? []) {
      const wgeo = new THREE.PlaneGeometry(w.rect[1][0] - w.rect[0][0], w.rect[1][1] - w.rect[0][1]);
      const wmat = new THREE.MeshBasicMaterial({ color: 0x4682b4, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
      const wmesh = new THREE.Mesh(wgeo, wmat);
      wmesh.rotation.x = -Math.PI / 2;
      wmesh.position.set((w.rect[0][0] + w.rect[1][0]) / 2, w.surfaceY, -(w.rect[0][1] + w.rect[1][1]) / 2);
      scene.add(wmesh); deco.push(wgeo); decoMat.push(wmat);
    }
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
      let nFriends = 0; for (const o of s.units) if (o.team === tl.recorder.team && o.alive && o.known === "live" && nFriends < 15) { friendPos[nFriends * 2] = o.x; friendPos[nFriends * 2 + 1] = -o.z; nFriends++; }
      const threats = ghostThreats(s.units.filter((u) => u.known === "ghost"), s.units, tl.recorder.team, losCtx);
      for (const u of s.units) {
        const k = tanks.get(u.vid)!; k.g.visible = u.known !== "never" && !(L.mode === "fp" && u.vid === L.vid && u.alive);
        k.g.position.set(u.x, gh(u.x, u.z), -u.z); const aim0 = u.alive ? aimAt(tl, u.vid, clock.current.t) : null, sm = smY.get(u.vid) ?? { h: u.yaw, g: aim0 ? aim0.yaw : u.yaw }; if (jump || !smY.has(u.vid)) { sm.h = u.yaw; sm.g = aim0 ? aim0.yaw : u.yaw; } else { sm.h += wrap(u.yaw - sm.h) * kS; sm.g += wrap((aim0 ? aim0.yaw : u.yaw) - sm.g) * kS; } smY.set(u.vid, sm); k.g.rotation.y = -sm.h; k.mat.opacity = !u.alive ? 0.5 : u.known === "ghost" ? 0.3 : 1;
        { const sp = spheres.get(u.vid)!, show = u.alive && u.known === "ghost" && !!u.reachM && (u.ageS ?? 0) < SPHERE_FADE_S;
          sp.mesh.visible = show;
          if (show) { sp.mesh.position.set(u.x, gh(u.x, u.z) + 1.5, -u.z); sp.mesh.scale.setScalar(u.reachM!); sp.mat.uniforms.uCount!.value = u.team === tl.recorder.team ? 0 : nFriends; sp.mat.uniforms.uCenter!.value.set(u.x, -u.z); sp.mat.uniforms.uOpacity!.value = 0.3 * (1 - (u.ageS ?? 0) / SPHERE_FADE_S); } }
        { const rg = rings.get(u.vid)!, th = threats.get(u.vid);
          rg.mesh.visible = !!th && u.alive && u.known === "live";
          if (th) { rg.mesh.position.set(u.x, gh(u.x, u.z) + 0.3, -u.z); rg.mat.opacity = 0.6 * th.alpha; } }
        k.mat.color.copy(!u.alive ? new THREE.Color(0x444444) : hit.has(u.vid) ? new THREE.Color(0xffd23f) : u.team === tl.recorder.team ? ally : foe);
        { const cn = vcones.get(u.vid)!, show = L.trainer.on && u.known === "live" && u.alive && trainerMatch(L.trainer.sel, u.vid, u.team, tl.recorder.team);
          cn.fan.visible = cn.ring.visible = show;
          if (show) {
            const R = VIEW_RANGE_M.value, half = (VIEW_FOV_DEG.value * Math.PI) / 360;
            // heading convention as in the 2D view: a point at angle a sits at model (x + R sin a, z + R cos a); 3D z is -z.
            // The fan follows the smoothed turret yaw (sm.g), the same value the turret mesh turns by, so cone and tower move as one.
            const pt = (a: number, r: number, out: Float32Array, at: number) => { const px = u.x + r * Math.sin(a), pz = u.z + r * Math.cos(a); out[at] = px; out[at + 1] = gh(px, pz) + 0.4; out[at + 2] = -pz; };
            pt(0, 0, cn.fanPos, 0); cn.fanPos[0] = u.x; cn.fanPos[1] = gh(u.x, u.z) + 0.4; cn.fanPos[2] = -u.z;
            for (let i = 0; i <= CN; i++) pt(sm.g - half + (2 * half * i) / CN, R, cn.fanPos, (i + 1) * 3);
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
        { const sp = spins.get(u.vid)!, rp = L.reload && u.alive && u.known === "live" ? reloadProgress(spinTimes.get(u.vid)!, spinEst.get(u.vid)!, clock.current.t) : null;
          sp.line.visible = rp != null;
          if (rp != null) { const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion), cx = u.x, cy = gh(u.x, u.z) + 7, cz = -u.z;
            for (let i = 0; i <= SPIN_N; i++) { const a = -Math.PI / 2 + (2 * Math.PI * rp * i) / SPIN_N, ca = Math.cos(a) * SPIN_R, sa = Math.sin(a) * SPIN_R;
              sp.pos[i * 3] = cx + ca * right.x + sa * up.x; sp.pos[i * 3 + 1] = cy + ca * right.y + sa * up.y; sp.pos[i * 3 + 2] = cz + ca * right.z + sa * up.z; }
            (sp.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true; } }
        k.g.scale.y = u.alive ? 1 : 0.5; k.g.children[2]!.visible = u.vid !== L.vid; const aim = aim0; (k.g.children[1] as THREE.Group).rotation.y = aim ? sm.h - sm.g : 0; if (u.vid === L.vid) { turretYaw = sm.g; hullYawS = sm.h; onTarget = !!aim?.onTarget; turretPitch = aim ? aim.pitch : 0; }
      }
      let n = 0; const T = clock.current.t; // first person: the followed tank's own tracers start at the gun, lower and ahead of the camera, so the streak is visible leaving the gun instead of starting at the eye (where it is on-axis and invisible)
      const gunO: [number, number, number] | null = L.mode === "fp" && me && me.known !== "never" ? [me.x + Math.sin(turretYaw) * GUN_LEN_M, gh(me.x, me.z) + 2.6, -me.z - Math.cos(turretYaw) * GUN_LEN_M] : null;
      for (const sh of shots) { if (sh.t > T) break; const age = T - sh.t; if (age > TRACER_S || n >= MAXS) continue;
        // the gun start is only for the followed tank's own shots: everyone else's tracers keep their recorded
        // direction (enemy -> player), instead of all being drawn backwards out of the camera
        const own = sh.shooter === L.vid;
        let x0 = gunO && own ? gunO[0] : sh.x0, y0 = gunO && own ? gunO[1] : (sh.y0 ?? gh(sh.x0, sh.z0)) + 2.6, z0 = gunO && own ? gunO[2] : -sh.z0;
        let x1 = sh.x1, y1 = (sh.y1 ?? gh(sh.x1, sh.z1)) + 0.6, z1 = -sh.z1;
        // endpoints on the camera blow up on screen (a vertex at the camera projects to infinity): push any endpoint
        // closer than TRACER_NEAR_M out along the shot. A segment clipped to nothing keeps a 0.5 m stub at its end.
        { const s0 = new THREE.Vector3(x0, y0, z0), s1 = new THREE.Vector3(x1, y1, z1), dir = new THREE.Vector3().subVectors(s1, s0), len = dir.length();
          if (len > 1e-6) { dir.divideScalar(len);
            const d0 = s0.distanceTo(cam.position), d1 = s1.distanceTo(cam.position);
            if (d0 < TRACER_NEAR_M) s0.addScaledVector(dir, TRACER_NEAR_M - d0);
            if (d1 < TRACER_NEAR_M) s1.addScaledVector(dir, -(TRACER_NEAR_M - d1));
            if (new THREE.Vector3().subVectors(s1, s0).dot(dir) <= 0) s0.copy(s1).addScaledVector(dir, -0.5);
            x0 = s0.x; y0 = s0.y; z0 = s0.z; x1 = s1.x; y1 = s1.y; z1 = s1.z; } }
        // billboard: the ribbon's width runs across the view, so it never turns edge-on (a flat ribbon vanishes from a low first-person camera)
        const dvec = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0), mid = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        const toCam = new THREE.Vector3().subVectors(cam.position, mid);
        let side = new THREE.Vector3().crossVectors(dvec, toCam);
        if (side.lengthSq() < 0.0025 * dvec.lengthSq() * toCam.lengthSq()) {
          // camera on (or near) the tracer line: first-person own shots start at the gun, close to the camera
          // line, so the cross product degenerates and the old absolute fallback made the ribbon vertical. Take the width from the camera's
          // up instead, so it stays across the view; straight up/down shots fall back to the camera's right.
          side = new THREE.Vector3().crossVectors(dvec, new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion));
          if (side.lengthSq() < 1e-9) side = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        }
        side.setLength(TRACER_HALF);
        const px = side.x, py = side.y, pz = side.z;
        const fade = Math.max(0, 1 - age / TRACER_S), k = n * 18;
        tpos.set([x0 - px, y0 - py, z0 - pz, x0 + px, y0 + py, z0 + pz, x1 - px, y1 - py, z1 - pz, x0 + px, y0 + py, z0 + pz, x1 + px, y1 + py, z1 + pz, x1 - px, y1 - py, z1 - pz], k);
        for (let v = 0; v < 6; v++) tcolT.set([fade, fade * 0.9, fade * 0.4], k + v * 3);
        n++; }
      tgeo.setDrawRange(0, n * 6);
      (tgeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true; (tgeo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
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
    return () => { cancelAnimationFrame(raf); ro.disconnect(); rgeo.dispose(); (ribbon.material as THREE.Material).dispose(); dom.removeEventListener("pointerdown", down); dom.removeEventListener("pointermove", move); dom.removeEventListener("pointerup", up); dom.removeEventListener("pointercancel", up); dom.removeEventListener("wheel", wheel); dom.removeEventListener("dblclick", reset); for (const g of deco) g.dispose(); for (const m of decoMat) m.dispose(); renderer.dispose(); tgeo.dispose(); for (const l of labels) { (l.material as THREE.SpriteMaterial).map?.dispose(); l.material.dispose(); } geo.dispose(); hull.dispose(); tur.dispose(); gun.dispose(); sphereGeo.dispose(); for (const s of spheres.values()) s.mat.dispose(); ringGeo.dispose(); for (const r of rings.values()) r.mat.dispose(); tex?.dispose(); for (const k of tanks.values()) k.mat.dispose(); el.removeChild(renderer.domElement); };
  }, [tl, img, bounds, clock, obstacles]);
  return <div ref={host} className="povhost" data-testid="pov" data-mode={mode} />;
}
