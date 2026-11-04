import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildEngagements, validateTimeline, type BattleTimeline } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

/** Recorder YurOk_Zp (SBM-44) vs enemy SBM-44 sergey126161, docs/analysis/first-replay.md 2:03–2:05. */
const REC = 13908113, FOE = 13908122;

describe("buildEngagements (#39 acceptance, Lesta fixture)", () => {
  it("recorder vs enemy SBM-44 at 2:03–2:05 is one engagement 342 / 104, initiator = recorder", () => {
    const pair = buildEngagements(tl).filter((e) => e.a === REC && e.b === FOE);
    expect(pair).toHaveLength(2);
    const duel = pair[0]!;
    expect(duel.start).toBeCloseTo(123.2, 1);
    expect(duel.end).toBeCloseTo(125.3, 1);
    expect(duel.initiator).toBe(REC);
    expect(duel.dealtByA).toBe(342);
    expect(duel.dealtByB).toBe(104);
    expect(duel.hpA).toEqual({ before: 1350, after: 1246 });
    expect(duel.hpB).toEqual({ before: 899, after: 557 });
    expect(duel.shots).toBe(9);
    const late = pair[1]!;
    expect(late.start).toBeCloseTo(244.8, 1);
    expect(late.dealtByA).toBe(49);
    expect(late.dealtByB).toBe(0);
    expect(late.hpA).toEqual({ before: 1350, after: 1350 });
    expect(late.hpB).toEqual({ before: 123, after: 74 });
  });
});

describe("buildEngagements (synthetic)", () => {
  const mk = (events: BattleTimeline["events"]): BattleTimeline => ({
    schema: "wotrep.timeline/1",
    source: { realm: "wg", regionCode: "EU", server: "EU1", clientVersion: "1.0", manifest: { id: "x", confidence: "defs" }, hasMods: false, sha256: "0" },
    arena: { arenaUniqueId: "B", map: "m", mapDisplayName: "M", gameplay: "regular", battleType: 1, startedAt: "01.01.2026 00:00:00", durationS: null, winnerTeam: null, finishReason: null, battleStartClock: 0 },
    recorder: { vid: 1, team: 1, name: "A" },
    vehicles: [
      { vid: 1, team: 1, name: "A", anonymized: false, vehicleType: "t", maxHealth: 1000, isRecorder: true },
      { vid: 2, team: 2, name: "B", anonymized: false, vehicleType: "t", maxHealth: 800, isRecorder: false },
    ],
    tracks: {}, events, camera: { t: [], mode: [] },
    diagnostics: { unknownPacketTypes: {}, warnings: [] },
  });
  const dmg = (t: number, attacker: number, target: number, amount: number, hpBefore: number, hpAfter: number): BattleTimeline["events"][number] =>
    ({ k: "damage", t, attacker, target, amount, hpBefore, hpAfter, reason: 0 });
  it("splits on gaps >= gapS, chains below it, and attaches reload states at start", () => {
    const tl2 = mk([
      dmg(0, 1, 2, 10, 800, 790), dmg(5, 2, 1, 20, 1000, 980),
      dmg(20, 1, 2, 30, 790, 760),
    ]);
    const seen: [number, number][] = [];
    const out = buildEngagements(tl2, { gapS: 12, reloadAt: (vid, t) => { seen.push([vid, t]); return { state: "ready", secondsLeft: 0 }; } });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ start: 0, end: 5, initiator: 1, dealtByA: 10, dealtByB: 20 });
    expect(out[1]).toMatchObject({ start: 20, end: 20, initiator: 1, dealtByA: 30, dealtByB: 0 });
    expect(out[0]!.reloadA).toEqual({ state: "ready", secondsLeft: 0 });
    expect(seen).toEqual([[1, 0], [2, 0], [1, 20], [2, 20]]);
  });
  it("ignores self-damage and non-damage events", () => {
    const tl2 = mk([
      dmg(0, 1, 1, 50, 1000, 950),
      { k: "kill", t: 1, victim: 2, killer: 1, reason: 0, equipment: 0 },
    ]);
    expect(buildEngagements(tl2)).toEqual([]);
  });
});
