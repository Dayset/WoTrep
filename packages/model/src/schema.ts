import { z } from "zod";
import type { BattleTimeline } from "./timeline";

const team = z.union([z.literal(1), z.literal(2)]);
const nums = z.array(z.number());
const track = z.object({
  t: nums, x: nums, z: nums, y: nums, yaw: nums, gunYaw: nums.optional(),
  visible: z.array(z.tuple([z.number(), z.number()])),
}).refine((o) => [o.x, o.z, o.y, o.yaw].every((a) => a.length === o.t.length), "track columns differ in length");

const event = z.discriminatedUnion("k", [
  z.object({ k: z.literal("period"), t: z.number(), period: z.number(), lengthS: z.number() }),
  z.object({ k: z.literal("spotted"), t: z.number(), vid: z.number() }),
  z.object({ k: z.literal("unspotted"), t: z.number(), vid: z.number() }),
  z.object({ k: z.literal("shot"), t: z.number(), shooter: z.number(), shotId: z.number().optional() }),
  z.object({ k: z.literal("projectileEnd"), t: z.number(), shotId: z.number(), x: z.number(), y: z.number(), z: z.number() }),
  z.object({ k: z.literal("damage"), t: z.number(), target: z.number(), attacker: z.number(), amount: z.number(), hpBefore: z.number(), hpAfter: z.number(), reason: z.number() }),
  z.object({ k: z.literal("kill"), t: z.number(), victim: z.number(), killer: z.number(), reason: z.number(), equipment: z.number() }),
  z.object({ k: z.literal("chat"), t: z.number(), team: z.enum(["ally", "enemy", "all"]), sender: z.string().optional(), text: z.string() }),
  z.object({ k: z.literal("baseCapture"), t: z.number(), team, points: z.number(), capturers: nums }),
  z.object({ k: z.literal("personal"), t: z.number(), type: z.string(), target: z.number().optional(), value: z.number().optional() }),
]);

const playerResult = z.object({
  damageDealt: z.number(), assistRadio: z.number(), assistTrack: z.number(), assistStun: z.number(), blocked: z.number(),
  kills: z.number(), spotted: z.number(), shots: z.number(), hits: z.number(), pens: z.number(), damageReceived: z.number(),
  lifeTimeS: z.number(), deathReason: z.number(), killerVid: z.number().nullable(), mileageM: z.number(), xp: z.number(),
  capturePoints: z.number(), droppedCapturePoints: z.number(),
});

export const timelineSchema = z.object({
  schema: z.literal("wotrep.timeline/1"),
  source: z.object({
    realm: z.enum(["wg", "lesta"]), regionCode: z.string(), server: z.string(), clientVersion: z.string(),
    manifest: z.object({ id: z.string(), confidence: z.enum(["defs", "fingerprint", "none"]) }),
    fileName: z.string().optional(), hasMods: z.boolean(), sha256: z.string(),
  }),
  arena: z.object({
    arenaUniqueId: z.string(), map: z.string(), mapDisplayName: z.string(), gameplay: z.string(), battleType: z.number(),
    startedAt: z.string(), durationS: z.number().nullable(), winnerTeam: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
    finishReason: z.number().nullable(), battleStartClock: z.number(),
  }),
  recorder: z.object({ vid: z.number(), team, name: z.string() }),
  vehicles: z.array(z.object({
    vid: z.number(), team, name: z.string(), anonymized: z.boolean(), clan: z.string().optional(), accountId: z.number().optional(),
    vehicleType: z.string(), maxHealth: z.number(), isRecorder: z.boolean(), platoon: z.number().optional(),
  })),
  tracks: z.record(track),
  events: z.array(event),
  camera: z.object({ t: nums, mode: z.array(z.string()) }),
  aim: z.object({ t: nums, pos: nums, dir: nums }).optional(),
  results: z.object({ players: z.record(playerResult), personal: z.record(z.number()).optional() }).optional(),
  diagnostics: z.object({ unknownPacketTypes: z.record(z.number()), warnings: z.array(z.string()) }),
});

export type ValidationResult = { ok: true; value: BattleTimeline } | { ok: false; errors: string[] };
export function validateTimeline(x: unknown): ValidationResult {
  const r = timelineSchema.safeParse(x);
  if (r.success) return { ok: true, value: r.data as BattleTimeline };
  return { ok: false, errors: r.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`) };
}
