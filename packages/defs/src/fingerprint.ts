import { manifestSchema, type Manifest } from "./manifest";

/** One unnamed 0x08 entity-method call: kind + method index + raw args. No manifest needed to build these. */
export interface FingerprintCall { kind: "avatar" | "vehicle"; idx: number; args: Uint8Array }
export interface FingerprintContext {
  vehicleIds: ReadonlySet<number>;
  recorderVid: number;
  /** Official damageDealt for the recorder, from the results block. The health-sum check needs it. */
  recorderDamageDealt: number;
  realm: "wg" | "lesta";
  version: string;
}
/** Parser-side arena decoder (bwstring + unpickle live in the parser, not in defs). */
export type ArenaDecoder = (args: Uint8Array) => { type: number; value: unknown } | null;
export interface FingerprintResult {
  manifest: Manifest;
  methods: { onHealthChanged: number; showTracer: number; updateArena: number };
  arenaUpdateTypes: { period?: number; vehicleKilled: number };
}

const i16 = (a: Uint8Array, o: number) => new DataView(a.buffer, a.byteOffset, a.byteLength).getInt16(o, true);
const u32 = (a: Uint8Array, o: number) => new DataView(a.buffer, a.byteOffset, a.byteLength).getUint32(o, true);

/** onHealthChanged: the 9-byte vehicle method (i16 new, i16 old, u32 attacker, u8 reason) whose
 *  recorder-attacker health deltas sum exactly to the recorder's results damageDealt. Strict: an
 *  ambiguous or missing match is null, never a guess. A zero-damage recorder cannot discriminate,
 *  so it only matches when there is exactly one 9-byte vehicle method at all. */
function inferHealth(calls: FingerprintCall[], ctx: FingerprintContext): number | null {
  const sums = new Map<number, number>();
  const seen = new Set<number>();
  for (const c of calls) {
    if (c.kind !== "vehicle" || c.args.byteLength !== 9) continue;
    seen.add(c.idx);
    if (u32(c.args, 4) === ctx.recorderVid) sums.set(c.idx, (sums.get(c.idx) ?? 0) + (i16(c.args, 2) - i16(c.args, 0)));
  }
  const matches = [...sums.entries()].filter(([, s]) => s === ctx.recorderDamageDealt).map(([idx]) => idx);
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0 && ctx.recorderDamageDealt === 0 && seen.size === 1) return [...seen][0]!;
  return null;
}

/** showTracer: the avatar method whose every call is 51 bytes starting with a vehicle id. */
function inferTracer(calls: FingerprintCall[], ctx: FingerprintContext): number | null {
  const state = new Map<number, { n: number; ok: boolean }>();
  for (const c of calls) {
    if (c.kind !== "avatar") continue;
    const e = state.get(c.idx) ?? { n: 0, ok: true };
    e.n++;
    if (c.args.byteLength !== 51 || !ctx.vehicleIds.has(u32(c.args, 0))) e.ok = false;
    state.set(c.idx, e);
  }
  const matches = [...state.entries()].filter(([, e]) => e.ok && e.n > 0).map(([idx]) => idx);
  return matches.length === 1 ? matches[0]! : null;
}

/** updateArena: the variable-length avatar method whose payloads decode as bwstring+pickle.
 *  Sampled (first 25 calls); needs a ≥80% decode rate and a unique best rate. On the fixture the
 *  true method decodes 25/25 and every other variable-length avatar method 0/25. */
function inferArena(calls: FingerprintCall[], decodeArena: ArenaDecoder): number | null {
  const groups = new Map<number, FingerprintCall[]>();
  for (const c of calls) {
    if (c.kind !== "avatar") continue;
    const l = groups.get(c.idx) ?? [];
    l.push(c);
    groups.set(c.idx, l);
  }
  let best: { idx: number; rate: number } | null = null;
  let tie = false;
  for (const [idx, cs] of groups) {
    if (new Set(cs.map((c) => c.args.byteLength)).size < 3) continue;
    const sample = cs.slice(0, 25);
    const rate = sample.filter((c) => decodeArena(c.args) !== null).length / sample.length;
    if (rate < 0.8) continue;
    if (!best || rate > best.rate) { best = { idx, rate }; tie = false; }
    else if (rate === best.rate) tie = true;
  }
  return best && !tie ? best.idx : null;
}

