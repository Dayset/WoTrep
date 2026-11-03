import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { alignment, goodPlaysAll } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("goodPlaysAll", () => {
  it("includes the recorder's two known good plays and plays by others, all with bounded fields", () => {
    const all = goodPlaysAll(tl), mine = all.filter((p) => p.vid === tl.recorder.vid);
    expect(mine.length).toBe(2); expect(all.length).toBeGreaterThan(2); expect(new Set(all.map((p) => p.team)).size).toBe(2);
    for (const p of all) { expect(p.coverage).toBeGreaterThan(0); expect(p.coverage).toBeLessThanOrEqual(1); expect(p.enabledShare).toBeGreaterThanOrEqual(0); expect(p.enabledShare).toBeLessThanOrEqual(1); expect(["carried", "shared", "solo"]).toContain(p.enabled); }
  });
  it("a teammate absorbing the same enemy's fire makes the play 'carried'; none makes it 'solo' (synthetic)", () => {
    const base = goodPlaysAll(tl).find((p) => p.vid === tl.recorder.vid)!;
    const mate = tl.vehicles.find((v) => v.team === base.team && v.vid !== base.vid)!, me = base.vid;
    const foes = [...new Set(tl.events.flatMap((e) => (e.k === "damage" && e.attacker === me && e.t >= base.tStart && e.t <= base.tEnd ? [e.target] : [])))];
    const strip = { ...tl, events: tl.events.filter((e) => !(e.k === "damage" && e.target === mate.vid && foes.includes(e.attacker)) && !(e.k === "kill" && e.victim === mate.vid)) };
    const solo = goodPlaysAll(strip).find((p) => p.vid === me && p.tStart === base.tStart)!;
    const withHit = { ...strip, events: [...strip.events, { k: "damage" as const, t: base.tStart - 2, target: mate.vid, attacker: foes[0]!, amount: 900, hpBefore: 1500, hpAfter: 600, reason: 0 }] };
    const carried = goodPlaysAll(withHit).find((p) => p.vid === me && p.tStart === base.tStart)!;
    expect(solo.absorbedHp).toBe(0); expect(solo.enabled).toBe("solo"); expect(carried.absorbedHp).toBeGreaterThanOrEqual(900); expect(carried.enabled).not.toBe("solo");
  });
  it("alignment counts plays that overlap another teammate's play", () => {
    const a = alignment(goodPlaysAll(tl), tl.recorder.team); expect(a.aligned).toBeLessThanOrEqual(a.plays);
    const mk = (vid: number, t: number) => ({ vid, team: 1 as const, tStart: t, tEnd: t + 5, dealt: 1, got: 0, wpDelta: 0, absorbedHp: 0, sacrificed: [], enabledShare: 0, enabled: "solo" as const, coverage: 1, absorbedBy: {} });
    expect(alignment([mk(1, 100), mk(2, 108), mk(3, 300)], 1)).toMatchObject({ plays: 3, aligned: 2 });
  });
});

import { ledger } from "../src/index";
describe("ledger", () => {
  it("credits helpers once per play and totals match the plays", () => {
    const plays = goodPlaysAll(tl), rows = ledger(tl, plays);
    expect(rows.length).toBe(tl.vehicles.length);
    expect(rows.reduce((s, r) => s + r.plays, 0)).toBe(plays.length);
    expect(rows.reduce((s, r) => s + r.carried, 0)).toBe(plays.filter((p) => p.enabled === "carried").length);
    // every helper credit comes from a play of a teammate of that helper
    const helperCredits = plays.reduce((s, p) => s + new Set([...Object.keys(p.absorbedBy).map(Number), ...p.sacrificed]).size, 0);
    expect(rows.reduce((s, r) => s + r.madeFor, 0)).toBe(helperCredits);
    for (const r of rows) { expect(r.diedFor).toBeLessThanOrEqual(r.madeFor); expect(r.carried).toBeLessThanOrEqual(r.plays); }
  });
});
