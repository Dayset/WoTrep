/** Finding v1 — docs/contracts/findings.md. Keep in sync with the doc. */
export type Evidence =
  | { k: "unit"; vid: number; t: number; label?: string }
  | { k: "line"; from: number; to: number; t: number; style: "fire" | "spot" | "threat" }
  | { k: "zone"; x: number; z: number; r: number; style: "exposed" | "cover" | "suggested" }
  | { k: "path"; vid: number; t0: number; t1: number; style: "actual" | "suggested" }
  | { k: "timer"; vid: number; t: number; label: string; secondsLeft: number }
  | { k: "number"; label: string; value: number; unit?: string };

export interface Finding {
  schema: "wotrep.finding/1";
  id: string;
  detector: string;
  detectorVersion: number;
  vid: number;
  kind: "mistake" | "good" | "info";
  tStart: number; tEnd: number;
  leadS: number;
  cost: { hp?: number; damageMissed?: number; winProbDelta?: number };
  confidence: number;
  luck?: "rng-bad" | "rng-good";
  evidence: Evidence[];
  messageKey: string;
  params: Record<string, number | string>;
  guide?: string;
  drill?: boolean;
}
