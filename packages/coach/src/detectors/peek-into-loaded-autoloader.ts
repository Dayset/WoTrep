import { defineDetector } from "../detector";
import cfgJson from "../../config/peek-into-loaded-autoloader.json";
import { estimateReload } from "@wotrep/analysis";
import type { Finding } from "../finding";
import { subject } from "./util";

/** Peek into a loaded autoloader (E7-03, COACHING.md wave 1): the subject takes >= minHits hits
 *  from one autoloader within that gun's clip window, where the gun's previous clip ended >= its
 *  estimated reload time ago — so the gun was loaded again when the hits landed.
 *
 *  Guards, because reload timing from shots alone is an estimate (COACHING.md §2, #42):
 *  - Only full previous clips count: a partial previous burst means the gun still had shells, so
 *    no reload happened and a pause before more shots is not a peek.
 *  - The estimator's confidence must clear minConfidence: thin enemy data (few bursts) cannot
 *    support a reload claim.
 *  - Shots are only visible while the shooter is in the recorder's area of interest, so an enemy
 *    whose previous clip was never seen simply has no burst to anchor on — conservative by data
 *    availability, not by assumption. Positions (P) are not used: the trigger as specified is H+T+R.
 *  Hit windows use burst boundaries (previous burst end → next burst start), which absorbs the
 *  small timestamp skew between shot and damage packets.
 */
interface Burst { start: number; end: number; shots: number[] }

function bursts(times: number[], intraMaxS: number): Burst[] {
  const out: Burst[] = [];
  let cur: number[] = [];
  for (const t of times) {
    if (cur.length && t - cur[cur.length - 1]! > intraMaxS) { out.push({ start: cur[0]!, end: cur[cur.length - 1]!, shots: cur }); cur = []; }
    cur.push(t);
  }
  if (cur.length) out.push({ start: cur[0]!, end: cur[cur.length - 1]!, shots: cur });
  return out;
}

export const peekIntoLoadedAutoloader = defineDetector({
  id: "peek-into-loaded-autoloader", version: 1, needs: ["H", "T", "R"], config: cfgJson,
  detect({ tl, cfg, subject: subjectVid }) {
    const me = subject(tl, subjectVid);
    if (!me) return [];
    const minHits = cfg.minHits as number, minConf = cfg.minConfidence as number;
    const out: Omit<Finding, "schema" | "id" | "detector" | "detectorVersion">[] = [];
    for (const foe of tl.vehicles.filter((v) => v.team !== me.team)) {
      const shots = tl.events.flatMap((e) => (e.k === "shot" && e.shooter === foe.vid ? [e.t] : [])).sort((a, b) => a - b);
      const est = estimateReload(shots);
      if (est.clipSize <= 1 || est.reloadS == null || !est.intraMaxS || est.confidence < minConf) continue;
      const bs = bursts(shots, est.intraMaxS);
      const hits = tl.events.flatMap((e) => (e.k === "damage" && e.attacker === foe.vid && e.target === me.vid && e.amount > 0 ? [e] : [])).sort((a, b) => a.t - b.t);
      for (let i = 1; i < bs.length; i++) {
        const prev = bs[i - 1]!;
        if (prev.shots.length !== est.clipSize) continue;
        const nextStart = i + 1 < bs.length ? bs[i + 1]!.start : Infinity;
        const windowHits = hits.filter((h) => h.t > prev.end && h.t < nextStart);
        if (windowHits.length < minHits) continue;
        const first = windowHits[0]!;
        if (first.t - prev.end < est.reloadS) continue;
        const lost = windowHits.reduce((s, h) => s + h.amount, 0);
        out.push({
          vid: me.vid, kind: "mistake" as const, tStart: first.t, tEnd: windowHits[windowHits.length - 1]!.t, leadS: 3,
          cost: { hp: lost }, confidence: est.confidence,
          evidence: [
            { k: "unit" as const, vid: foe.vid, t: first.t },
            { k: "timer" as const, vid: foe.vid, t: first.t, label: "reload", secondsLeft: Math.round(est.reloadS * 100) / 100 },
            { k: "line" as const, from: foe.vid, to: me.vid, t: first.t, style: "threat" as const },
            { k: "number" as const, label: "hp lost", value: lost, unit: "hp" },
          ],
          messageKey: "coach.peekIntoLoadedAutoloader", params: { got: lost, enemy: foe.name },
          guide: "autoloader-timing", drill: true,
        });
      }
    }
    return out;
  },
});
