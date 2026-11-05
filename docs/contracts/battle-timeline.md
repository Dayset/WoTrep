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
    xpBase?: number; creditsBase?: number; // pre-multiplier bases (originalXP/originalCredits)
    repairCost?: number; ammoCost?: number; // repair (or autoRepairCost); credits part of autoLoadCost[0]
  };                                       // profit = credits − repairCost − ammoCost (derived in the UI)
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
                 ageS?: number; reachM?: number; reachSpeedMps?: number; lastShotT?: number; reloadEstimate?: ReloadState }>;
  teamHp: { 1: number; 2: number }; alive: { 1: number; 2: number };
}
```
`reachM` (ghost, alive only) is the radius of where the tank could have got to by `t`: its fastest 2 s-window
speed observed up to the last-seen sample, times `ageS`. It is a worst-case bound, not a predicted position —
it assumes the tank kept going flat-out in any direction — and it is gone the moment the tank is live again.
Dead ghosts carry no `reachM`. `reachSpeedMps` carries that fastest speed itself (m/s), so callers can turn a
distance into a time without dividing by a possibly-zero `ageS`.
`ReloadState` comes from game data (reload time, autoloader clip/intra-clip) plus observed shots: it is an
*estimate* with `confidence`. Detectors must treat it as such (see COACHING.md).

## Compact codec (`packages/model/src/codec.ts`, E2-05)

`encodeTimeline` / `decodeTimeline` serialise a timeline to the binary `WTC1` format: magic + version,
then sections in fixed order (source, arena, recorder, vehicles, tracks, events, camera, aim?,
results?, diagnostics). Integers are LEB128 varints (zigzag for signed/delta values); strings are
length-prefixed UTF-8; genuinely fractional numbers (battleStartClock, capture points, personal
values, results numbers) are f64 and round-trip exactly. Integer fields must be integers — encode
throws otherwise.

Quantisation (the only lossy part; everything else is exact):

| Field | Step | Max error |
| --- | --- | --- |
| Times (track/event/camera t, visible intervals) | 0.01 s | 0.01 s |
| Track positions and projectileEnd coordinates | 0.1 m | 0.1 m |
| Track yaw / gunYaw | 0.01 rad | 0.01 rad |

Time series are delta-coded. On the fixture (`lesta-1.46-overlord-sbm44`, 1.8 MB as JSON) the codec
produces 281 KB (6.3× smaller, under the 400 KB budget) and decodes in ~9 ms (budget 50 ms).
Decode does NOT run zod validation — that would dominate the budget on 250k track samples; callers
that need a validity proof run `validateTimeline` on the result separately.
