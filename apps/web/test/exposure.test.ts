import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { exposure } from "../src/features/report/exposure";
import { Exposure } from "../src/features/report/Exposure";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("exposure", () => {
  const ex = exposure(tl);
  const byName = new Map(tl.vehicles.map((v) => [v.name, ex.teams[v.team as 1 | 2].players.find((p) => p.vid === v.vid)!]));
  it("covers every player with consistent parts", () => {
    expect(ex.teams[1].players.length + ex.teams[2].players.length).toBe(30);
    for (const team of [1, 2] as const) {
      for (const p of ex.teams[team].players) {
        expect(p.ghostReadyS).toBeLessThanOrEqual(p.ghostS);
        expect(p.liveS).toBeLessThanOrEqual(p.aliveS);
        expect(p.exposedS).toBeLessThanOrEqual(p.aliveS);
        expect(p.nowS).toBeLessThanOrEqual(p.exposedS);
        expect(p.nowS).toBeGreaterThanOrEqual(p.liveS);
        expect(p.exposedS).toBeGreaterThanOrEqual(p.ghostS);
        expect(p.exposedS).toBeGreaterThanOrEqual(p.liveS);
        expect(p.exposedS).toBeLessThanOrEqual(p.ghostS + p.liveS);
        expect(p.soloS + p.sharedS).toBe(p.exposedS);
      }
      const tm = ex.teams[team];
      expect(tm.sumExposed).toBe(tm.players.reduce((x, p) => x + p.exposedS, 0));
      expect(tm.sumNow).toBe(tm.players.reduce((x, p) => x + p.nowS, 0));
      expect(tm.unionExposed).toBeLessThanOrEqual(tm.sumExposed);
      expect(tm.unionNow).toBeLessThanOrEqual(tm.sumNow);
      expect(tm.unionExposed).toBeLessThanOrEqual(Math.floor(tl.arena.durationS ?? 0) + 1);
    }
  });
  it("ghosts threaten only the recorder team, and the live side spreads on both", () => {
    const foe = tl.recorder.team === 1 ? 2 : 1;
    for (const p of ex.teams[foe as 1 | 2].players) expect(p.ghostS).toBe(0);
    expect(ex.teams[tl.recorder.team as 1 | 2].players.some((p) => p.ghostS > 40)).toBe(true);
    // Fixture spot values (strict live side: terrain LOS + loaded gun + clear path, 445 m):
    // Tsunemikih (enemy) has no ghost and 73 s of clean shots against him, 29 of them alone;
    // sarcozi01 (ally) carries the longest ghost exposure; kravchikino is never shot at live
    // (0 s) but carries 124 s of ghost; 77SVET77 is never exposed at all in 36 s alive.
    expect(byName.get("Tsunemikih")!.ghostS).toBe(0);
    expect(byName.get("Tsunemikih")!.liveS).toBe(73);
    expect(byName.get("Tsunemikih")!.exposedS).toBe(73);
    expect(byName.get("Tsunemikih")!.soloS).toBe(29);
    expect(byName.get("sarcozi01")!.ghostS).toBe(235);
    expect(byName.get("sarcozi01")!.ghostReadyS).toBe(229);
    expect(byName.get("sarcozi01")!.liveS).toBe(221);
    expect(byName.get("sarcozi01")!.exposedS).toBe(282);
    expect(byName.get("sarcozi01")!.nowS).toBe(280);
    expect(byName.get("ValRom57")!.ghostS).toBe(106);
    expect(byName.get("ValRom57")!.ghostReadyS).toBe(54);
    expect(byName.get("ValRom57")!.liveS).toBe(53);
    expect(byName.get("ValRom57")!.exposedS).toBe(121);
    expect(byName.get("kravchikino")!.liveS).toBe(0);
    expect(byName.get("kravchikino")!.exposedS).toBe(124);
    expect(byName.get("77SVET77")!.exposedS).toBe(0);
    expect(ex.teams[1].sumExposed).toBe(924);
    expect(ex.teams[1].unionExposed).toBe(276);
    expect(ex.teams[2].sumExposed).toBe(2702);
    expect(ex.teams[2].unionExposed).toBe(287);
  });
  it("renders both teams' tables", () => {
    const own = renderToString(createElement(Exposure, { tl, team: tl.recorder.team as 1 | 2 }));
    expect(own).toContain("Fire exposure");
    expect(own).toContain("sarcozi01");
    expect(own).toContain("235 s");
    const foe = renderToString(createElement(Exposure, { tl, team: (tl.recorder.team === 1 ? 2 : 1) as 1 | 2 }));
    expect(foe).toContain("Tsunemikih");
    expect(foe).toContain("73 s");
  });
});
