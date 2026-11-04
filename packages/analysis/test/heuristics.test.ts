import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline, type BattleTimeline, type PlayerResult } from "@wotrep/model";
import { boldnessAll, estimateReload, reloadStateAt, shotTimes, playerHeuristics, playerMetrics, playerStats, recorderHeuristics, wpOf, wpSeries } from "../src/index";
import { stateAt } from "@wotrep/model";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("analysis on the fixture", () => {
  it("win probability starts near even and the winning team ends ahead", () => {
    const s = wpSeries(tl, tl.recorder.team);
    expect(Math.abs(s.wp[0]! - 0.5)).toBeLessThan(0.05);
    expect(s.wp.at(-1)!).toBeGreaterThan(0.9);
    expect(wpOf(stateAt(tl, 0), 1) + wpOf(stateAt(tl, 0), 2)).toBeCloseTo(1, 5);
  });
  it("DPM = damage per life minute", () => {
    const me = playerMetrics(tl).find((p) => p.vid === tl.recorder.vid)!;
    expect(me.damage).toBe(1362); expect(me.dpm).toBe(Math.round(1362 / (327 / 60)));
  });
  it("recorder heuristics account for all 1,362 damage and are internally consistent", () => {
    const h = recorderHeuristics(tl)!;
    expect(h.damage).toBe(1362);
    expect(h.cleanupShare).toBeGreaterThanOrEqual(0); expect(h.cleanupShare).toBeLessThanOrEqual(1);
    expect(h.shareOnThreats).toBeGreaterThan(0); expect(h.threatWeighted).toBeGreaterThan(0);
    expect(h.best).not.toBeNull();
    expect(h.coverage).toBe(1);
  });
  it("any player: hits only land on the other team, per-hit damage never exceeds the official total", () => {
    const team = new Map(tl.vehicles.map((v) => [v.vid, v.team]));
    let seen = 0, official = 0;
    for (const v of tl.vehicles) {
      const h = playerHeuristics(tl, v.vid)!;
      expect(h.damage).toBeLessThanOrEqual((tl.results!.players[v.vid]?.damageDealt ?? 0) + 0);
      expect(h.coverage).toBeGreaterThanOrEqual(0); expect(h.coverage).toBeLessThanOrEqual(1);
      for (const x of h.hits) expect(team.get(x.target)).not.toBe(v.team);
      seen += h.damage; official += tl.results!.players[v.vid]?.damageDealt ?? 0;
    }
    expect(seen / official).toBeGreaterThan(0.8);
  });
  it("Impact of every player on a team, from that team's own win probability, is finite", () => {
    for (const v of tl.vehicles) expect(Number.isFinite(playerHeuristics(tl, v.vid)!.impactPts)).toBe(true);
  });
  it("accuracy, pen rate and life share match the results and stay in [0,1]", () => {
    const me = playerStats(tl).find((p) => p.vid === tl.recorder.vid)!, r = tl.results!.players[tl.recorder.vid]!;
    expect(me.accuracy).toBeCloseTo(r.hits / r.shots, 10); expect(me.penRate).toBeCloseTo(r.pens / r.hits, 10);
    for (const p of playerStats(tl)) for (const x of [p.accuracy, p.penRate, p.lifeShare]) if (x != null) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
  });
  it("reload estimator learns the recorder's clip from observed shots and its state is consistent", () => {
    const ts = shotTimes(tl, tl.recorder.vid), est = estimateReload(ts);
    expect(est.clipSize).toBe(10); expect(est.intraMaxS).toBeGreaterThan(0.5); expect(est.reloadS).toBeGreaterThan(est.intraMaxS); expect(est.confidence).toBeGreaterThan(0.3);
    // end of the first full burst: a shot of a 10-shot run followed by a long gap
    let run = 1, end = -1;
    for (let i = 1; i < ts.length && end < 0; i++) { if (ts[i]! - ts[i - 1]! <= est.intraMaxS) run++; else { if (run === est.clipSize) end = i - 1; run = 1; } }
    expect(end).toBeGreaterThan(0);
    expect(reloadStateAt(ts, est, ts[0]! - 1).state).toBe("unknown");
    const r = reloadStateAt(ts, est, ts[end]! + 0.5); expect(r.state).toBe("reloading"); expect(r.secondsLeft).toBeGreaterThan(0);
    expect(reloadStateAt(ts, est, ts[end]! + est.reloadS! + 0.5).state).toBe("ready");
  });
  it("single-shot and empty inputs degrade safely", () => {
    expect(estimateReload([]).confidence).toBe(0); expect(estimateReload([5]).clipSize).toBe(1);
    const e = estimateReload([0, 8, 16.2, 24.1, 32.5, 41, 49.2]); expect(e.clipSize).toBe(1); expect(e.reloadS).toBeCloseTo(7.9, 1);
  });
  it("boldness: rates are in [0,1], counts are consistent, tiny samples give no rate", () => {
    const b = boldnessAll(tl); let withRate = 0;
    for (const x of b.values()) {
      expect(x.taken).toBeLessThanOrEqual(x.episodes); expect(x.openSeconds).toBeGreaterThanOrEqual(x.episodes);
      if (x.rate != null) { withRate++; expect(x.rate).toBeGreaterThanOrEqual(0); expect(x.rate).toBeLessThanOrEqual(1); expect(x.episodes).toBeGreaterThanOrEqual(3); }
    }
    expect(withRate).toBeGreaterThan(5);
    for (const x of b.values()) { expect(x.rewarded + x.costly + x.flat).toBe(x.taken); expect(x.flat).toBeGreaterThanOrEqual(0); if (x.style === "safe") expect(x.rate!).toBeLessThan(0.35); if (x.rate == null) expect(x.style).toBeNull(); }
    console.log("BOLD", JSON.stringify([...b.values()].map((x) => [x.vid === tl.recorder.vid ? "ME" : x.vid % 100, x.episodes, x.taken, x.rewarded, x.costly, x.style])));
  });
  it("fixture: clutch share is finite", () => {
    const h = recorderHeuristics(tl)!;
    expect(Number.isFinite(h.clutchShare)).toBe(true);
    console.log("FIXTURE-65", JSON.stringify({ cleanup: h.cleanupShare, threat: h.threatWeighted, threatPer: h.threatWeightedPerDamage, clutch: h.clutchShare, impact: h.impactPts }));
  });
  it("a continuously firing gun (no burst structure, sub-second gaps) never gets a trusted reload", () => {
    const ts = Array.from({ length: 40 }, (_, i) => i * 0.4 + (i % 7 === 0 ? 0.05 : 0));
    expect(estimateReload(ts).confidence).toBeLessThanOrEqual(0.2);
  });
});

