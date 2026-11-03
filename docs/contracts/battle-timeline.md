# Contract: BattleTimeline v1

**Owner:** `packages/model` (epic E2). **Producers:** `packages/parser`. **Consumers:** everything else.
This is the one shape every agent can code against from day one, using `fixtures/timelines/*.json` as mock data
(created by E2-1 from the probe output). Changing it needs a `contract-change` issue + ADR (see AGENTS.md §4).

Design rules
- Pure data, JSON-serialisable, no classes. Times are **battle seconds** (`t = clock − battleStartClock`;
  pre-battle countdown is negative). Distances in metres, angles in radians, world axes `x` (east), `z` (north), `y` (up).
- Columnar tracks (parallel arrays) for anything sampled at ~10 Hz — 30 vehicles × 400 s × 10 Hz must stay < 3 MB JSON.
- Everything the recorder could **not** see is absent, not guessed. Visibility gaps are explicit.
- Vehicle identity is the `avatarSessionId` (as number) — called `vid` everywhere.

```ts
export interface BattleTimeline {
  schema: "wotrep.timeline/1";
  source: {
    realm: "wg" | "lesta";            // file family; regionCode kept separately
    regionCode: string;               // "RU", "EU", ...
    server: string;                   // "RU2"
    clientVersion: string;            // "1.46.0.0"
    manifest: { id: string; confidence: "defs" | "fingerprint" | "none" };
    fileName?: string;
    hasMods: boolean;
    sha256: string;                   // of the original file; dedupe + share key
  };
  arena: {
    arenaUniqueId: string;            // string: exceeds 2^53
    map: string;                      // "101_dday"
    mapDisplayName: string;           // localised, from the replay
    gameplay: string;                 // "ctf" | "domination" | "assault" | ...
    battleType: number;
    startedAt: string;                // ISO, from block0 dateTime (server local time, no tz in file)
    durationS: number | null;         // results.common.duration
    winnerTeam: 0 | 1 | 2 | null;     // 0 = draw, null = no results block
    finishReason: number | null;
    battleStartClock: number;         // raw clock of arena period 3
  };
  recorder: { vid: number; team: 1 | 2; name: string };
  vehicles: VehicleInfo[];
  tracks: Record<number, Track>;      // key = vid
  events: BattleEvent[];              // sorted by t, stable order for equal t
  camera: { t: number[]; mode: string[] };            // recorder camera mode switches
  aim?: { t: number[]; pos: number[]; dir: number[] }; // recorder aim, flat xyz triples (0x1A)
  results?: BattleResults;            // block 1, normalised (see below); absent for unfinished replays
  diagnostics: { unknownPacketTypes: Record<string, number>; warnings: string[] };
}

export interface VehicleInfo {
  vid: number;
  team: 1 | 2;
  name: string;                       // in-battle name (anonymizer-safe; realName is never present)
  anonymized: boolean;
  clan?: string;                      // omitted when anonymized
  accountId?: number;                 // omitted when anonymized
  vehicleType: string;                // "intunion:Un15_SBM_44"
  maxHealth: number;
  isRecorder: boolean;
  platoon?: number;                   // prebattleID when > 0
}

export interface Track {
  t: number[];                        // battle seconds, ascending
  x: number[]; z: number[]; y: number[];
  yaw: number[];                      // hull yaw
  gunYaw?: number[];                  // when decodable (property 14 on Lesta 1.46, unverified)
  visible: [number, number][];        // closed intervals [tStart, tEnd] when the vehicle was in AoI
}

export type BattleEvent =
  | { k: "period"; t: number; period: number; lengthS: number }
  | { k: "spotted"; t: number; vid: number }                 // entered recorder AoI
  | { k: "unspotted"; t: number; vid: number }
  | { k: "shot"; t: number; shooter: number; shotId?: number } // tracer or showShooting
  | { k: "projectileEnd"; t: number; shotId: number; x: number; y: number; z: number }
  | { k: "damage"; t: number; target: number; attacker: number; amount: number;
      hpBefore: number; hpAfter: number; reason: number }    // reason: 0 shot, 1 fire, 2 ramming, ... (see model/reasons.ts)
  | { k: "kill"; t: number; victim: number; killer: number; reason: number; equipment: number }
  | { k: "chat"; t: number; team: "ally" | "enemy" | "all"; sender?: string; text: string }
  | { k: "baseCapture"; t: number; team: 1 | 2; points: number; capturers: number[] }
  | { k: "personal"; t: number; type: string; target?: number; value?: number }; // onBattleEvents (assist, spot, block…)

export interface BattleResults {
  players: Record<number, PlayerResult>;   // key = vid
  personal?: {                             // recorder only
    movingAvgDamage?: number; damageRating?: number; marksOnGun?: number;
    xp?: number; credits?: number; potentialDamageReceived?: number;
    damageReceivedFromInvisibles?: number; noDamageDirectHitsReceived?: number;
  };
}

export interface PlayerResult {
  damageDealt: number; assistRadio: number; assistTrack: number; assistStun: number;
  blocked: number; kills: number; spotted: number; shots: number; hits: number; pens: number;
  damageReceived: number; lifeTimeS: number; deathReason: number; killerVid: number | null;
  mileageM: number; xp: number; capturePoints: number; droppedCapturePoints: number;
}
```

## Derived state (`packages/model/state.ts`)

`stateAt(tl, t)` returns the snapshot every view and detector uses — never re-derive it elsewhere:

```ts
interface Snapshot {
  t: number;
  units: Array<{ vid: number; alive: boolean; hp: number; x: number; z: number; yaw: number;
                 known: "live" | "ghost" | "never";  // ghost = last known position, with ageS
                 ageS?: number; lastShotT?: number; reloadEstimate?: ReloadState }>;
  teamHp: { 1: number; 2: number }; alive: { 1: number; 2: number };
}
```
`ReloadState` comes from game data (reload time, autoloader clip/intra-clip) plus observed shots: it is an
*estimate* with `confidence`. Detectors must treat it as such (see COACHING.md).
