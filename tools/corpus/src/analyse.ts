import { coverage, playerHeuristics, playerMetrics, playerStats, wpOf, wpSeries } from "@wotrep/analysis";
import { detectors, runDetectors } from "@wotrep/coach";
import { stateAt, type BattleTimeline } from "@wotrep/model";

/** One NDJSON line per replay (schema documented in tools/corpus/README.md). */
export interface CorpusPlayer {
  vid: number; name: string; team: 1 | 2;
  damage: number | null; kills: number | null; assist: number | null; blocked: number | null; received: number | null;
  dpm: number | null; share: number | null; accuracy: number | null; penRate: number | null; lifeS: number | null;
  impactPts: number | null; threatWeighted: number | null;
}
export interface CorpusFinding {
  detector: string; vid: number; kind: "mistake" | "good" | "info";
  tStart: number; tEnd: number; cost: { hp?: number; damageMissed?: number; winProbDelta?: number }; confidence: number;
}
export interface CorpusRecord {
  schema: "wotrep.corpus/1"; file: string;
  arena: { map: string; mapDisplayName: string; durationS: number | null; winnerTeam: 0 | 1 | 2 | null; battleType: number };
  recorder: { vid: number; name: string; team: 1 | 2 };
  coverage: ReturnType<typeof coverage>;
  players: CorpusPlayer[];
  /** All detectors, unranked: calibration needs the full set, not the default view's top 5 + 3. */
  findings: CorpusFinding[];
  /** Win probability for the recorder's team: every 30 s plus the final second. */
  wp: { t: number; wp: number }[];
}

/** Pure: a parsed timeline in, one corpus record out. No I/O, no clock. */
export function analyseTimeline(tl: BattleTimeline, file: string): CorpusRecord {
  const pm = new Map(playerMetrics(tl).map((p) => [p.vid, p]));
  const ps = new Map(playerStats(tl).map((p) => [p.vid, p]));
  const players: CorpusPlayer[] = tl.vehicles.map((v) => {
    const r = tl.results?.players[v.vid], h = playerHeuristics(tl, v.vid), m = pm.get(v.vid), s = ps.get(v.vid);
    return {
      vid: v.vid, name: v.name, team: v.team,
      damage: r?.damageDealt ?? null, kills: r?.kills ?? null,
      assist: r ? r.assistRadio + r.assistTrack + r.assistStun : null,
      blocked: r?.blocked ?? null, received: r?.damageReceived ?? null,
      dpm: m?.dpm ?? null, share: m ? Math.round(m.share * 1000) / 1000 : null,
      accuracy: s?.accuracy ?? null, penRate: s?.penRate ?? null, lifeS: s?.lifeS ?? null,
      impactPts: h?.impactPts ?? null, threatWeighted: h?.threatWeighted ?? null,
    };
  });
  const findings: CorpusFinding[] = runDetectors(tl, detectors).map((f) => ({
    detector: f.detector, vid: f.vid, kind: f.kind, tStart: f.tStart, tEnd: f.tEnd, cost: f.cost, confidence: f.confidence,
  }));
  const end = Math.floor(tl.arena.durationS ?? tl.events.at(-1)?.t ?? 0);
  const series = wpSeries(tl, tl.recorder.team, 30);
  const wp = series.t.map((t, i) => ({ t, wp: Math.round(series.wp[i]! * 1000) / 1000 }));
  if (wp.at(-1)?.t !== end) wp.push({ t: end, wp: Math.round(wpOf(stateAt(tl, end), tl.recorder.team) * 1000) / 1000 });
  return {
    schema: "wotrep.corpus/1", file,
    arena: { map: tl.arena.map, mapDisplayName: tl.arena.mapDisplayName, durationS: tl.arena.durationS, winnerTeam: tl.arena.winnerTeam, battleType: tl.arena.battleType },
    recorder: { vid: tl.recorder.vid, name: tl.recorder.name, team: tl.recorder.team },
    coverage: coverage(tl),
    players, findings, wp,
  };
}