type MiniVeh = { vid: number; team: 1 | 2; maxHealth: number; dmg: number; lifeS: number };
const pres = (dmg: number, lifeS: number): PlayerResult => ({ damageDealt: dmg, assistRadio: 0, assistTrack: 0, assistStun: 0, blocked: 0, kills: 0, spotted: 0, shots: 0, hits: 0, pens: 0, damageReceived: 0, lifeTimeS: lifeS, deathReason: 0, killerVid: null, mileageM: 0, xp: 0, capturePoints: 0, droppedCapturePoints: 0 });
const mini = (vehs: MiniVeh[], events: BattleTimeline["events"]): BattleTimeline => ({
  schema: "wotrep.timeline/1",
  source: { realm: "lesta", regionCode: "eu", server: "eu", clientVersion: "1.0", manifest: { id: "x", confidence: "none" }, hasMods: false, sha256: "x" },
  arena: { arenaUniqueId: "x", map: "x", mapDisplayName: "x", gameplay: "x", battleType: 0, startedAt: "x", durationS: 60, winnerTeam: 2, finishReason: 0, battleStartClock: 0 },
  recorder: { vid: 1, team: 1, name: "Rec" },
  vehicles: vehs.map((v) => ({ vid: v.vid, team: v.team, name: `V${v.vid}`, anonymized: false, vehicleType: "HT", maxHealth: v.maxHealth, isRecorder: v.vid === 1 })),
  tracks: {},
  events,
  camera: { t: [], mode: [] },
  results: { players: Object.fromEntries(vehs.map((v) => [v.vid, pres(v.dmg, v.lifeS)])) },
  diagnostics: { unknownPacketTypes: {}, warnings: [] },
});
const dmg = (t: number, attacker: number, target: number, amount: number, hpBefore: number, hpAfter: number): BattleTimeline["events"][number] =>
  ({ k: "damage", t, target, attacker, amount, hpBefore, hpAfter, reason: 0 });

