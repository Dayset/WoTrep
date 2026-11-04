/** Every number we show must say how it is obtained and what it means for the player (AGENTS.md §7).
 *  Texts live in i18n as `gl.<key>.how` and `gl.<key>.mean`; a test fails if a key here has no text in en and ru. */
export const METRIC_KEYS = ["impact", "threat", "onthreats", "cleanup", "dpm", "bold", "paid", "costly", "style", "acc", "pen", "life", "focus", "company", "hang", "rank", "spread", "align", "aimsame", "enabled", "ledger", "reinforce", "reinforced", "danger", "support", "movement"] as const;
export type MetricId = (typeof METRIC_KEYS)[number];
