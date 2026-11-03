/** Anonymizer rule (docs/REPLAY_FORMAT.md §8): a player is anonymized when results `realName` differs from the in-battle name. */
export function anonymizedVids(results: any | undefined): Set<number> {
  const out = new Set<number>();
  if (!results) return out;
  for (const [sid, lst] of Object.entries<any>(results.vehicles ?? {})) {
    const pl = results.players?.[String(lst?.[0]?.accountDBID)];
    if (pl && pl.realName && pl.realName !== pl.name) out.add(Number(sid));
  }
  return out;
}