describe("synthetic timelines: cleanup, threat, clutch", () => {
  it("cleanup: a hit at WP 0.99 counts, a hit at WP 0.50 does not", () => {
    const strong = mini(
      [{ vid: 1, team: 1, maxHealth: 1500, dmg: 100, lifeS: 300 }, { vid: 2, team: 2, maxHealth: 100, dmg: 0, lifeS: 300 }],
      [dmg(10, 1, 2, 50, 100, 50)],
    );
    const even = mini(
      [{ vid: 1, team: 1, maxHealth: 1500, dmg: 100, lifeS: 300 }, { vid: 2, team: 2, maxHealth: 1500, dmg: 0, lifeS: 300 }],
      [dmg(10, 1, 2, 500, 1500, 1000)],
    );
    expect(playerHeuristics(strong, 1)!.cleanupShare).toBe(1);
    expect(playerHeuristics(even, 1)!.cleanupShare).toBe(0);
  });
  it("threat: weight follows (dpm × hp) vs the foes' median, not dpm alone", () => {
    // A: dpm 2400, B: dpm 600. Hit 1: both at full HP, median (dpm×hp) = 2,250,000 → w_A = 1.6.
    // Hit 2: A is down to 1000 HP, median = 1,650,000 → w_B = 0.55 (dpm-only would give 0.40).
    const t = mini(
      [
        { vid: 1, team: 1, maxHealth: 1500, dmg: 1000, lifeS: 300 },
        { vid: 2, team: 2, maxHealth: 1500, dmg: 12000, lifeS: 300 },
        { vid: 3, team: 2, maxHealth: 1500, dmg: 3000, lifeS: 300 },
      ],
      [dmg(10, 1, 2, 500, 1500, 1000), dmg(20, 1, 3, 500, 1500, 1000)],
    );
    const h = playerHeuristics(t, 1)!;
    expect(h.hits.map((x) => x.threat)).toEqual([1.6, 0.55]);
    expect(h.threatWeighted).toBe(1073);
    expect(h.shareOnThreats).toBe(0.5);
  });
  it("clutch: only Impact earned below WP 0.40 counts", () => {
    // WP before the three hits: 0.013, 0.024, 0.50 — the first two are clutch, the third is not.
    const t = mini(
      [{ vid: 1, team: 1, maxHealth: 100, dmg: 1500, lifeS: 300 }, { vid: 2, team: 2, maxHealth: 1500, dmg: 0, lifeS: 300 }],
      [dmg(10, 1, 2, 500, 1500, 1000), dmg(20, 1, 2, 900, 1000, 100), dmg(30, 1, 2, 100, 100, 0)],
    );
    const h = playerHeuristics(t, 1)!;
    const d = (x: number) => (wpOf(stateAt(t, x), 1) - wpOf(stateAt(t, x - 0.001), 1)) * 100;
    const expected = (d(10) + d(20)) / (d(10) + d(20) + d(30));
    expect(h.clutchShare).toBeGreaterThan(0);
    expect(h.clutchShare).toBeLessThan(1);
    expect(h.clutchShare).toBeCloseTo(expected, 9);
    const even = mini(
      [{ vid: 1, team: 1, maxHealth: 1500, dmg: 100, lifeS: 300 }, { vid: 2, team: 2, maxHealth: 1500, dmg: 0, lifeS: 300 }],
      [dmg(10, 1, 2, 500, 1500, 1000)],
    );
    expect(playerHeuristics(even, 1)!.clutchShare).toBe(0);
  });
});

