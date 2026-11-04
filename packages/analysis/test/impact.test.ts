import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stateAt, validateTimeline, type BattleTimeline } from "@wotrep/model";
import { impactByPlayer, impactEvents } from "../src/impact";
import { wpOf } from "../src/wp";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

const mini = (events: BattleTimeline["events"]): BattleTimeline => ({
  schema: "wotrep.timeline/1",
  source: { realm: "lesta", regionCode: "eu", server: "eu", clientVersion: "1.0", manifest: { id: "x", confidence: "none" }, hasMods: false, sha256: "x" },
  arena: { arenaUniqueId: "x", map: "x", mapDisplayName: "x", gameplay: "x", battleType: 0, startedAt: "x", durationS: 60, winnerTeam: 2, finishReason: 0, battleStartClock: 0 },
  recorder: { vid: 1, team: 1, name: "Rec" },
  vehicles: [
    { vid: 1, team: 1, name: "Rec", anonymized: false, vehicleType: "HT", maxHealth: 1500, isRecorder: true },
    { vid: 2, team: 2, name: "Foe", anonymized: false, vehicleType: "HT", maxHealth: 1500, isRecorder: false },
  ],
  tracks: {},
  events,
  camera: { t: [], mode: [] },
  diagnostics: { unknownPacketTypes: {}, warnings: [] },
});

describe("impact", () => {
  it("fixture: per-team credited sums match the full WP swing within the §3.2 ±2 points", () => {
    const by = impactByPlayer(tl);
    const total = (team: 1 | 2) => by.filter((p) => p.team === team).reduce((s, p) => s + p.dealt + p.taken, 0);
    const swing = (wpOf(stateAt(tl, tl.arena.durationS ?? 328), 1) - wpOf(stateAt(tl, 0), 1)) * 100;
    expect(Math.abs(total(1) - swing)).toBeLessThanOrEqual(2);
    expect(Math.abs(total(2) + swing)).toBeLessThanOrEqual(2);
  });
  it("fixture: recorder Impact is +9.07 points dealt, −0.78 taken, 1362 damage in 28 hits", () => {
    const rec = impactByPlayer(tl).find((p) => p.vid === tl.recorder.vid)!;
    expect(rec.dealt).toBeCloseTo(9.073, 3);
    expect(rec.taken).toBeCloseTo(-0.776, 3);
    expect(rec.damage).toBe(1362);
    expect(rec.hits).toBe(28);
    expect(rec.byMinute.length).toBe(6);
    expect(rec.byMinute.reduce((a, b) => a + b, 0)).toBeCloseTo(rec.dealt, 9);
  });
  it("fixture: all credited Impact is zero-sum", () => {
    const by = impactByPlayer(tl);
    expect(Math.abs(by.reduce((s, p) => s + p.dealt + p.taken, 0))).toBeLessThan(1e-9);
  });
  it("synthetic: one damage tick credits exactly its WP swing to the attacker, mirrored on the target", () => {
    const t = mini([{ k: "damage", t: 10, target: 2, attacker: 1, amount: 500, hpBefore: 1500, hpAfter: 1000, reason: 0 }]);
    const dw = (wpOf(stateAt(t, 10), 1) - wpOf(stateAt(t, 9.999), 1)) * 100;
    const ev = impactEvents(t);
    expect(ev.length).toBe(1);
    expect(ev[0]!.kind).toBe("damage");
    expect(ev[0]!.dw).toBeCloseTo(dw, 9);
    const by = impactByPlayer(t);
    expect(by[0]!.dealt).toBeCloseTo(dw, 9);
    expect(by[1]!.taken).toBeCloseTo(-dw, 9);
  });
  it("synthetic: a kill-only tick credits its flip to the killer", () => {
    const t = mini([
      { k: "damage", t: 10, target: 2, attacker: 1, amount: 500, hpBefore: 1500, hpAfter: 1000, reason: 0 },
      { k: "kill", t: 20, victim: 2, killer: 1, reason: 0, equipment: 0 },
    ]);
    const dw = (wpOf(stateAt(t, 20), 1) - wpOf(stateAt(t, 19.999), 1)) * 100;
    const kill = impactEvents(t).find((e) => e.kind === "kill")!;
    expect(kill).toBeDefined();
    expect(kill.dw).toBeCloseTo(dw, 9);
    expect(impactByPlayer(t)[0]!.kills).toBe(1);
  });
});
