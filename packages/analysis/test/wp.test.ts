import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { wpOf, wpSeries } from "../src/index";
import { stateAt } from "@wotrep/model";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture");
const tl = r.value;

describe("wpOf / wpSeries (#63 acceptance)", () => {
  it("is monotone in HP: more own HP or less enemy HP raises WP", () => {
    const s = stateAt(tl, 100);
    const base = wpOf(s, 2);
    const moreOwn = { ...s, units: s.units.map((u) => (u.team === 2 ? { ...u, hp: u.hp * 2 } : u)) };
    expect(wpOf(moreOwn, 2)).toBeGreaterThan(base);
    const lessEnemy = { ...s, units: s.units.map((u) => (u.team === 1 ? { ...u, hp: Math.max(1, u.hp / 2) } : u)) };
    expect(wpOf(lessEnemy, 2)).toBeGreaterThan(base);
    const ownDead = { ...s, units: s.units.map((u) => (u.team === 2 ? { ...u, alive: false } : u)) };
    expect(wpOf(ownDead, 2)).toBe(0);
    const enemyDead = { ...s, units: s.units.map((u) => (u.team === 1 ? { ...u, alive: false } : u)) };
    expect(wpOf(enemyDead, 2)).toBe(1);
  });
  it("fixture curve for team 2 passes 0.95 before the last kill and ends at 1", () => {
    const s = wpSeries(tl, 2);
    const lastKill = Math.max(...tl.events.filter((e) => e.k === "kill").map((e) => e.t));
    const first95 = s.t.find((t, i) => s.wp[i]! > 0.95);
    expect(first95).toBeDefined();
    expect(first95!).toBeLessThan(lastKill);
    expect(s.wp[s.wp.length - 1]).toBe(1);
  });
});
