import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline, type BattleTimeline, type BattleEvent } from "@wotrep/model";
import { badTrade, deathRecap, detectors, idleWithTargets, isolatedUnderFire, runDetectors, survivedUnusedHp, wonTrade, type Detector } from "../src/index";
import { boldnessAll, playerStats, teamplayAll } from "@wotrep/analysis";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture");
const base = r.value, me = base.recorder.vid, team = base.recorder.team;
const foes = base.vehicles.filter((v) => v.team !== team), friends = base.vehicles.filter((v) => v.team === team && v.vid !== me);
const maxHp = base.vehicles.find((v) => v.vid === me)!.maxHealth;
const run = (d: Detector, tl: BattleTimeline) => d.detect({ tl, cfg: d.cfg });
const dmg = (t: number, attacker: number, target: number, amount: number): BattleEvent => ({ k: "damage", t, attacker, target, amount, hpBefore: 0, hpAfter: 0, reason: 0 });

/** a synthetic battle: every tank stands still at the given place, visible all the time */
const still = (place: (v: { vid: number; team: number }, i: number) => [number, number], events: BattleEvent[], extra: Partial<BattleTimeline> = {}): BattleTimeline => {
  const tracks: BattleTimeline["tracks"] = {};
  base.vehicles.forEach((v, i) => { const [x, z] = place(v, i); const t = Array.from({ length: 41 }, (_, k) => k * 10); tracks[v.vid] = { t, x: t.map(() => x), z: t.map(() => z), y: t.map(() => 0), yaw: t.map(() => 0), visible: [[0, 400]] }; });
  return { ...base, tracks, events: events.sort((a, b) => a.t - b.t), arena: { ...base.arena, durationS: 400 }, ...extra };
};
const layout = (nearEnemies: number, allyAt: number) => (v: { vid: number; team: number }, i: number): [number, number] => {
  if (v.vid === me) return [0, 0];
  if (v.team !== team) return foes.findIndex((f) => f.vid === v.vid) < nearEnemies ? [100 + i, 0] : [2000, 2000];
  return [allyAt, i];
};

describe("bad-trade / won-trade", () => {
  const t0 = 100, foe = foes[0]!.vid;
  it("bad: recorder starts it, deals 100 and takes 500 → one mistake with exact HP cost", () => {
    const f = run(badTrade, still(() => [0, 0], [dmg(t0, me, foe, 100), dmg(t0 + 2, foe, me, 300), dmg(t0 + 4, foe, me, 200)]));
    expect(f).toHaveLength(1); expect(f[0]!.cost.hp).toBe(400); expect(f[0]!.params).toEqual({ dealt: 100, got: 500 });
  });
  it("bad: not when the enemy started it, when the trade was even, or the loss was small", () => {
    expect(run(badTrade, still(() => [0, 0], [dmg(t0, foe, me, 100), dmg(t0 + 2, me, foe, 20), dmg(t0 + 4, foe, me, 500)]))).toEqual([]);
    expect(run(badTrade, still(() => [0, 0], [dmg(t0, me, foe, 450), dmg(t0 + 2, foe, me, 500)]))).toEqual([]);
    expect(run(badTrade, still(() => [0, 0], [dmg(t0, me, foe, 10), dmg(t0 + 2, foe, me, 100)]))).toEqual([]);
  });
  it("won: dealt ≥ 2× received and ≥ 25% of own HP → one good play; a small or even exchange gives nothing", () => {
    const f = run(wonTrade, still(() => [0, 0], [dmg(t0, me, foe, 700), dmg(t0 + 2, foe, me, 100)]));
    expect(f).toHaveLength(1); expect(f[0]!.kind).toBe("good");
    expect(run(wonTrade, still(() => [0, 0], [dmg(t0, me, foe, 700), dmg(t0 + 2, foe, me, 600)]))).toEqual([]);
    expect(run(wonTrade, still(() => [0, 0], [dmg(t0, me, foe, 50)]))).toEqual([]);
  });
});

describe("isolated-under-fire", () => {
  it("positive: nearest ally 600 m away, 3 visible enemies near, took 200 → mistake with distance and enemy count", () => {
    const f = run(isolatedUnderFire, still(layout(3, 600), [dmg(100, foes[0]!.vid, me, 200)]));
    expect(f).toHaveLength(1); expect(f[0]!.cost.hp).toBe(200); expect(f[0]!.params).toMatchObject({ enemies: 3 }); expect(f[0]!.params.dist).toBeGreaterThan(500);
  });
  it("negative: an ally within 120 m, or only two enemies near, or no damage taken", () => {
    expect(run(isolatedUnderFire, still(layout(3, 50), [dmg(100, foes[0]!.vid, me, 200)]))).toEqual([]);
    expect(run(isolatedUnderFire, still(layout(2, 600), [dmg(100, foes[0]!.vid, me, 200)]))).toEqual([]);
    expect(run(isolatedUnderFire, still(layout(3, 600), []))).toEqual([]);
  });
});

describe("idle-with-targets", () => {
  it("positive: 3 enemies visible nearby for the whole battle and no shot → idle mistake with a damage estimate", () => {
    const f = run(idleWithTargets, still(layout(3, 50), []));
    expect(f.length).toBeGreaterThanOrEqual(1); expect(f[0]!.tEnd - f[0]!.tStart).toBeGreaterThanOrEqual(60); expect(f[0]!.cost.damageMissed).toBeGreaterThanOrEqual(0);
  });
  it("negative: shooting every 20 s, or nobody visible nearby", () => {
    const shots: BattleEvent[] = Array.from({ length: 20 }, (_, i) => ({ k: "shot", t: i * 20, shooter: me }));
    expect(run(idleWithTargets, still(layout(3, 50), shots))).toEqual([]);
    expect(run(idleWithTargets, still(layout(0, 50), []))).toEqual([]);
  });
});

