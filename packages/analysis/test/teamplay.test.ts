import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { teamplayAll, teamShape } from "../src/index";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("teamplay v0", () => {
  it("returns bounded shares for every vehicle", () => {
    const all = teamplayAll(tl); expect(all.size).toBe(tl.vehicles.length);
    for (const p of all.values()) for (const v of [p.focusShare, p.companyShare, p.hangShare, p.frontRank]) if (v != null) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
  it("the recorder's team has full spawn data; hangS never exceeds alive seconds", () => {
    const me = teamplayAll(tl).get(tl.recorder.vid)!; expect(me.frontRank).not.toBeNull(); expect(me.hangS!).toBeLessThanOrEqual(me.aliveS); expect(me.aliveS).toBeGreaterThan(60);
  });
  it("focus fire: a hit that two teammates share counts, a lone one does not (synthetic)", () => {
    const [a, b] = tl.vehicles.filter((v) => v.team === tl.recorder.team).map((v) => v.vid), foe = tl.vehicles.find((v) => v.team !== tl.recorder.team)!.vid;
    const mk = (hits: [number, number][]) => ({ ...tl, events: [...tl.events.filter((e) => e.k !== "damage"), ...hits.map(([att, t]) => ({ k: "damage" as const, t, target: foe, attacker: att, amount: 100, hpBefore: 1000, hpAfter: 900, reason: 0 }))] });
    const shared = teamplayAll(mk([[a!, 100], [a!, 101], [a!, 102], [b!, 101]])).get(a!)!, lone = teamplayAll(mk([[a!, 100], [a!, 101], [a!, 102], [b!, 200]])).get(a!)!;
    expect(shared.focusShare).toBe(1); expect(lone.focusShare).toBe(0);
  });
  it("team shape is a positive spread in metres and exists for the recorder's team", () => {
    const s = teamShape(tl, tl.recorder.team); expect(s.spreadM).toBeGreaterThan(20); expect(s.spreadM!).toBeLessThan(1000); expect(s.t.length).toBe(s.spread.length);
  });
});
