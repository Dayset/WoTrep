export const name = "@wotrep/coach";
export * from "./finding";
export * from "./config";
export * from "./detector";
export * from "./rank";
import { earlyHpDump } from "./detectors/early-hp-dump";
import { isolatedUnderFire } from "./detectors/isolated-under-fire";
import { badTrade, wonTrade } from "./detectors/trades";
import { idleWithTargets } from "./detectors/idle-with-targets";
import { deathRecap, survivedUnusedHp } from "./detectors/recaps";
import { lowYieldClip } from "./detectors/low-yield-clip";
import { shootingOnTheMove } from "./detectors/shooting-on-the-move";
import { punishedReload } from "./detectors/punished-reload";
import { exposedWhileReloading } from "./detectors/exposed-while-reloading";
import { peekIntoLoadedAutoloader } from "./detectors/peek-into-loaded-autoloader";
import { collision } from "./detectors/collision";
export { earlyHpDump, isolatedUnderFire, badTrade, wonTrade, idleWithTargets, deathRecap, survivedUnusedHp, lowYieldClip, shootingOnTheMove, punishedReload, exposedWhileReloading, peekIntoLoadedAutoloader, collision };
/** Every shipped detector, in a fixed order (snapshot stability). */
export const detectors = [earlyHpDump, isolatedUnderFire, badTrade, wonTrade, idleWithTargets, deathRecap, survivedUnusedHp, lowYieldClip, shootingOnTheMove, punishedReload, exposedWhileReloading, peekIntoLoadedAutoloader, collision];

/** Every i18n key stem a detector can emit (`<stem>.title` / `.body` / `.fix` must exist in en and ru; a web test checks it). */
export const MESSAGE_KEYS = ["coach.collision", "coach.earlyHpDump", "coach.isolatedUnderFire", "coach.badTrade", "coach.wonTrade", "coach.idleWithTargets", "coach.deathRecap", "coach.survivedUnusedHp", "coach.lowYieldClip", "coach.lowYieldSummary", "coach.shootingOnTheMove", "coach.punishedReload", "coach.exposedWhileReloading", "coach.peekIntoLoadedAutoloader"] as const;
export * from "./teamgood";
export * from "./danger";