describe("recaps", () => {
  it("death-recap: names the killer and sums the damage of the last 30 s", () => {
    const foe = foes[0]!.vid, other = foes[1]!.vid;
    const f = run(deathRecap, still(() => [0, 0], [dmg(150, other, me, 100), dmg(170, foe, me, 400), dmg(175, foe, me, 300), { k: "kill", t: 176, victim: me, killer: foe, reason: 0, equipment: 0 }]));
    expect(f).toHaveLength(1); expect(f[0]!.kind).toBe("info"); expect(f[0]!.params).toMatchObject({ lost: 800, sources: 2, mainHp: 700 });
  });
  it("death-recap: nothing when the recorder survives", () => expect(run(deathRecap, still(() => [0, 0], [dmg(150, foes[0]!.vid, me, 100)]))).toEqual([]));
  it("survived-unused-hp: lost team, ≥60% HP left, little dealt → info; won team or active player → nothing", () => {
    const lost = (dealt: number, w = team === 1 ? 2 : 1) => { const t = still(() => [0, 0], [dmg(100, foes[0]!.vid, me, 100)], { arena: { ...base.arena, durationS: 400, winnerTeam: w as 0 | 1 | 2 } }); t.results = { ...base.results!, players: { ...base.results!.players, [me]: { ...base.results!.players[me]!, damageDealt: dealt } } }; return t; };
    expect(run(survivedUnusedHp, lost(300))).toHaveLength(1);
    expect(run(survivedUnusedHp, lost(maxHp * 2))).toEqual([]);
    expect(run(survivedUnusedHp, lost(300, team))).toEqual([]);
  });
});
describe("subject: any player, friend or foe", () => {
  const friend = friends[0]!.vid, foeSub = foes[0]!.vid;
  const runS = (d: Detector, tl: BattleTimeline, subject: number) => d.detect({ tl, cfg: d.cfg, subject });
  it("bad-trade: a friend's lost trade is a mistake for the friend, nothing for the recorder", () => {
    const tl = still(() => [0, 0], [dmg(100, friend, foeSub, 100), dmg(102, foeSub, friend, 800), dmg(104, foeSub, friend, 700)]);
    const f = runS(badTrade, tl, friend);
    expect(f).toHaveLength(1); expect(f[0]!.vid).toBe(friend); expect(f[0]!.params).toEqual({ dealt: 100, got: 1500 });
    expect(run(badTrade, tl)).toEqual([]);
  });
  it("isolated-under-fire: an enemy alone among the recorder's team, far from their own allies", () => {
    const place = (v: { vid: number; team: number }, i: number): [number, number] => {
      if (v.vid === foeSub) return [0, 0];
      if (v.team !== team) return [600, i];
      return [100 + i, 0];
    };
    const tl = still(place, [dmg(100, me, foeSub, 200)]);
    const f = runS(isolatedUnderFire, tl, foeSub);
    expect(f).toHaveLength(1); expect(f[0]!.vid).toBe(foeSub); expect(f[0]!.params.enemies).toBeGreaterThanOrEqual(3);
    expect(run(isolatedUnderFire, tl)).toEqual([]);
  });
  it("death-recap: an enemy's death names the killer", () => {
    const tl = still(() => [0, 0], [dmg(150, me, foeSub, 100), dmg(170, me, foeSub, 400), { k: "kill", t: 176, victim: foeSub, killer: me, reason: 0, equipment: 0 }]);
    const f = runS(deathRecap, tl, foeSub);
    expect(f).toHaveLength(1); expect(f[0]!.vid).toBe(foeSub); expect(f[0]!.kind).toBe("info");
    expect(run(deathRecap, tl)).toEqual([]);
  });
  it("runDetectors with a subject returns only that player's findings; without one, only the recorder's", () => {
    const tl = still(() => [0, 0], [dmg(100, friend, foeSub, 100), dmg(102, foeSub, friend, 800), dmg(104, foeSub, friend, 700)]);
    const sub = runDetectors(tl, detectors, friend);
    expect(sub.length).toBeGreaterThanOrEqual(1); expect(sub.every((f) => f.vid === friend)).toBe(true);
    expect(sub.some((f) => f.detector === "bad-trade")).toBe(true);
    expect(runDetectors(tl, detectors).every((f) => f.vid === me)).toBe(true);
  });
  it("unknown subject vid → no findings", () => {
    const tl = still(() => [0, 0], [dmg(100, friend, foeSub, 100), dmg(102, foeSub, friend, 1500)]);
    expect(runS(badTrade, tl, 999999)).toEqual([]);
  });
  it("stats already cover every player: playerStats, boldnessAll and teamplayAll key all vehicles", () => {
    const vids = base.vehicles.map((v) => v.vid).sort((a, b) => a - b);
    expect(playerStats(base).map((p) => p.vid).sort((a, b) => a - b)).toEqual(vids);
    expect([...boldnessAll(base).keys()].sort((a, b) => a - b)).toEqual(vids);
    expect([...teamplayAll(base).keys()].sort((a, b) => a - b)).toEqual(vids);
  });
});
