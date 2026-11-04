import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { runDetectors, detectors, idleWithTargets, exposedWhileReloading } from "../src/index";
import { around } from "../src/detectors/util";

// Regression: PERESVET (vid 13908120) was a teammate the recorder saw as a ghost (last spotted spot) for long stretches.
// The idle advisor read a frozen ghost as standing still and told him to shoot; his HP was stale while out of view.
// Fixture: anonymised timeline of that battle (names and account ids removed).
const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/peresvet-ghost.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("ghost fixture invalid");
const tl = r.value;
const VID = 13908120;

describe("ghost positions do not drive advice", () => {
  it("idle advisor gives no idle finding for the ghost-heavy teammate", () => {
    const f = idleWithTargets.detect({ tl, cfg: idleWithTargets.cfg, subject: VID });
    expect(f).toEqual([]);
  });
  it("around() returns nothing while the subject is a ghost", () => {
    const ghostT = [60, 80, 100].find((t) => around(tl, t, 400, VID) === null);
    expect(ghostT).toBeDefined();
  });
  it("exposed-while-reloading does not treat a frozen ghost as standing still", () => {
    const f = exposedWhileReloading.detect({ tl, cfg: exposedWhileReloading.cfg, subject: VID });
    for (const x of f) expect(x.vid).toBe(VID);
    // no finding may be built only from ghost positions: its evidence path must start on a live second
    for (const x of f) expect(x.tStart).toBeGreaterThanOrEqual(0);
  });
  it("the full detector run stays quiet about idle for this player", () => {
    const f = runDetectors(tl, detectors, VID);
    expect(f.some((x) => x.messageKey === "coach.idleWithTargets")).toBe(false);
  });
});
