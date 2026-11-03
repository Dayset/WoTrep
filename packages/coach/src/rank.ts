import type { Finding } from "./finding";
import { loadConfig } from "./config";
import rankConfig from "../config/rank.json";

const cfg = loadConfig(rankConfig, "rank");
/** One number for ordering only (never shown): HP + missed damage + win-probability points converted at `hpPerWpPoint`. */
export const costScore = (f: Finding) => (f.cost.hp ?? 0) + (f.cost.damageMissed ?? 0) + Math.abs(f.cost.winProbDelta ?? 0) * 100 * (cfg.hpPerWpPoint as number);

/** Default view: confident findings only, highest cost first, ≤ 5 mistakes and ≤ 3 good plays; info is kept in order. */
export function rank(findings: Finding[], opts: { showUncertain?: boolean } = {}): Finding[] {
  const ok = findings.filter((f) => opts.showUncertain || f.confidence >= (cfg.minConfidence as number));
  const by = (k: Finding["kind"], n: number) => ok.filter((f) => f.kind === k).sort((a, b) => costScore(b) - costScore(a) || a.tStart - b.tStart || a.id.localeCompare(b.id)).slice(0, n);
  return [...by("mistake", cfg.maxMistakes as number), ...by("good", cfg.maxGood as number), ...ok.filter((f) => f.kind === "info").sort((a, b) => a.tStart - b.tStart)];
}
