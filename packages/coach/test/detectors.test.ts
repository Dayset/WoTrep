import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline, type BattleTimeline, type BattleEvent } from "@wotrep/model";
import { badTrade, deathRecap, detectors, exposedWhileReloading, idleWithTargets, isolatedUnderFire, lowYieldClip, peekIntoLoadedAutoloader, punishedReload, runDetectors, shootingOnTheMove, survivedUnusedHp, wonTrade, type Detector } from "../src/index";
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
  it("reload exclusion: a 70 s post-burst stretch counts only 50 s once the 20 s reload is cut out", () => {
    const bursts: BattleEvent[] = [0, 20, 40, 60].flatMap((s) => [{ k: "shot", t: s, shooter: me }, { k: "shot", t: s + 0.3, shooter: me }]);
    const short = { arena: { ...base.arena, durationS: 130 } };
    expect(run(idleWithTargets, still(layout(3, 50), bursts, short))).toEqual([]);
  });
  it("no exclusion for single-shot guns: the same 70 s stretch still fires", () => {
    const singles: BattleEvent[] = [0, 20, 40, 60].map((t) => ({ k: "shot", t, shooter: me }));
    const short = { arena: { ...base.arena, durationS: 130 } };
    const f = run(idleWithTargets, still(layout(3, 50), singles, short));
    expect(f.length).toBeGreaterThanOrEqual(1);
  });
});

