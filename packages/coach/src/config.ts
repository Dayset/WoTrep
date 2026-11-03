import { z } from "zod";

/** Every threshold carries its provenance (contract rule 2): a value without a reason is a bug, not a config. */
const Param = z.object({
  value: z.union([z.number(), z.string(), z.boolean()]),
  why: z.string().trim().min(8, "every config value needs a real `why` (use \"initial guess, recalibrate in E13\" if it is one)"),
  n: z.number().int().nonnegative().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
export const ConfigSchema = z.record(z.string(), Param);
export type RawConfig = z.input<typeof ConfigSchema>;
export type Cfg = Record<string, number | string | boolean>;

export function loadConfig(raw: unknown, owner: string): Cfg {
  const r = ConfigSchema.safeParse(raw);
  if (!r.success) throw new Error(`config for "${owner}" is invalid: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, v.value]));
}
