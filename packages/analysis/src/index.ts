import wpCfg from "../config/wp-v0.json";
import boldCfg from "../config/boldness-v0.json";
export * from "./wp";
export * from "./heuristics";
export * from "./reload";
export * from "./boldness";
export const configs = { "wp-v0": wpCfg, "boldness-v0": boldCfg };
export * from "./series";
export * from "./heatmap";
