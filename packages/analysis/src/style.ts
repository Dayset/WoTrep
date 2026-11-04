import type { BattleTimeline } from "@wotrep/model";
import cfg from "../config/style-v0.json";
import { movement } from "./movement";
import { teamplayAll } from "./teamplay";
import { boldnessAll } from "./boldness";

/** Player style and an iVi-like result score, team-relative (docs/METRICS.md, style-v0).
 *  Inputs come from the replay's official results (per player) and the movement / teamplay / boldness modules.
 *  Every raw value is divided by the team mean of that value, so 1.0 = team average; the score is the weighted mean of those
 *  ratios scaled by `scale` (team average = 100). A null input drops out of the mean for that player only.
 *  `pressure` is the Brave/PVS shape from the Ps2 Elite KD project: activity × (shifted slope)^1.5, with the slope a proxy
 *  (damage exchange rate, shifted by the floor and eps) because WoT has no per-battle enemy-KPM curve yet. */

export const STYLE_KEYS = ["dpm", "kpm", "exchange", "hitRate", "spottedPerMin", "assistsPerMin", "mPerMin", "stillShare", "survival", "boldRate", "focusShare", "skillDpm"] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];

export interface Style {
  vid: number; team: 1 | 2;
  /** raw values; null when the replay does not report them */
  raw: Record<StyleKey, number | null>;
  /** raw / team mean of that key (1.0 = team average) */
  rel: Record<StyleKey, number | null>;
  /** team-relative iVi-like score, team average = 100; null when fewer than half the weighted inputs exist */
  score: number | null;
  /** Brave/PVS-shaped pressure: dpm × (shifted exchange)^1.5, team-relative */
  pressure: number | null;
}

const W = cfg.weights.value as Record<string, number>;
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const ok = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

export function styleAll(tl: BattleTimeline): Map<number, Style> {
  const endS = Math.max(1, tl.arena.durationS ?? Math.max(1, ...tl.events.map((e) => e.t)));
  const minutes = endS / 60;
  const mv = new Map(movement(tl).players.map((m) => [m.vid, m] as const));
  const tp = teamplayAll(tl), bo = boldnessAll(tl);
  const out = new Map<number, Style>();
  for (const v of tl.vehicles) {
    const r = tl.results?.players[v.vid];
    const m = mv.get(v.vid), p = tp.get(v.vid), b = bo.get(v.vid);
    const dealt = r?.damageDealt ?? null, recv = r?.damageReceived ?? null;
    const raw: Record<StyleKey, number | null> = {
      dpm: dealt != null ? dealt / minutes : null,
      kpm: r ? r.kills / minutes : null,
      exchange: dealt != null && recv != null ? dealt / Math.max(recv, 1) : null,
      hitRate: r && r.shots > 0 ? r.hits / r.shots : null,
      spottedPerMin: r ? r.spotted / minutes : null,
      assistsPerMin: r ? (r.assistRadio + r.assistTrack + r.assistStun) / minutes : null,
      mPerMin: m?.mPerMin ?? null,
      stillShare: m?.stillShare ?? null,
      survival: r ? Math.min(1, r.lifeTimeS / endS) : null,
      boldRate: b?.rate ?? null,
      focusShare: p?.focusShare ?? null,
      skillDpm: null,
    };
    out.set(v.vid, { vid: v.vid, team: v.team, raw, rel: {} as Record<StyleKey, number | null>, score: null, pressure: null });
  }
  // team means per key
  const teamMean = (team: 1 | 2, k: StyleKey) => mean([...out.values()].filter((s) => s.team === team && ok(s.raw[k])).map((s) => s.raw[k] as number));
  for (const s of out.values()) {
    for (const k of STYLE_KEYS) {
      const tm = teamMean(s.team, k);
      s.rel[k] = ok(s.raw[k]) && tm && tm > 0 ? s.raw[k]! / tm : null;
    }
    const parts = (Object.keys(W) as (keyof typeof W)[]).map((k) => [s.rel[k as StyleKey], W[k]!] as const).filter((x): x is readonly [number, number] => ok(x[0]));
    const wsum = parts.reduce((a, [, w]) => a + w, 0);
    const totalW = Object.values(W).reduce((a, w) => a + w, 0);
    s.score = parts.length && wsum >= totalW / 2 ? (cfg.scale.value * parts.reduce((a, [x, w]) => a + x * w, 0)) / wsum : null;
    const shifted = s.raw.exchange != null ? Math.max(s.raw.exchange - cfg.slopeFloor.value + cfg.slopeEps.value, cfg.slopeEps.value) : null;
    s.pressure = shifted != null && s.raw.dpm != null ? s.raw.dpm * Math.pow(shifted, 1.5) : null;
  }
  // skill-weighted damage (separate metric, not in the score): each hit weighted by the target's style score ÷ 100, clamped.
  // The score is team-relative, so across teams this is a rough comparison; a target with no score counts as 1.
  const skillW = (vid: number) => { const sc = out.get(vid)?.score; return sc == null ? 1 : Math.min(cfg.skillMax.value, Math.max(cfg.skillMin.value, sc / 100)); };
  const sw = new Map<number, number>();
  for (const e of tl.events) {
    if (e.k !== "damage" || e.amount <= 0 || e.attacker === e.target) continue;
    const a = out.get(e.attacker), tg = out.get(e.target);
    if (!a || !tg || a.team === tg.team) continue;
    sw.set(e.attacker, (sw.get(e.attacker) ?? 0) + e.amount * skillW(e.target));
  }
  for (const s of out.values()) {
    const v = sw.get(s.vid);
    s.raw.skillDpm = v != null ? v / minutes : null;
  }
  for (const tm of [1, 2] as const) {
    const tmean = mean([...out.values()].filter((s) => s.team === tm && ok(s.raw.skillDpm)).map((s) => s.raw.skillDpm as number));
    for (const s of out.values()) if (s.team === tm) s.rel.skillDpm = ok(s.raw.skillDpm) && tmean && tmean > 0 ? s.raw.skillDpm / tmean : null;
  }
  // team-relative pressure
  for (const tm of [1, 2] as const) {
    const avg = mean([...out.values()].filter((s) => s.team === tm && ok(s.pressure)).map((s) => s.pressure as number));
    for (const s of out.values()) if (s.team === tm && ok(s.pressure) && avg && avg > 0) s.pressure = (s.pressure as number) / avg;
  }
  return out;
}
