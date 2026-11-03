import type { BattleResults, PlayerResult } from "@wotrep/model";

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
  };
  return { results: { players, ...(personal ? { personal } : {}) }, common: r.common, accountOf };
}
