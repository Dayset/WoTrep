import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline, type BattleTimeline } from "@wotrep/model";
import { coverage, playerCoverage } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("coverage", () => {
  it("the Lesta fixture: ~89% damage, kills decoded, own team fully tracked", () => {
    const c = coverage(tl); expect(c.damage!).toBeGreaterThan(0.85); expect(c.damage!).toBeLessThan(0.95); expect(c.killsDerived).toBe(false); expect(c.ownSeen!).toBeGreaterThan(0.8); expect(c.enemySeen!).toBeLessThan(c.ownSeen!);
    expect(["good", "partial"]).toContain(c.level);
  });
  it("drops to low when most damage events are missing", () => {
    const thin = { ...tl, events: tl.events.filter((e) => e.k !== "damage") }; expect(coverage(thin).level).toBe("low");
  });
});

describe("playerCoverage", () => {
  /** 100 s battle: recorder + ally (died at 50) sampled every 2 s; one enemy visible 10–30 s only; one enemy with no track. */
  const synth = (): BattleTimeline => {
    const range = (n: number) => Array.from({ length: n + 1 }, (_, i) => i * 2);
    const track = (t: number[], visible: [number, number][]) => ({ t, x: t.map(() => 0), z: t.map(() => 0), y: t.map(() => 0), yaw: t.map(() => 0), visible });
    return {
      schema: "wotrep.timeline/1",
      source: { realm: "wg", regionCode: "EU", server: "EU1", clientVersion: "1.0", manifest: { id: "x", confidence: "defs" }, hasMods: false, sha256: "0" },
      arena: { arenaUniqueId: "1", map: "m", mapDisplayName: "M", gameplay: "regular", battleType: 1, startedAt: "01.01.2026 00:00:00", durationS: 100, winnerTeam: 1, finishReason: 1, battleStartClock: 0 },
      recorder: { vid: 1, team: 1, name: "Rec" },
      vehicles: [
        { vid: 1, team: 1, name: "Rec", anonymized: false, vehicleType: "t", maxHealth: 1000, isRecorder: true },
        { vid: 2, team: 2, name: "FoeThin", anonymized: false, vehicleType: "t", maxHealth: 1000, isRecorder: false },
        { vid: 3, team: 1, name: "AllyDead", anonymized: false, vehicleType: "t", maxHealth: 1000, isRecorder: false },
        { vid: 4, team: 2, name: "FoeNone", anonymized: false, vehicleType: "t", maxHealth: 1000, isRecorder: false },
      ],
      tracks: {
        1: track(range(50), [[0, 100]]),
        2: track([10, 20, 30], [[10, 30]]),
        3: track(range(25), [[0, 50]]),
      },
      events: [{ k: "kill", t: 50, victim: 3, killer: 2, reason: 0, equipment: 0 }],
      camera: { t: [], mode: [] },
      diagnostics: { unknownPacketTypes: {}, warnings: [] },
    };
  };
  it("full sample reads 1, thin enemy reads 11/51, death truncates the grid, no track reads 0", () => {
    const s = synth();
    expect(playerCoverage(s, 1)).toBe(1);
    expect(playerCoverage(s, 2)).toBeCloseTo(11 / 51, 5);
    expect(playerCoverage(s, 3)).toBe(1);
    expect(playerCoverage(s, 4)).toBe(0);
    expect(playerCoverage(s, 999)).toBeNull();
  });
  it("fixture: the recorder is fully tracked and every value is in [0, 1]", () => {
    expect(playerCoverage(tl, tl.recorder.vid)).toBeGreaterThan(0.95);
    for (const v of tl.vehicles) {
      const p = playerCoverage(tl, v.vid);
      expect(p).not.toBeNull(); expect(p!).toBeGreaterThanOrEqual(0); expect(p!).toBeLessThanOrEqual(1);
    }
  });
});
