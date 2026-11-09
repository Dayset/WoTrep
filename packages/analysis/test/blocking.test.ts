import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline, type BattleTimeline } from "@wotrep/model";
import { blocking } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

// T = shooter (vid 1, team 1), B = blocker (vid 2), B2 = off-line (vid 3), B3 = beyond target (vid 4),
// E = target (vid 5, team 2), E2 = engaging enemy without a track (vid 6, never a target).
const track = (x: number, z: number, n: number, vis: [number, number][] = [[0, n]]): BattleTimeline["tracks"][number] => ({
  t: Array.from({ length: n + 1 }, (_, i) => i), x: Array(n + 1).fill(x), z: Array(n + 1).fill(z),
  y: Array(n + 1).fill(0), yaw: Array(n + 1).fill(0), visible: vis,
});
const mk = (tracks: BattleTimeline["tracks"], events: BattleTimeline["events"]): BattleTimeline => ({
  schema: "wotrep.timeline/1",
  source: { realm: "wg", regionCode: "EU", server: "EU1", clientVersion: "1.0", manifest: { id: "x", confidence: "defs" }, hasMods: false, sha256: "0" },
  arena: { arenaUniqueId: "B", map: "m", mapDisplayName: "M", gameplay: "regular", battleType: 1, startedAt: "01.01.2026 00:00:00", durationS: null, winnerTeam: null, finishReason: null, battleStartClock: 0 },
  recorder: { vid: 1, team: 1, name: "A" },
  vehicles: [
    { vid: 1, team: 1, name: "T", anonymized: false, vehicleType: "t", maxHealth: 1000, isRecorder: true },
    { vid: 2, team: 1, name: "B", anonymized: false, vehicleType: "t", maxHealth: 1000, isRecorder: false },
    { vid: 3, team: 1, name: "B2", anonymized: false, vehicleType: "t", maxHealth: 1000, isRecorder: false },
    { vid: 4, team: 1, name: "B3", anonymized: false, vehicleType: "t", maxHealth: 1000, isRecorder: false },
    { vid: 5, team: 2, name: "E", anonymized: false, vehicleType: "t", maxHealth: 1000, isRecorder: false },
    { vid: 6, team: 2, name: "E2", anonymized: false, vehicleType: "t", maxHealth: 1000, isRecorder: false },
  ],
  tracks, events, camera: { t: [], mode: [] },
  diagnostics: { unknownPacketTypes: {}, warnings: [] },
});
const shot = (t: number, shooter = 1): BattleTimeline["events"][number] => ({ k: "shot", t, shooter });
const dmg = (t: number, attacker: number, target: number): BattleTimeline["events"][number] =>
  ({ k: "damage", t, attacker, target, amount: 100, hpBefore: 1000, hpAfter: 900, reason: 0 });
const at = (s: ReturnType<typeof blocking>, vid: number) => s.players.find((p) => p.vid === vid)!;

describe("blocking (synthetic)", () => {
  it("counts a blocker on the line, and not off-line, beyond the target, or behind the shooter", () => {
    const s = blocking(mk({
      1: track(0, 0, 20), 2: track(50, 0, 20), 3: track(50, 4, 20), 4: track(150, 0, 20), 5: track(100, 0, 20),
    }, [shot(0), shot(1), shot(2)]), 20);
    // T's single-burst estimate reads clip 1 / reload 1 s, so t = 0, 1, 2 are reloading and 3..20 are ready.
    expect(at(s, 2)).toMatchObject({ oppS: 18, blockedS: 18, blockedPairs: 18, rate: 1 });
    expect(at(s, 3)).toMatchObject({ oppS: 18, blockedS: 0, blockedPairs: 0, rate: 0 });
    expect(at(s, 4)).toMatchObject({ oppS: 18, blockedS: 0, blockedPairs: 0, rate: 0 });
  });
  it("a reloading shooter contributes no opportunities during the reload gap", () => {
    const shots = [0, 1, 2, 3, 4, 14, 15, 16, 17, 18].map((t) => shot(t));
    const s = blocking(mk({
      1: track(0, 0, 20), 2: track(50, 0, 20), 5: track(100, 0, 20),
    }, shots), 13);
    // two full clips give clip 5 / reload ~10 s: bursting at 0..3, reloading 4..13.
    expect(at(s, 2)).toMatchObject({ oppS: 4, blockedS: 4, rate: 1 });
  });
  it("another enemy engaging the shooter removes the opportunity until the window expires", () => {
    const s = blocking(mk({
      1: track(0, 0, 20), 2: track(50, 0, 20), 5: track(100, 0, 20),
    }, [shot(0), shot(1), shot(2), dmg(9, 6, 1)]), 20);
    // ready from t = 3; damage at 9 excludes t = 9..18 (window (t-10, t]); clean again at 19, 20.
    expect(at(s, 2)).toMatchObject({ oppS: 8, blockedS: 8, rate: 1 });
  });
  it("out-of-range and unspotted targets give no opportunity; a shooter with no shots gives none", () => {
    const far = blocking(mk({
      1: track(0, 0, 20), 2: track(50, 0, 20), 5: track(500, 0, 20),
    }, [shot(0), shot(1), shot(2)]), 20);
    expect(at(far, 2)).toMatchObject({ oppS: 0, blockedS: 0, rate: null });
    const ghost = blocking(mk({
      1: track(0, 0, 20), 2: track(50, 0, 20), 5: track(100, 0, 20, [[0, 5]]),
    }, [shot(0), shot(1), shot(2)]), 20);
    expect(at(ghost, 2)).toMatchObject({ oppS: 3, blockedS: 3, rate: 1 });
    const noshots = blocking(mk({
      1: track(0, 0, 20), 2: track(50, 0, 20), 5: track(100, 0, 20),
    }, []), 20);
    expect(at(noshots, 2)).toMatchObject({ oppS: 0, blockedS: 0, rate: null });
  });
});

describe("blocking (fixture)", () => {
  it("gives bounded numbers for every player", () => {
    const s = blocking(tl);
    expect(s.players.length).toBe(30);
    for (const p of s.players) {
      expect(p.blockedS).toBeLessThanOrEqual(p.oppS);
      expect(p.blockedPairs).toBeGreaterThanOrEqual(p.blockedS);
      if (p.rate != null) { expect(p.rate).toBeGreaterThanOrEqual(0); expect(p.rate).toBeLessThanOrEqual(1); }
    }
  });
});
