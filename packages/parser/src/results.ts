import type { BattleEvent, BattleResults, PlayerResult } from "@wotrep/model";

/** Normalise block 1 `[battleResults, …]`. Never reads realName. */
export function normalizeResults(block1: unknown): { results: BattleResults; common: any; accountOf: Record<number, number> } | null {
  const r = Array.isArray(block1) ? (block1[0] as any) : null;
  if (!r || !r.vehicles) return null;
  const players: Record<number, PlayerResult> = {}; const accountOf: Record<number, number> = {};
  for (const [sid, lst] of Object.entries<any>(r.vehicles)) {
    const v = lst?.[0]; if (!v) continue;
    accountOf[Number(sid)] = v.accountDBID;
    players[Number(sid)] = {
      damageDealt: v.damageDealt, assistRadio: v.damageAssistedRadio, assistTrack: v.damageAssistedTrack, assistStun: v.damageAssistedStun ?? 0,
      blocked: v.damageBlockedByArmor, kills: v.kills, spotted: v.spotted, shots: v.shots, hits: v.directEnemyHits, pens: v.piercingEnemyHits,
      damageReceived: v.damageReceived, lifeTimeS: v.lifeTime, deathReason: v.deathReason, killerVid: v.killerID || null, mileageM: v.mileage,
      xp: v.xp, capturePoints: v.capturePoints ?? 0, droppedCapturePoints: v.droppedCapturePoints ?? 0,
    };
  }
  const pa = Object.entries<any>(r.personal ?? {}).find(([k]) => k !== "avatar")?.[1];
  const personal = pa && {
    movingAvgDamage: pa.movingAvgDamage, damageRating: pa.damageRating, marksOnGun: pa.marksOnGun, xp: pa.xp, credits: pa.credits,
    potentialDamageReceived: pa.potentialDamageReceived, damageReceivedFromInvisibles: pa.damageReceivedFromInvisibles,
    noDamageDirectHitsReceived: pa.noDamageDirectHitsReceived,
    // Battle economy: totals are xp/credits above; bases and costs were dropped
    // before, so a replay's end-screen numbers (base → total, repair, ammo,
    // profit) could not be shown. autoLoadCost is [credits, gold]; only the
    // credits part is the ammo cost on the end screen. Fields are added only
    // when present: an undefined-valued key would fail timeline validation
    // and the compact codec, which both expect numbers.
    ...(pa.originalXP != null ? { xpBase: pa.originalXP } : {}),
    ...(pa.originalCredits != null ? { creditsBase: pa.originalCredits } : {}),
    ...((pa.repair ?? pa.autoRepairCost) != null ? { repairCost: pa.repair ?? pa.autoRepairCost } : {}),
    ...(Array.isArray(pa.autoLoadCost) && pa.autoLoadCost[0] != null ? { ammoCost: pa.autoLoadCost[0] } : {}),
  };
  return { results: { players, ...(personal ? { personal } : {}) }, common: r.common, accountOf };
}

/** Kills rebuilt from results when the client version has no decoded kill message. Victim, killer and reason are exact; time is lifeTime + 0.5 s
 *  (lifeTime is whole seconds; on the Lesta fixture the real kill time is 0..1 s after it, all 24 killers and reasons match). */
export function killsFromResults(results: BattleResults): BattleEvent[] {
  return Object.entries(results.players).filter(([, p]) => p.deathReason != null && p.deathReason >= 0 && p.lifeTimeS != null)
    .map(([vid, p]): BattleEvent => ({ k: "kill", t: Math.round((p.lifeTimeS + 0.5) * 100) / 100, victim: Number(vid), killer: p.killerVid ?? 0, reason: p.deathReason, equipment: 0 }))
    .sort((a, b) => a.t - b.t);
}
