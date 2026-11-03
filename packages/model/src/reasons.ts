// Attack / death reason ids as seen in replays (health-changed attackReason, kill reason). i18n key = `reason.<name>`.
export const ATTACK_REASONS: Record<number, string> = { 0: "shot", 1: "fire", 2: "ramming", 3: "worldCollision", 4: "drown" };
export const reasonKey = (id: number): string => `reason.${ATTACK_REASONS[id] ?? "unknown"}`;
