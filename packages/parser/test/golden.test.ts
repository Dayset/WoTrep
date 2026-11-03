import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseReplay } from "../src/index";
import type { BattleTimeline } from "@wotrep/model";

const rd = (p: string) => readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url));
const exp = JSON.parse(rd("expected/lesta-1.46-overlord-sbm44.expected.json").toString());
const mock = JSON.parse(rd("timelines/lesta-1.46-overlord-sbm44.timeline.json").toString()) as BattleTimeline;
let tl: BattleTimeline; let ms = 0;
beforeAll(async () => { const t = performance.now(); tl = await parseReplay(new Uint8Array(rd("replays/lesta-1.46-overlord-sbm44.mtreplay")), "x.mtreplay"); ms = performance.now() - t; });

describe("parseReplay golden (TS parser vs Python oracle)", () => {
  it("meta", () => {
    expect(tl.source.clientVersion).toBe(exp.clientVersion); expect(tl.arena.map).toBe(exp.map);
    expect(tl.recorder.vid).toBe(exp.recorder.vehicleId); expect(tl.arena.battleStartClock).toBeCloseTo(exp.battleStartClock, 2);
    expect(tl.arena.winnerTeam).toBe(exp.winnerTeam); expect(tl.arena.durationS).toBe(exp.battleDurationResults);
  });
  it("kills identical to the oracle, same order", () => {
    const k = tl.events.filter((e) => e.k === "kill") as any[];
    expect(k.map((e) => [e.victim, e.killer, e.reason])).toEqual(exp.kills.map((e: any) => [e.victim, e.killer, e.reason]));
  });
  it("recorder damage, shots, camera", () => {
    const d = (tl.events as any[]).filter((e) => e.k === "damage" && e.attacker === tl.recorder.vid && e.target !== tl.recorder.vid);
    expect(d.length).toBe(exp.recorderDamageDealtEvents); expect(d.reduce((s, e) => s + e.amount, 0)).toBe(exp.recorderDamageDealtSum);
    expect((tl.events as any[]).filter((e) => e.k === "shot" && e.shooter === tl.recorder.vid).length).toBe(exp.recorderTracers);
    expect(tl.camera.t.length).toBe(exp.cameraModeChanges);
    expect(tl.results!.players[tl.recorder.vid]!.damageDealt).toBe(exp.resultsCrossCheck.damageDealt);
  });
  it("position sample counts equal the oracle", () => {
    const got: Record<string, number> = {}; for (const [k, t] of Object.entries(tl.tracks)) got[k] = t.t.length;
    expect(got).toEqual(exp.positionSamplesPerVehicle);
  });
  it("matches the mock timeline on structure and counts", () => {
    for (const k of ["damage", "kill", "shot", "period"]) expect(tl.events.filter((e) => e.k === k).length).toBe(mock.events.filter((e) => e.k === k).length);
    expect(Object.keys(tl.tracks).sort()).toEqual(Object.keys(mock.tracks).sort());
    expect(tl.vehicles.filter((v) => v.anonymized).map((v) => v.vid).sort()).toEqual(mock.vehicles.filter((v) => v.anonymized).map((v) => v.vid).sort());
    const t = Object.values(tl.tracks)[0]!, m = Object.values(mock.tracks)[0]!;
    expect(t.visible.length).toBe(m.visible.length);
  });
  it("never leaks real names of anonymized players", () => {
    const s = JSON.stringify(tl);
    for (const n of ["Tankist_iz_1941", "robhaman_GTX", "Kun9lToBcKuY", "leprikon"]) expect(s).not.toContain(n);
    for (const v of tl.vehicles.filter((v) => v.anonymized)) { expect(v.accountId).toBeUndefined(); expect(v.clan).toBeUndefined(); }
  });
  it("is fast (< 600 ms)", () => expect(ms).toBeLessThan(600));
});

describe("stopTracer end points", () => {
  it("decodes an end point for most shots and every end matches a shot", async () => {
    const ends = (tl.events as any[]).filter((e) => e.k === "projectileEnd"), ids = new Set((tl.events as any[]).filter((e) => e.k === "shot").map((e) => e.shotId));
    expect(ends.length).toBe(584); expect(ends.every((e) => ids.has(e.shotId))).toBe(true);
    expect(ends.every((e) => e.x > -400 && e.x < 800 && e.z > -600 && e.z < 600)).toBe(true);
  });
});
