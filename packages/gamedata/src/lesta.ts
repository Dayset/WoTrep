import { z } from "zod";

/** Normalises the Lesta/WG `encyclopedia/vehicles` response. Only fields we are certain of are interpreted;
 *  `default_profile` is kept exactly as returned until we have looked at real output (no guessed gun fields). */
const Vehicle = z.object({
  tag: z.string().min(1), name: z.string().min(1), short_name: z.string().optional(),
  tier: z.number().int().min(1).max(11), type: z.string(), nation: z.string(), default_profile: z.unknown().optional(),
}).passthrough();
const Page = z.object({ status: z.literal("ok"), meta: z.object({ count: z.number(), page_total: z.number().optional() }).passthrough(), data: z.record(z.string(), Vehicle) });

export interface VehicleRecord { tag: string; name: string; short?: string; tier: number; type: string; nation: string; profile?: unknown }
export function normalizePage(json: unknown): VehicleRecord[] {
  const p = Page.parse(json);
  return Object.values(p.data).map((v) => ({ tag: v.tag, name: v.name, short: v.short_name, tier: v.tier, type: v.type, nation: v.nation, profile: v.default_profile }));
}
export const tagKey = (nation: string, tag: string) => `${nation}:${tag}`;