describe("recaps", () => {
  const shot = (t: number, shooter: number): BattleEvent => ({ k: "shot", t, shooter });
  it("death-recap: names the killer and sums the damage of the last 30 s", () => {
    const foe = foes[0]!.vid, other = foes[1]!.vid;
    const f = run(deathRecap, still(() => [0, 0], [dmg(150, other, me, 100), dmg(170, foe, me, 400), dmg(175, foe, me, 300), { k: "kill", t: 176, victim: me, killer: foe, reason: 0, equipment: 0 }]));
    expect(f).toHaveLength(1); expect(f[0]!.kind).toBe("info"); expect(f[0]!.params).toMatchObject({ lost: 800, sources: 2, mainHp: 700 });
  });
  it("death-recap: nothing when the recorder survives", () => expect(run(deathRecap, still(() => [0, 0], [dmg(150, foes[0]!.vid, me, 100)]))).toEqual([]));
  it("death-recap: names the nearest ally and its distance", () => {
    const foe = foes[0]!.vid;
    const f = run(deathRecap, still(layout(0, 50), [dmg(150, foe, me, 100), { k: "kill", t: 176, victim: me, killer: foe, reason: 0, equipment: 0 }]));
    expect(f).toHaveLength(1); expect(f[0]!.params.ally).toBe(friends[0]!.name);
    const i0 = base.vehicles.findIndex((v) => v.vid === friends[0]!.vid);
    expect(f[0]!.evidence).toContainEqual({ k: "number", label: "nearest ally m", value: Math.round(Math.hypot(50, i0)), unit: "m" });
  });
  it("death-recap: own reload timer when killed mid-reload, none when the gun was ready", () => {
    const foe = foes[0]!.vid;
    const shots = [shot(100, me), shot(100.3, me), shot(120, me), shot(120.3, me)];
    const kill = (t: number): BattleEvent => ({ k: "kill", t, victim: me, killer: foe, reason: 0, equipment: 0 });
    const f = run(deathRecap, still(() => [0, 0], [...shots, dmg(125, foe, me, 100), kill(130)]));
    expect(f).toHaveLength(1);
    expect(f[0]!.evidence).toContainEqual({ k: "timer", vid: me, t: 130, label: "reload", secondsLeft: 10 });
    const g = run(deathRecap, still(() => [0, 0], [...shots, dmg(125, foe, me, 100), kill(150)]));
    expect(g).toHaveLength(1);
    expect(g[0]!.evidence.filter((e) => e.k === "timer")).toEqual([]);
  });
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

describe("low-yield-clip", () => {
  const foe = foes[0]!.vid;
  const shot = (t: number): BattleEvent => ({ k: "shot", t, shooter: me });
  it("fires per clip at pen rate ≤ 20% and summarizes the below-median half", () => {
    const bursts = [0, 20, 40, 60].flatMap((s) => [0, 0.3, 0.6, 0.9, 1.2].map((d) => shot(s + d)));
    const pens = [
      dmg(2, me, foe, 10), dmg(22, me, foe, 20),
      ...[40.2, 40.5, 40.8, 41.1, 41.4].map((t) => dmg(t, me, foe, 20)),
      ...[60.2, 60.5, 60.8, 61.1, 61.4].map((t) => dmg(t, me, foe, 40)),
    ];
    const f = run(lowYieldClip, still(() => [0, 0], [...bursts, ...pens]));
    const mistakes = f.filter((x) => x.kind === "mistake");
    expect(mistakes).toHaveLength(2);
    expect(mistakes.map((x) => x.tStart)).toEqual([0, 20]);
    expect(mistakes.map((x) => x.params)).toEqual([
      { shells: 5, pens: 1, dmg: 10 }, { shells: 5, pens: 1, dmg: 20 },
    ]);
    const info = f.filter((x) => x.kind === "info");
    expect(info).toHaveLength(1);
    expect(info[0]!.params).toEqual({ lowN: 2, lowShells: 10, lowDmg: 30, highN: 2, highShells: 10, highDmg: 300 });
    expect(info[0]!.messageKey).toBe("coach.lowYieldSummary");
  });
  it("does not fire for short clips even at zero pens", () => {
    const shots = [0, 20, 40, 60].map(shot);
    expect(run(lowYieldClip, still(() => [0, 0], shots))).toEqual([]);
  });
  it("fixture: fires for clips 1 and 5, summary matches first-replay.md", () => {
    const f = run(lowYieldClip, base);
    const mistakes = f.filter((x) => x.kind === "mistake");
    expect(mistakes).toHaveLength(2);
    expect(mistakes.map((x) => x.tStart)).toEqual([38.2, 268.29]);
    expect(mistakes.map((x) => x.cost.damageMissed)).toEqual([212, 236]);
    expect(mistakes.map((x) => x.params)).toEqual([
      { shells: 10, pens: 1, dmg: 46 }, { shells: 11, pens: 1, dmg: 52 },
    ]);
    const info = f.filter((x) => x.kind === "info");
    expect(info).toHaveLength(1);
    expect(info[0]!.params).toEqual({ lowN: 3, lowShells: 31, lowDmg: 234, highN: 3, highShells: 30, highDmg: 1128 });
    expect(info[0]!.tStart).toBe(298);
    expect(info[0]!.tEnd).toBe(328);
    expect(info[0]!.cost.damageMissed).toBe(458);
  });
});
describe("shooting-on-the-move", () => {
  /** subject stands still until 100, drives 30 km/h from 100 to 200, stands still after — 1 s samples,
   *  so speedAt reads exact segment speeds and shots stay ≥ 10 s from the segment boundaries. */
  const moving = (events: BattleEvent[]): BattleTimeline => {
    const tracks: BattleTimeline["tracks"] = {};
    base.vehicles.forEach((v) => {
      if (v.vid === me) {
        const t = Array.from({ length: 401 }, (_, k) => k);
        const x = t.map((s) => (s <= 100 ? 0 : s <= 200 ? (s - 100) * (30 / 3.6) : 100 * (30 / 3.6)));
        tracks[v.vid] = { t, x, z: t.map(() => 0), y: t.map(() => 0), yaw: t.map(() => 0), visible: [[0, 400]] };
      } else {
        const t = Array.from({ length: 41 }, (_, k) => k * 10);
        tracks[v.vid] = { t, x: t.map(() => 0), z: t.map(() => 0), y: t.map(() => 0), yaw: t.map(() => 0), visible: [[0, 400]] };
      }
    });
    return { ...base, tracks, events: events.sort((a, b) => a.t - b.t), arena: { ...base.arena, durationS: 400 } };
  };
  const shot = (t: number): BattleEvent => ({ k: "shot", t, shooter: me });
  const slow = [50, 60, 70], fast = [110, 120, 130, 140];
  const foe = foes[0]!.vid;
  it("positive: 4 of 7 shots fast, 1 pen on them (25%) → one mistake with exact params, span and cost", () => {
    const f = run(shootingOnTheMove, moving([...slow.map(shot), ...fast.map(shot),
      dmg(50.3, me, foe, 200), dmg(60.3, me, foe, 200), dmg(70.3, me, foe, 200), dmg(110.3, me, foe, 300)]));
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("mistake"); expect(f[0]!.messageKey).toBe("coach.shootingOnTheMove"); expect(f[0]!.guide).toBe("aim-time");
    expect(f[0]!.tStart).toBe(110); expect(f[0]!.tEnd).toBe(140);
    expect(f[0]!.params).toEqual({ fast: 4, total: 7, penRate: 25 });
    expect(f[0]!.cost.damageMissed).toBe(500);
  });
  it("negative: pen rate exactly 50% is not below the bar", () => {
    expect(run(shootingOnTheMove, moving([...slow.map(shot), ...fast.map(shot),
      dmg(110.3, me, foe, 300), dmg(120.3, me, foe, 300)]))).toEqual([]);
  });
  it("negative: fast share below 30%, all shots slow, or no shots → nothing", () => {
    expect(run(shootingOnTheMove, moving([...[50, 60, 70, 80, 90].map(shot), shot(110)]))).toEqual([]);
    expect(run(shootingOnTheMove, moving(slow.map(shot)))).toEqual([]);
    expect(run(shootingOnTheMove, moving([]))).toEqual([]);
  });
});
describe("punished-reload", () => {
  const foe = foes[0]!.vid;
  const shot = (t: number, shooter: number): BattleEvent => ({ k: "shot", t, shooter });
  const bursts = [0, 20, 40, 60].flatMap((s) => [shot(s, foe), shot(s + 0.3, foe)]);
  it("good: damage inside a reload window aggregates into one finding with negative cost", () => {
    const f = run(punishedReload, still(() => [0, 0], [...bursts, dmg(10, me, foe, 50), dmg(12, me, foe, 30)]));
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("good");
    expect(f[0]!.tStart).toBe(10); expect(f[0]!.tEnd).toBe(12);
    expect(f[0]!.cost.damageMissed).toBe(-80);
    expect(f[0]!.params).toEqual({ dmg: 80, enemy: foes[0]!.name });
    expect(f[0]!.evidence).toContainEqual({ k: "timer", vid: foe, t: 10, label: "reload", secondsLeft: 10 });
  });
  it("negative: less than 3 s of reload left, or damage while the enemy is firing", () => {
    expect(run(punishedReload, still(() => [0, 0], [...bursts, dmg(18, me, foe, 50)]))).toEqual([]);
    expect(run(punishedReload, still(() => [0, 0], [...bursts, dmg(20.1, me, foe, 50)]))).toEqual([]);
  });
  it("negative: no window after a partial burst, for single-shot guns, or at low estimate confidence", () => {
    const partial = [shot(0, foe), shot(0.3, foe), shot(20, foe), shot(20.3, foe), shot(40, foe), shot(60, foe), shot(60.3, foe)];
    expect(run(punishedReload, still(() => [0, 0], [...partial, dmg(50, me, foe, 50)]))).toEqual([]);
    const singles = [0, 20, 40, 60].map((t) => shot(t, foe));
    expect(run(punishedReload, still(() => [0, 0], [...singles, dmg(10, me, foe, 50)]))).toEqual([]);
    const twoBursts = [shot(0, foe), shot(0.3, foe), shot(20, foe), shot(20.3, foe)];
    expect(run(punishedReload, still(() => [0, 0], [...twoBursts, dmg(10, me, foe, 50)]))).toEqual([]);
  });
  it("fixture: fires nowhere (hand-reviewed — no recorder damage falls in a qualifying window)", () => {
    // Per-foe review: the only confident autoloaders are 100Kosarikov (no recorder damage at all)
    // and Tsunemikih (windows [119.7,125.0], [151.4,156.7], [195.9,201.2], [239.5,244.8], [257.4,262.7]
    // — recorder damage at 254.0/269.5/286.7-288.5 lands during TDM's bursts or outside every window;
    // the 269.5 hit fails the ≥ 3 s rule even against the true ~14 s reload, ~1.9 s left).
    // sergey126161 is below the confidence guard and contributes nothing even unguarded;
    // all other recorder damage went into firing enemies or single-shot guns.
    expect(run(punishedReload, base)).toEqual([]);
  });
});
describe("exposed-while-reloading", () => {
  const foe = foes[0]!.vid;
  const shot = (t: number, shooter: number): BattleEvent => ({ k: "shot", t, shooter });
  const bursts = [0, 20, 40, 60].flatMap((s) => [shot(s, me), shot(s + 0.3, me)]);
  it("mistake: damage during a reload aggregates, with path, retreat zone and reload timer", () => {
    const f = run(exposedWhileReloading, still(layout(1, 50), [...bursts, dmg(10, foe, me, 50), dmg(12, foe, me, 30)]));
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("mistake");
    expect(f[0]!.tStart).toBe(10); expect(f[0]!.tEnd).toBe(12);
    expect(f[0]!.cost.hp).toBe(80);
    expect(f[0]!.params).toEqual({ dmg: 80, moved: 0 });
    expect(f[0]!.evidence).toContainEqual({ k: "path", vid: me, t0: 0.3, t1: 12, style: "actual" });
    expect(f[0]!.evidence).toContainEqual({ k: "zone", x: -50, z: 0, r: 25, style: "suggested" });
    expect(f[0]!.evidence).toContainEqual({ k: "timer", vid: me, t: 10, label: "reload", secondsLeft: 10 });
  });
  it("negative: reload almost over, or hit while firing or ready", () => {
    expect(run(exposedWhileReloading, still(() => [0, 0], [...bursts, dmg(18.5, foe, me, 50)]))).toEqual([]);
    expect(run(exposedWhileReloading, still(() => [0, 0], [...bursts, dmg(20.1, foe, me, 50)]))).toEqual([]);
    expect(run(exposedWhileReloading, still(() => [0, 0], [...bursts, dmg(100, foe, me, 50)]))).toEqual([]);
  });
  it("negative: moved 5 m or more since the last shot", () => {
    const tl = still(() => [0, 0], [...bursts, dmg(10, foe, me, 50)]);
    const t = Array.from({ length: 41 }, (_, k) => k * 10);
    tl.tracks[me] = { t, x: t.map((v) => (v === 0 ? 0 : 100)), z: t.map(() => 0), y: t.map(() => 0), yaw: t.map(() => 0), visible: [[0, 400]] };
    expect(run(exposedWhileReloading, tl)).toEqual([]);
  });
  it("negative: single-shot gun, or low estimate confidence", () => {
    const singles = [0, 20, 40, 60].map((t) => shot(t, me));
    expect(run(exposedWhileReloading, still(() => [0, 0], [...singles, dmg(10, foe, me, 50)]))).toEqual([]);
    const twoBursts = [shot(0, me), shot(0.3, me), shot(20, me), shot(20.3, me)];
    expect(run(exposedWhileReloading, still(() => [0, 0], [...twoBursts, dmg(10, foe, me, 50)]))).toEqual([]);
  });
  it("fixture: fires nowhere (hand-reviewed — every hit on the recorder reads bursting, never reloading)", () => {
    // Diagnostic: recorder estimate clip 10 / reload 8.1 s / confidence 1; all 7 hits land mid-burst
    // (trailing run below clip size), so the reload condition never holds — movement never matters.
    expect(run(exposedWhileReloading, base)).toEqual([]);
  });
});
describe("peek-into-loaded-autoloader", () => {
  const foe = foes[0]!.vid;
  const shot = (t: number, shooter: number): BattleEvent => ({ k: "shot", t, shooter });
  const bursts3 = (starts: number[]) => starts.flatMap((s) => [shot(s, foe), shot(s + 0.3, foe), shot(s + 0.6, foe)]);
  it("fires when the subject takes 2+ hits from a reloaded full clip", () => {
    const f = run(peekIntoLoadedAutoloader, still(() => [0, 0], [...bursts3([0, 20, 40, 60]), dmg(61, foe, me, 100), dmg(62, foe, me, 150)]));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "mistake", guide: "autoloader-timing", drill: true, vid: me });
    expect(f[0]!.tStart).toBe(61); expect(f[0]!.tEnd).toBe(62); expect(f[0]!.cost.hp).toBe(250);
    expect(f[0]!.evidence.some((e) => e.k === "unit" && e.vid === foe)).toBe(true);
    expect(f[0]!.evidence.some((e) => e.k === "line" && e.style === "threat")).toBe(true);
  });
  it("does not fire on one hit, a partial previous clip, or a single-shot gun", () => {
    expect(run(peekIntoLoadedAutoloader, still(() => [0, 0], [...bursts3([0, 20, 40, 60]), dmg(61, foe, me, 100)]))).toEqual([]);
    const partial = [...bursts3([0, 20, 40]), shot(60, foe), shot(60.3, foe), ...bursts3([80]), dmg(81, foe, me, 100), dmg(82, foe, me, 100)];
    expect(run(peekIntoLoadedAutoloader, still(() => [0, 0], partial))).toEqual([]);
    const single = [shot(0, foe), shot(20, foe), shot(40, foe), shot(60, foe), dmg(61, foe, me, 100), dmg(62, foe, me, 100)];
    expect(run(peekIntoLoadedAutoloader, still(() => [0, 0], single))).toEqual([]);
  });
  it("fixture: fires once at ~4:13 against the TDM-54 with cost.hp 421, nothing at 4:46", () => {
    const f = run(peekIntoLoadedAutoloader, base);
    expect(f).toHaveLength(1);
    expect(f[0]!.tStart).toBeCloseTo(254, 0);
    expect(f[0]!.cost.hp).toBe(421);
    expect(f[0]!.evidence.some((e) => e.k === "unit" && e.vid === 13908133)).toBe(true);
    expect(f.filter((x) => x.tStart >= 286 && x.tStart <= 289)).toEqual([]);
  });
});
