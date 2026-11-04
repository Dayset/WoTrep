import { defineDetector } from "../detector";
import cfgJson from "../../config/low-yield-clip.json";
import { shootingStats } from "@wotrep/analysis";
import type { Finding } from "../finding";
import { subject } from "./util";

/** Low-yield clips (E7-05, COACHING.md wave 1). Two findings from one clip-economy pass:
 *
 *  Per-clip mistakes: a qualifying clip (>= minShells shells) whose pen rate (attributed pens /
 *  shells) is at or below maxPenRate. Cost is damage missed against the player's own
 *  leave-one-out average damage per shell — the clip does not drag its own benchmark.
 *
 *  Summary (info, at battle end): the clips below the median clip damage, contrasted with the
 *  rest — "N clips (S shells) did X damage; the other M (T shells) did Y". The median split is
 *  parameter-free, which is why it reproduces the first-replay sentence exactly (3 clips, 31
 *  shells, 234 damage vs 3 clips, 30 shells, 1,128) while the per-clip pen rule fires only for
 *  clips 1 and 5: clip 4 deals little (136) but pens 3/10, so it belongs in the weak half of the
 *  summary without being a per-clip mistake. A below-average-damage-per-shell split gives the
 *  same set on the fixture; the median split was chosen because it needs no tuned threshold
 *  (E13 can revisit with more replays). The summary fires only when the weak half is non-empty
 *  (never for a single clip or all-equal clips) and covers qualifying clips only.
 */
export const lowYieldClip = defineDetector({
  id: "low-yield-clip", version: 1, needs: ["H", "T", "R"], config: cfgJson,
  detect({ tl, cfg, subject: subjectVid }) {
    const me = subject(tl, subjectVid);
    if (!me) return [];
    const stats = shootingStats(tl, me.vid);
    const minShells = cfg.minShells as number, maxPenRate = cfg.maxPenRate as number;
    const clips = stats.clips.filter((c) => c.shells >= minShells);
    const out: Omit<Finding, "schema" | "id" | "detector" | "detectorVersion">[] = [];
    for (const c of clips) {
      if (c.pens / c.shells > maxPenRate) continue;
      const loo = (stats.dmg - c.dmg) / Math.max(1, stats.shells - c.shells);
      const missed = Math.max(0, Math.round(loo * c.shells - c.dmg));
      out.push({
        vid: me.vid, kind: "mistake" as const, tStart: c.t0, tEnd: c.t1, leadS: 3,
        cost: { damageMissed: missed }, confidence: 0.6,
        evidence: [
          { k: "number" as const, label: "shells", value: c.shells },
          { k: "number" as const, label: "pens", value: c.pens },
          { k: "number" as const, label: "damage", value: c.dmg, unit: "hp" },
        ],
        messageKey: "coach.lowYieldClip", params: { shells: c.shells, pens: c.pens, dmg: c.dmg },
        guide: "autoloader-timing",
      });
    }
    const dmgs = clips.map((c) => c.dmg).sort((a, b) => a - b);
    if (dmgs.length >= 2) {
      const mid = dmgs.length >> 1;
      const median = dmgs.length % 2 ? dmgs[mid]! : (dmgs[mid - 1]! + dmgs[mid]!) / 2;
      const low = clips.filter((c) => c.dmg < median);
      if (low.length) {
        const high = clips.filter((c) => c.dmg >= median);
        const sum = (cs: typeof clips, k: "shells" | "dmg") => cs.reduce((s, c) => s + c[k], 0);
        const lowShells = sum(low, "shells"), lowDmg = sum(low, "dmg");
        const highShells = sum(high, "shells"), highDmg = sum(high, "dmg");
        const avg = stats.shells ? stats.dmg / stats.shells : 0;
        const missed = Math.max(0, Math.round(avg * lowShells - lowDmg));
        const end = tl.arena.durationS ?? clips[clips.length - 1]!.t1;
        out.push({
          vid: me.vid, kind: "info" as const, tStart: Math.max(0, end - 30), tEnd: end, leadS: 3,
          cost: { damageMissed: missed }, confidence: 0.8,
          evidence: [
            { k: "number" as const, label: "weak damage", value: lowDmg, unit: "hp" },
            { k: "number" as const, label: "weak shells", value: lowShells },
          ],
          messageKey: "coach.lowYieldSummary",
          params: { lowN: low.length, lowShells, lowDmg, highN: high.length, highShells, highDmg },
          guide: "autoloader-timing",
        });
      }
    }
    return out;
  },
});