/** Arena update types from decoded values of the updateArena method. vehicleKilled is required
 *  (without it there are no kills to decode); period is best-effort (without it battle time
 *  falls back to clock 0, but kills still decode). */
function inferArenaTypes(calls: FingerprintCall[], arenaIdx: number, decodeArena: ArenaDecoder, ctx: FingerprintContext): { period?: number; vehicleKilled: number } | null {
  const byType = new Map<number, unknown[]>();
  for (const c of calls) {
    if (c.kind !== "avatar" || c.idx !== arenaIdx) continue;
    const d = decodeArena(c.args);
    if (!d) continue;
    const l = byType.get(d.type) ?? [];
    l.push(d.value);
    byType.set(d.type, l);
  }
  let killed: { type: number; count: number } | null = null;
  for (const [type, values] of byType) {
    const count = values.filter((v) => Array.isArray(v) && v.length >= 4 && ctx.vehicleIds.has(v[0] as number) && ctx.vehicleIds.has(v[1] as number)).length;
    if (count > 0 && (!killed || count > killed.count)) killed = { type, count };
  }
  if (!killed) return null;
  let period: number | undefined;
  for (const [type, values] of byType) {
    const starts = new Set(values.filter((v) => Array.isArray(v) && typeof (v as unknown[])[0] === "number").map((v) => (v as unknown[])[0] as number));
    if (starts.has(1) && starts.has(2) && starts.has(3)) { period = type; break; }
  }
  if (period === undefined) {
    for (const [type, values] of byType) {
      if (values.some((v) => Array.isArray(v) && (v as unknown[])[0] === 3)) { period = type; break; }
    }
  }
  return { ...(period !== undefined ? { period } : {}), vehicleKilled: killed.type };
}

/** Draft manifest for a version with no manifest, or null when any required heuristic fails.
 *  Carries only the three inferred methods plus the inferred arena types; unrecognized methods
 *  stay unnamed, so their events are simply missing — never fabricated. */
export function fingerprintManifest(calls: FingerprintCall[], ctx: FingerprintContext, decodeArena: ArenaDecoder): FingerprintResult | null {
  const onHealthChanged = inferHealth(calls, ctx);
  const showTracer = inferTracer(calls, ctx);
  const updateArena = inferArena(calls, decodeArena);
  if (onHealthChanged == null || showTracer == null || updateArena == null) return null;
  const arena = inferArenaTypes(calls, updateArena, decodeArena, ctx);
  if (!arena) return null;
  const manifest = manifestSchema.parse({
    id: `fingerprint:${ctx.realm}-${ctx.version}`,
    realm: ctx.realm, version: ctx.version, confidence: "fingerprint",
    note: "Draft manifest inferred from payload shapes (E1-14): 9-byte vehicle method whose recorder health deltas sum to results damage, 51-byte avatar method starting with a vehicle id, arena method decoded as bwstring+pickle. Unrecognized methods are absent; their events are missing, never fabricated.",
    avatar: {
      showTracer: { idx: showTracer, conf: "O", args: "u32 shooterVehicleId, u32 shotId, ..." },
      updateArena: { idx: updateArena, conf: "V", args: "u8 updateType, bwstring pickle" },
    },
    vehicle: {
      onHealthChanged: { idx: onHealthChanged, conf: "V", args: "i16 newHealth, i16 oldHealth, u32 attackerId, u8 attackReason" },
    },
    vehicleProperties: {},
    arenaUpdateTypes: arena,
  });
  return { manifest, methods: { onHealthChanged, showTracer, updateArena }, arenaUpdateTypes: arena };
}
