import { useEffect, useRef } from "react";
import * as THREE from "three";
import { stateAt, type BattleTimeline } from "@wotrep/model";
import { tracerLines } from "@wotrep/analysis";
import type { MapBounds } from "../../lib/mapStore";

/** Low-poly 3D view of the replay on flat ground (docs/UX.md §4, simple mode). First person sits at the followed tank, chase view behind it.
 *  Heights and cover are not known yet, so ground is flat and nothing blocks the view. Hull direction is used for the camera (gun aim is not decoded). Shell traces from tracer start to end point show for 1.2 s; names float above tanks. */
export default function PovView({ tl, clock, vid, mode, img, bounds }: {
  tl: BattleTimeline; clock: { current: { t: number } }; vid: number; mode: "fp" | "chase"; img: HTMLImageElement | null; bounds: MapBounds;
}) {
  const host = useRef<HTMLDivElement>(null), live = useRef({ vid, mode }); live.current = { vid, mode };
  useEffect(() => {
    const el = host.current; if (!el) return;
    const css = (n: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;
    const ally = new THREE.Color(css("--accent", "#4aa3ff")), foe = new THREE.Color(css("--enemy", "#ff5a5a"));
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); el.appendChild(renderer.domElement); renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xbcd4e6); scene.fog = new THREE.Fog(0xbcd4e6, 250, 900);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667766, 1.1)); const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(-200, 400, 150); scene.add(sun);
    const W = bounds.x1 - bounds.x0, D = bounds.z1 - bounds.z0, geo = new THREE.PlaneGeometry(W, D); geo.rotateX(-Math.PI / 2);
    let tex: THREE.Texture | null = null; if (img) { tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; }
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: tex ? 0xffffff : 0x8fae8a, map: tex })); ground.position.set((bounds.x0 + bounds.x1) / 2, 0, -(bounds.z0 + bounds.z1) / 2); scene.add(ground);
    if (!tex) { const grid = new THREE.GridHelper(Math.max(W, D), Math.round(Math.max(W, D) / 50), 0x55704f, 0x7d9a77); grid.position.copy(ground.position); grid.position.y = 0.05; scene.add(grid); }
    const hull = new THREE.BoxGeometry(3.2, 1.5, 6.4), tur = new THREE.BoxGeometry(2, 0.9, 2.4), gun = new THREE.BoxGeometry(0.25, 0.25, 3.6);
    const tanks = new Map<number, { g: THREE.Group; mat: THREE.MeshLambertMaterial }>();
    for (const v of tl.vehicles) {
      const mat = new THREE.MeshLambertMaterial({ color: v.team === tl.recorder.team ? ally : foe, flatShading: true, transparent: true }), g = new THREE.Group();
      const h = new THREE.Mesh(hull, mat); h.position.y = 1.1; const tu = new THREE.Mesh(tur, mat); tu.position.set(0, 2.25, 0.3); const gn = new THREE.Mesh(gun, mat); gn.position.set(0, 2.3, -2.2);
      g.add(h, tu, gn); g.visible = false; scene.add(g); tanks.set(v.vid, { g, mat });
    }
    const labels: THREE.Sprite[] = [], shots = tracerLines(tl, {}), MAXS = 80;
    for (const v of tl.vehicles) {
      const c = document.createElement("canvas"); c.width = 256; c.height = 64; const g2 = c.getContext("2d")!; g2.font = "bold 34px sans-serif"; g2.textAlign = "center"; g2.fillStyle = "rgba(0,0,0,0.55)"; g2.fillRect(0, 8, 256, 48); g2.fillStyle = v.team === tl.recorder.team ? "#9fd0ff" : "#ffb0b0"; g2.fillText(v.name.slice(0, 14), 128, 46);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true })); sp.scale.set(16, 4, 1); sp.position.y = 6; sp.renderOrder = 5; tanks.get(v.vid)!.g.add(sp); labels.push(sp);
    }
    const tgeo = new THREE.BufferGeometry(), tpos = new Float32Array(MAXS * 6); tgeo.setAttribute("position", new THREE.BufferAttribute(tpos, 3)); tgeo.setDrawRange(0, 0);
    const tlines = new THREE.LineSegments(tgeo, new THREE.LineBasicMaterial({ color: 0xffe066 })); tlines.frustumCulled = false; scene.add(tlines);
    const cam = new THREE.PerspectiveCamera(65, 1, 0.5, 1500);
    const size = () => { const w = el.clientWidth || 640, h = el.clientHeight || 360; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    size(); const ro = new ResizeObserver(size); ro.observe(el);
    let raf = 0; const loop = () => {
      raf = requestAnimationFrame(loop); const L = live.current, s = stateAt(tl, clock.current.t), me = s.units.find((u) => u.vid === L.vid);
      const hit = new Set<number>(); for (const e of tl.events) if (e.k === "damage" && e.target === L.vid && e.t <= clock.current.t && e.t >= clock.current.t - 4) hit.add(e.attacker);
      for (const u of s.units) {
        const k = tanks.get(u.vid)!; k.g.visible = u.known !== "never" && !(L.mode === "fp" && u.vid === L.vid && u.alive);
        k.g.position.set(u.x, 0, -u.z); k.g.rotation.y = -u.yaw; k.mat.opacity = !u.alive ? 0.5 : u.known === "ghost" ? 0.3 : 1;
        k.mat.color.copy(!u.alive ? new THREE.Color(0x444444) : hit.has(u.vid) ? new THREE.Color(0xffd23f) : u.team === tl.recorder.team ? ally : foe);
        k.g.scale.y = u.alive ? 1 : 0.5; k.g.children[3]!.visible = u.vid !== L.vid;
      }
      let n = 0; for (const sh of shots) { if (sh.t > clock.current.t) break; if (sh.t < clock.current.t - 1.2 || n >= MAXS) continue; tpos.set([sh.x0, 2.6, -sh.z0, sh.x1, 2.6, -sh.z1], n * 6); n++; }
      tgeo.setDrawRange(0, n * 2); (tgeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      if (me && me.known !== "never") {
        const f = new THREE.Vector3(Math.sin(me.yaw), 0, -Math.cos(me.yaw)), p = new THREE.Vector3(me.x, 0, -me.z);
        if (L.mode === "fp") { cam.position.copy(p).setY(2.9); cam.lookAt(p.clone().addScaledVector(f, 50).setY(2.5)); }
        else { cam.position.copy(p).addScaledVector(f, -16).setY(8); cam.lookAt(p.clone().addScaledVector(f, 30).setY(1.5)); }
      }
      renderer.render(scene, cam);
    }; loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); tgeo.dispose(); for (const l of labels) { (l.material as THREE.SpriteMaterial).map?.dispose(); l.material.dispose(); } geo.dispose(); hull.dispose(); tur.dispose(); gun.dispose(); tex?.dispose(); for (const k of tanks.values()) k.mat.dispose(); el.removeChild(renderer.domElement); };
  }, [tl, img, bounds, clock]);
  return <div ref={host} className="povhost" data-testid="pov" data-mode={mode} />;
}
