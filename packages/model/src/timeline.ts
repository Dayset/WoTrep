// BattleTimeline v1 — contract: docs/contracts/battle-timeline.md. Change only via a contract-change issue.
export type Team = 1 | 2;

export interface BattleTimeline {
  schema: "wotrep.timeline/1";
  source: {
    realm: "wg" | "lesta"; regionCode: string; server: string; clientVersion: string;
    manifest: { id: string; confidence: "defs" | "fingerprint" | "none" };
    fileName?: string; hasMods: boolean; sha256: string;
  };
  arena: {
    arenaUniqueId: string; map: string; mapDisplayName: string; gameplay: string; battleType: number;
    startedAt: string; durationS: number | null; winnerTeam: 0 | 1 | 2 | null; finishReason: number | null;
    battleStartClock: number;
  };
  recorder: { vid: number; team: Team; name: string };
  vehicles: VehicleInfo[];
  tracks: Record<number, Track>;
  events: BattleEvent[];
  camera: { t: number[]; mode: string[] };
  aim?: { t: number[]; pos: number[]; dir: number[] };
  results?: BattleResults;
  diagnostics: { unknownPacketTypes: Record<string, number>; warnings: string[] };
}

export interface VehicleInfo {
  vid: number; team: Team; name: string; anonymized: boolean; clan?: string; accountId?: number;
  vehicleType: string; maxHealth: number; isRecorder: boolean; platoon?: number;
}

export interface Track {
  t: number[]; x: number[]; z: number[]; y: number[]; yaw: number[]; gunYaw?: number[];
  visible: [number, number][];
}

export type BattleEvent =
  | { k: "period"; t: number; period: number; lengthS: number }
  | { k: "spotted"; t: number; vid: number }
  | { k: "unspotted"; t: number; vid: number }
  | { k: "shot"; t: number; shooter: number; shotId?: number }
  | { k: "projectileEnd"; t: number; shotId: number; x: number; y: number; z: number }
  | { k: "damage"; t: number; target: number; attacker: number; amount: number; hpBefore: number; hpAfter: number; reason: number }
  | { k: "kill"; t: number; victim: number; killer: number; reason: number; equipment: number }
  | { k: "chat"; t: number; team: "ally" | "enemy" | "all"; sender?: string; text: string }
  | { k: "baseCapture"; t: number; team: Team; points: number; capturers: number[] }
  | { k: "personal"; t: number; type: string; target?: number; value?: number };

export interface PlayerResult {
  damageDealt: number; assistRadio: number; assistTrack: number; assistStun: number; blocked: number;
  kills: number; spotted: number; shots: number; hits: number; pens: number; damageReceived: number;
  lifeTimeS: number; deathReason: number; killerVid: number | null; mileageM: number; xp: number;
  capturePoints: number; droppedCapturePoints: number;
}

export interface BattleResults {
  players: Record<number, PlayerResult>;
  personal?: {
    movingAvgDamage?: number; damageRating?: number; marksOnGun?: number; xp?: number; credits?: number;
    potentialDamageReceived?: number; damageReceivedFromInvisibles?: number; noDamageDirectHitsReceived?: number;
    // Battle economy (recorder only, from block 1 `personal`): xp/credits are the
    // totals after multipliers; xpBase/creditsBase are the pre-multiplier bases
    // (`originalXP`/`originalCredits`); repairCost is `repair` (falling back to
    // `autoRepairCost`); ammoCost is the credits part of `autoLoadCost[0]`.
    // Profit is derived in the UI: credits − repairCost − ammoCost.
    xpBase?: number; creditsBase?: number; repairCost?: number; ammoCost?: number;
  };
}
