import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { analyseTimeline } from "../src/analyse";

const r = validateTimeline(JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8")));
if (!r.ok) throw new Error("fixture invalid");
const tl = r.value;

describe("analyseTimeline", () => {
  it("one record per replay: schema, arena, recorder, one row per vehicle, WP samples every 30 s plus the end", () => {
    const rec = analyseTimeline(tl, "lesta-1.46-overlord-sbm44.timeline.json");
    expect(rec.schema).toBe("wotrep.corpus/1");
    expect(rec.file).toBe("lesta-1.46-overlord-sbm44.timeline.json");
    expect(rec.arena.mapDisplayName).toBe(tl.arena.mapDisplayName);
    expect(rec.recorder.vid).toBe(tl.recorder.vid);
    expect(rec.players).toHaveLength(tl.vehicles.length);
    expect(rec.players.map((p) => p.vid).sort((a, b) => a - b)).toEqual(tl.vehicles.map((v) => v.vid).sort((a, b) => a - b));
    expect(Array.isArray(rec.findings)).toBe(true);
    const end = Math.floor(tl.arena.durationS ?? 0);
    expect(rec.wp[0]!.t).toBe(0);
    expect(rec.wp.at(-1)!.t).toBe(end);
    expect(rec.wp.slice(0, -1).every((p, i) => i === 0 || p.t - rec.wp[i - 1]!.t === 30)).toBe(true);
    expect(rec.wp.every((p) => p.wp >= 0 && p.wp <= 1)).toBe(true);
    expect(rec.coverage.level).toMatch(/good|partial|low/);
  });
  it("works without results: computed fields fall back to null instead of throwing", () => {
    const rec = analyseTimeline({ ...tl, results: undefined }, "noresults.timeline.json");
    expect(rec.players.every((p) => p.damage === null && p.dpm === null)).toBe(true);
    expect(rec.players).toHaveLength(tl.vehicles.length);
  });
});
