export const name = "@wotrep/coach";
export * from "./finding";
export * from "./config";
export * from "./detector";
export * from "./rank";
import { earlyHpDump } from "./detectors/early-hp-dump";
export { earlyHpDump };
/** Every shipped detector, in a fixed order (snapshot stability). */
export const detectors = [earlyHpDump];
