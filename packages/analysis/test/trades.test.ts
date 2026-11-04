import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline, type BattleTimeline } from "@wotrep/model";
import { tradeSummary } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

const REC = 13908113, FOE = 13908122, TDM = 13908133;

describe("tradeSummary (#66 acceptance, Lesta fixture)", () => {
  it("totals match the recorder's 1362 damage; best exchange is 2:03 vs SBM-44 (342/104)", () => {
    const s = tradeSummary(tl);
    expect(s.subject).toBe(REC);
    expect(s.dealt).toBe(1362);
    expect(s.received).toBe(525);
    expect(s.ratio).toBeCloseTo(1362 / 525, 5);
    expect(s.exchanges).toBe(8);
    expect(s.spgDealt).toBe(0);
    expect(s.spgReceived).toBe(0);
    expect(s.best).toMatchObject({ other: FOE, dealt: 342, received: 104 });
    expect(s.best!.start).toBeCloseTo(123.2, 1);
    expect(s.best!.end).toBeCloseTo(125.3, 1);
    expect(s.best!.ratio).toBeCloseTo(342 / 104, 5);
    expect(s.worst).toMatchObject({ other: TDM, dealt: 51, received: 421 });
  });
});

describe("tradeSummary (synthetic)", () => {
  const mk = (events: BattleTimeline["events"]): BattleTimeline => ({
    schema: "wotrep.timeline/1",
    source: { realm: "wg", regionCode: "EU", server: "EU1", clientVersion: "1.0", manifest: { id: "x", confidence: "defs" }, hasMods: false, sha256: "0" },
    arena: { arenaUniqueId: "B", map: "m", mapDisplayName: "M", gameplay: "regular", battleType: 1, startedAt: "01.01.2026 00:00:00", durationS: null, winnerTeam: null, finishReason: null, battleStartClock: 0 },
    recorder: { vid: 1, team: 1, name: "A" },
    vehicles: [
      { vid: 1, team: 1, name: "A", anonymized: false, vehicleType: "t", maxHealth: 1000, isRecorder: true },
      { vid: 2, team: 2, name: "B", anonymized: false, vehicleType: "t", maxHealth: 800, isRecorder: false },
      { vid: 3, team: 2, name: "C", anonymized: false, vehicleType: "spg", maxHealth: 800, isRecorder: false },
    ],
    tracks: {}, events, camera: { t: [], mode: [] },
    diagnostics: { unknownPacketTypes: {}, warnings: [] },
  });
  const dmg = (t: number, attacker: number, target: number, amount: number): BattleTimeline["events"][number] =>
    ({ k: "damage", t, attacker, target, amount, hpBefore: 1000, hpAfter: 1000 - amount, reason: 0 });
  it("one-sided damage counts in totals but cannot be best/worst; SPG splits out", () => {
    const tl2 = mk([
      dmg(0, 1, 2, 10), dmg(5, 2, 1, 20),
      dmg(30, 1, 2, 30),
      dmg(60, 1, 3, 40), dmg(65, 3, 1, 10),
    ]);
    const s = tradeSummary(tl2, { isSpg: (v) => v.vehicleType === "spg" });
    expect(s.dealt).toBe(80);
    expect(s.received).toBe(30);
    expect(s.exchanges).toBe(3);
    expect(s.best).toMatchObject({ other: 3, dealt: 40, received: 10 });
    expect(s.worst).toMatchObject({ other: 2, dealt: 10, received: 20 });
    expect(s.spgDealt).toBe(40);
    expect(s.spgReceived).toBe(10);
  });
  it("no engagements → zeros and nulls", () => {
    const s = tradeSummary(mk([]));
    expect(s).toMatchObject({ dealt: 0, received: 0, ratio: null, exchanges: 0, best: null, worst: null });
  });
});
