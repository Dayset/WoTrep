# Contract: Commander call v1

**Owner:** `packages/commander` (epic E8). Consumers: 2D player side panel, debrief, voice, drills.
The Commander is deterministic math first (like PS2Map Oracle's commander). An LLM may only re-word a
`CommanderCall`; it never adds facts (see COMMANDER.md §5).

```ts
export interface CommanderCall {
  schema: "wotrep.commander/1";
  t: number;                         // battle second the call is for
  vid: number;                       // who receives the order (recorder by default; any ally on request)
  situation: {
    winProb: number;                 // recorder team, 0..1
    flanks: FlankState[];            // map-specific sectors (gamedata map zones)
    tags: string[];                  // "LOCKED_WIN", "TWO_FRONT", "COLLAPSE_FORMING", "TRADE_WINDOW", ...
  };
  orders: Order[];                   // best first, max 3; orders[0] is "the call"
}

export interface FlankState {
  zone: string;                      // "north-ridge"
  allies: number[]; enemiesKnown: number[]; enemiesGhost: number[];
  hpAllies: number; hpEnemiesKnown: number;
  strength: number;                  // Lanchester-style, >1 = we win this flank (METRICS.md §3.1)
  trend: number;                     // d(strength)/dt over the last 20 s
}

export interface Order {
  verb: "push" | "hold" | "fallback" | "rotate" | "spot" | "cap" | "defend-cap" | "trade" | "wait-reload" | "relocate";
  target?: { zone?: string; vid?: number; x?: number; z?: number };
  why: string[];                     // machine reasons: ["enemy-reload:13908133:9s", "flank-strength:2.4"]
  expectedWinProbDelta: number;      // vs doing nothing for the next 20 s
  messageKey: string; params: Record<string, number | string>;
}
```
"Dummy-proof" rule (carried over from PS2Map Oracle): the top order must be one clear action a weak
player can execute. Low-value options are dropped, not listed.
