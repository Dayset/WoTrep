# Contract: Finding v1 (coaching output)

**Owner:** `packages/coach` (epic E7). Producers: one detector per file in `packages/coach/src/detectors/`.
Consumers: the replay player (pause points, timeline ticks), the report page, the Commander debrief, guides.

```ts
export interface Finding {
  schema: "wotrep.finding/1";
  id: string;                      // `${detectorId}:${vid}:${tStart.toFixed(1)}` — stable across runs
  detector: string;                // "peek-into-loaded-autoloader"
  detectorVersion: number;         // bump when logic or thresholds change
  vid: number;                     // whose decision it is (usually the recorder)
  kind: "mistake" | "good" | "info";
  tStart: number; tEnd: number;    // battle seconds; the player pauses at tStart − leadS
  leadS: number;                   // how much earlier to pause so the situation is visible (default 3)
  cost: {                          // what it cost, in exact numbers (no letter grades)
    hp?: number;                   // HP lost because of it
    damageMissed?: number;         // damage the player could have dealt
    winProbDelta?: number;         // ΔWP for the recorder's team, −1..+1, from packages/analysis wp model
  };
  confidence: number;              // 0..1; the UI hides < 0.5 unless "show uncertain" is on
  luck?: "rng-bad" | "rng-good";   // set when the outcome was mostly dice (COACHING.md §3)
  evidence: Evidence[];            // what the viewer is shown when paused (drawn by the 2D player)
  messageKey: string;              // i18n key: "coach.peekAutoloader.title" / ".body" / ".fix"
  params: Record<string, number | string>; // values for the message template
  guide?: string;                  // slug of the guide that teaches the fix (E9)
  drill?: boolean;                 // usable as a "what would you do?" quiz moment (E9)
}

export type Evidence =
  | { k: "unit"; vid: number; t: number; label?: string }                       // highlight a vehicle
  | { k: "line"; from: number; to: number; t: number; style: "fire" | "spot" | "threat" }
  | { k: "zone"; x: number; z: number; r: number; style: "exposed" | "cover" | "suggested" }
  | { k: "path"; vid: number; t0: number; t1: number; style: "actual" | "suggested" }
  | { k: "timer"; vid: number; t: number; label: string; secondsLeft: number }  // e.g. enemy reload
  | { k: "number"; label: string; value: number; unit?: string };
```

Rules for detector authors
1. **Pure:** `detect(timeline, snapshots, gamedata, config) → Finding[]`. No I/O, no randomness, no Date.now().
2. **Thresholds live in `packages/coach/config/<detector>.json`** with provenance:
   `{ "value": 140, "why": "p90 of nearest-ally distance for MTs at death, n=…, 2026-…" }`. Until we have a
   corpus, mark `"why": "initial guess, recalibrate in E13"`. Never bury a number in code.
3. **Cost first.** A detector that cannot estimate any `cost` emits `kind: "info"`, never `"mistake"`.
4. **Wording:** short, second person, one fix. Never insult, never "noob", never "cheater". Exact numbers.
5. **Tests:** each detector ships a positive and a negative case (synthetic timelines are fine) and is run on
   every fixture in CI; its findings on the fixtures are snapshotted (`fixtures/expected/findings/*.json`).
