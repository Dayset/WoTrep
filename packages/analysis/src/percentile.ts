/** Percentile rank of `value` among `values`: the share at or below it, 0–100. Empty input → null.
 *  Ties count every equal value, so the best value in the set is always 100. */
export function percentileRank(values: number[], value: number): number | null {
  if (!values.length) return null;
  return Math.round((values.filter((v) => v <= value).length / values.length) * 100);
}
