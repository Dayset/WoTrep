import type { BattleTimeline } from "@wotrep/model";
import { loadConfig, type Cfg } from "./config";
import type { Finding } from "./finding";

/** What a detector reads: P positions · H health events · T shots · C camera/aim · R reload · Z map zones · W win probability. */
export type Need = "P" | "H" | "T" | "C" | "R" | "Z" | "W";

export interface DetectorInput { tl: BattleTimeline; cfg: Cfg }
export interface Detector {
  id: string; version: number; needs: Need[];
  detect(input: DetectorInput): Finding[];
  cfg: Cfg;
}

/** Pure by contract: no I/O, no randomness, no clock. The config is validated (with provenance) when the detector is defined. */
export function defineDetector(d: { id: string; version: number; needs: Need[]; config: unknown; detect(input: DetectorInput): Omit<Finding, "schema" | "id" | "detector" | "detectorVersion">[] }): Detector {
  const cfg = loadConfig(d.config, d.id);
  return {
    id: d.id, version: d.version, needs: d.needs, cfg,
    detect: (input) => d.detect({ ...input, cfg }).map((f) => ({
      ...f, schema: "wotrep.finding/1" as const, detector: d.id, detectorVersion: d.version, id: `${d.id}:${f.vid}:${f.tStart.toFixed(1)}`,
    })),
  };
}

export function runDetectors(tl: BattleTimeline, detectors: Detector[]): Finding[] {
  return detectors.flatMap((d) => d.detect({ tl, cfg: d.cfg }));
}
