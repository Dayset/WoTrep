import { defineDetector } from "../detector";
import cfgJson from "../../config/exposed-while-reloading.json";
import { estimateReload, reloadStateAt, shotTimes } from "@wotrep/analysis";
import { stateAt } from "@wotrep/model";
import type { Finding } from "../finding";
import { subject } from "./util";

/** Exposed while reloading (E7-08, COACHING.md wave 1, mistake): the subject took damage while its own
 *  reload had more than minReloadLeftS left and it had moved less than maxMoveM since its last shot.
 *  One finding per reload (grouped by the preceding last shot), cost = damage taken in the group.
 *
 *  reloadStateAt already encodes the full-clip guard: a partial trailing burst reads "bursting" or
 *  "ready", never "reloading". Single-shot guns (clipSize 1) and low-confidence estimates
 *  (< minConfidence) never fire: the peek-shoot-hide pattern is an autoloader pattern, and a
 *  single-shot cycle is not a reload in this sense (same guard family as peek/punished-reload).
 *
 *  Evidence: the subject's actual path from the last shot to the last hit, plus a suggested-cover
 *  zone when the first hit's attacker position is known: 50 m (suggestDistM) directly away from
 *  the attacker. There is no cover geometry in v1, so the zone marks the retreat direction, not a
 *  proven safe spot; without a known attacker position the zone is omitted rather than guessed.
 */
export const exposedWhileReloading = defineDetector({
  id: "exposed-while-reloading", version: 1, needs: ["H", "T", "R"], config: cfgJson,
  detect({ tl, cfg, subject: subjectVid }) {
    const me = subject(tl, subjectVid);
    if (!me) return [];
    const minReloadLeftS = cfg.minReloadLeftS as number, maxMoveM = cfg.maxMoveM as number, minConfidence = cfg.minConfidence as number;
    const suggestDistM = cfg.suggestDistM as number, suggestRadiusM = cfg.suggestRadiusM as number;
    const shots = shotTimes(tl, me.vid);
    const est = estimateReload(shots);
    if (est.clipSize <= 1 || est.confidence < minConfidence || est.reloadS == null) return [];
    // only live positions: a ghost is the last spotted spot, so movement measured from it is not movement
    const posAt = (t: number) => { const u = stateAt(tl, t).units.find((x) => x.vid === me.vid); return u && u.known === "live" ? u : null; };
    const groups = new Map<number, { hits: { t: number; amount: number; attacker: number }[]; lastShot: number; left0: number }>();
    for (const e of tl.events) {
      if (e.k !== "damage" || e.target !== me.vid) continue;
      const state = reloadStateAt(shots, est, e.t);
      if (state.state !== "reloading" || state.secondsLeft <= minReloadLeftS) continue;
      const seen = shots.filter((s) => s <= e.t);
      const lastShot = seen.at(-1); if (lastShot == null) continue;
      const p0 = posAt(lastShot), p1 = posAt(e.t);
      if (!p0 || !p1) continue;
      const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      if (moved >= maxMoveM) continue;
      const g = groups.get(lastShot) ?? { hits: [], lastShot, left0: state.secondsLeft };
      g.hits.push({ t: e.t, amount: e.amount, attacker: e.attacker });
      groups.set(lastShot, g);
    }
    const out: Omit<Finding, "schema" | "id" | "detector" | "detectorVersion">[] = [];
    for (const g of groups.values()) {
      const first = g.hits[0]!, last = g.hits[g.hits.length - 1]!;
      const total = g.hits.reduce((s, h) => s + h.amount, 0);
      const p0 = posAt(g.lastShot)!, p1 = posAt(first.t)!;
      const moved0 = Math.round(Math.hypot(p1.x - p0.x, p1.z - p0.z) * 10) / 10;
      const att = stateAt(tl, first.t).units.find((x) => x.vid === first.attacker);
      let zone: { k: "zone"; x: number; z: number; r: number; style: "suggested" } | null = null;
      if (att && att.known !== "never") {
        const dx = p1.x - att.x, dz = p1.z - att.z, d = Math.hypot(dx, dz);
        if (d > 0) zone = { k: "zone" as const, x: p1.x + (dx / d) * suggestDistM, z: p1.z + (dz / d) * suggestDistM, r: suggestRadiusM, style: "suggested" as const };
      }
      out.push({
        vid: me.vid, kind: "mistake" as const, tStart: first.t, tEnd: last.t, leadS: 3,
        cost: { hp: total }, confidence: est.confidence,
        evidence: [
          { k: "path" as const, vid: me.vid, t0: g.lastShot, t1: last.t, style: "actual" as const },
          ...(zone ? [zone] : []),
          { k: "timer" as const, vid: me.vid, t: first.t, label: "reload", secondsLeft: Math.round(g.left0 * 100) / 100 },
          { k: "number" as const, label: "damage", value: total, unit: "hp" },
        ],
        messageKey: "coach.exposedWhileReloading", params: { dmg: total, moved: moved0 }, guide: "peek-shoot-hide",
      });
    }
    return out;
  },
});
