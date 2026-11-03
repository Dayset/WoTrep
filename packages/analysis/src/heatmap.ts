import type { BattleTimeline, Track } from "@wotrep/model";

/** Map-page layers (docs/MAPPAGE.md). All positions are in game metres (x east, z north); times are battle seconds. */
export type HeatLayer = "presence" | "dmgdealt" | "dmgrecv" | "deaths" | "routes" | "spots";
export interface HeatOpts {
  bounds: { x0: number; x1: number; z0: number; z1: number }; cellM?: number;
  team?: "own" | "enemy" | "both";   // whose units count (relative to the recorder's team)
  cls?: string[];                    // vehicle classes to include; empty/undefined = all
  t0?: number; t1?: number;          // time window
  vid?: number;                      // only this player (for dmgdealt: as attacker, dmgrecv: as victim)
}
export interface HeatGrid { cols: number; rows: number; cellM: number; values: Float32Array; total: number; max: number; unit: "s" | "hp" | "count" }

const posAt = (tr: Track | undefined, t: number): [number, number] | null => {
  if (!tr || !tr.t.length) return null;
  let lo = 0, hi = tr.t.length - 1; if (t < tr.t[0]! - 2 || t > tr.t[hi]! + 2) return null;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tr.t[m]! < t) lo = m + 1; else hi = m; }
  return [tr.x[lo]!, tr.z[lo]!];
};
const seen = (tr: Track, t: number) => tr.visible.some(([a, b]) => t >= a && t <= b);

export function heatGrid(tl: BattleTimeline, layer: HeatLayer, o: HeatOpts): HeatGrid {
  const cell = o.cellM ?? 25, { x0, x1, z0, z1 } = o.bounds;
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell)), rows = Math.max(1, Math.ceil((z1 - z0) / cell));
  const values = new Float32Array(cols * rows); let total = 0;
  const t0 = o.t0 ?? 0, t1 = o.t1 ?? (layer === "routes" ? 60 : Infinity), rec = tl.recorder.team;
  const info = new Map(tl.vehicles.map((v) => [v.vid, v]));
  const ok = (vid: number) => {
    const v = info.get(vid); if (!v) return false;
    if (o.vid != null && vid !== o.vid) return false;
    if (o.team === "own" && v.team !== rec) return false; if (o.team === "enemy" && v.team === rec) return false;
    return !o.cls?.length || o.cls.includes(v.vehicleType);
  };
  const add = (x: number, z: number, w: number) => {
    const c = Math.floor((x - x0) / cell), r = Math.floor((z - z0) / cell); if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    values[r * cols + c]! += w; total += w;
  };
  const deathT = new Map<number, number>(); for (const e of tl.events) if (e.k === "kill") deathT.set(e.victim, e.t);
  if (layer === "presence" || layer === "routes") {
    for (const v of tl.vehicles) {
      if (!ok(v.vid)) continue; const tr = tl.tracks[v.vid]; if (!tr) continue; const dead = deathT.get(v.vid) ?? Infinity;
      for (let i = 0; i < tr.t.length; i++) {
        const t = tr.t[i]!; if (t < Math.max(0, t0) || t > t1 || t >= dead) continue;
        if (v.team !== rec && !seen(tr, t)) continue;                // enemies only where we actually saw them
        const dt = Math.min(1, (tr.t[i + 1] ?? t) - t); if (dt > 0) add(tr.x[i]!, tr.z[i]!, dt);
      }
    }
  } else if (layer === "dmgdealt" || layer === "dmgrecv") {
    for (const e of tl.events) {
      if (e.k !== "damage" || e.amount <= 0 || e.t < t0 || e.t > t1) continue;
      const mine = layer === "dmgdealt" ? e.attacker : e.target; if (!ok(mine)) continue;
      const p = posAt(tl.tracks[e.target], e.t); if (p) add(p[0], p[1], e.amount);
    }
  } else if (layer === "deaths") {
    for (const e of tl.events) { if (e.k !== "kill" || e.t < t0 || e.t > t1 || !ok(e.victim)) continue; const p = posAt(tl.tracks[e.victim], e.t); if (p) add(p[0], p[1], 1); }
  } else {
    // first time each unit was spotted: where it was when it was found
    const first = new Set<number>();
    for (const e of tl.events) { if (e.k !== "spotted" || first.has(e.vid) || e.t < t0 || e.t > t1) continue; first.add(e.vid); if (!ok(e.vid)) continue; const p = posAt(tl.tracks[e.vid], e.t); if (p) add(p[0], p[1], 1); }
  }
  let max = 0; for (const v of values) if (v > max) max = v;
  return { cols, rows, cellM: cell, values, total, max, unit: layer === "presence" || layer === "routes" ? "s" : layer === "dmgdealt" || layer === "dmgrecv" ? "hp" : "count" };
}
