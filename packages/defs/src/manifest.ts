import { z } from "zod";
import lesta1460 from "../manifests/lesta-1.46.0.0.json";
import wg2410 from "../manifests/wg-2.4.1.0.json";

const entry = z.object({ idx: z.number().int().nonnegative(), conf: z.enum(["V", "O", "?"]), args: z.string().optional() });
export const manifestSchema = z.object({
  id: z.string(), realm: z.enum(["wg", "lesta"]), version: z.string(),
  confidence: z.enum(["defs", "fingerprint", "fallback"]), note: z.string().optional(),
  avatar: z.record(entry), vehicle: z.record(entry), vehicleProperties: z.record(entry.omit({ args: true })),
  arenaUpdateTypes: z.record(z.number().int()),
});
export type Manifest = z.infer<typeof manifestSchema>;

const BUILT_IN: Manifest[] = [manifestSchema.parse(lesta1460), manifestSchema.parse(wg2410)];
export type Resolution = { manifest: Manifest; exact: boolean } | { manifest: null; reason: string };

/** Exact match first; then same major.minor of the same realm, flagged `confidence: "fallback"`. Never throws. */
export function resolveManifest(realm: "wg" | "lesta", version: string, extra: Manifest[] = []): Resolution {
  const all = [...BUILT_IN, ...extra].filter((m) => m.realm === realm);
  const exact = all.find((m) => m.version === version);
  if (exact) return { manifest: exact, exact: true };
  const mm = (v: string) => v.split(".").slice(0, 2).join(".");
  const near = all.find((m) => mm(m.version) === mm(version));
  if (near) return { manifest: { ...near, confidence: "fallback" }, exact: false };
  return { manifest: null, reason: `no manifest for ${realm} ${version} (have: ${all.map((m) => m.version).join(", ") || "none"})` };
}
