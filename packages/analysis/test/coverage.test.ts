import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { coverage } from "../src/index";

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
