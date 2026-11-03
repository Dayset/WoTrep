import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateTimeline, type BattleTimeline } from "@wotrep/model";
import { MESSAGE_KEYS, defineDetector, detectors, earlyHpDump, loadConfig, rank, runDetectors, costScore, type Finding } from "../src/index";

const FIX = new URL("../../../fixtures/", import.meta.url).pathname;
const load = (f: string): BattleTimeline => { const r = validateTimeline(JSON.parse(readFileSync(join(FIX, "timelines", f), "utf8"))); if (!r.ok) throw new Error(f); return r.value; };
const fixtures = readdirSync(join(FIX, "timelines")).filter((f) => f.endsWith(".timeline.json"));
const cfg = { a: { value: 1, why: "initial guess, recalibrate in E13" } };

describe("config provenance", () => {
  it("a value without a why fails", () => {
    expect(() => loadConfig({ a: { value: 1 } }, "x")).toThrow(/why/);
    expect(() => loadConfig({ a: { value: 1, why: "" } }, "x")).toThrow(/why/);
    expect(() => loadConfig({ a: { value: 1, why: "tbd" } }, "x")).toThrow(/why/);
  });
  it("a detector cannot be defined with an unjustified threshold", () => {
    expect(() => defineDetector({ id: "bad", version: 1, needs: [], config: { a: { value: 1 } }, detect: () => [] })).toThrow();
  });
  it("a justified config resolves to plain values", () => expect(loadConfig(cfg, "x")).toEqual({ a: 1 }));
  it("every shipped config file passes", () => { for (const d of detectors) expect(Object.keys(d.cfg).length).toBeGreaterThan(0); });
});

const mk = (kind: Finding["kind"], hp: number, conf = 0.9, t = 10): Finding => ({
  schema: "wotrep.finding/1", id: `d:1:${t}.0:${kind}${hp}`, detector: "d", detectorVersion: 1, vid: 1, kind, tStart: t, tEnd: t + 1, leadS: 3,
  cost: { hp }, confidence: conf, evidence: [], messageKey: "k", params: {},
});

describe("ranking", () => {
  it("keeps ≤5 mistakes and ≤3 good, highest cost first, hides low confidence unless asked", () => {
    const f = [...[100, 700, 300, 50, 900, 20, 400].map((h) => mk("mistake", h)), ...[1, 2, 3, 4].map((h) => mk("good", h)), mk("mistake", 5000, 0.3)];
    const r = rank(f);
    expect(r.filter((x) => x.kind === "mistake").map((x) => x.cost.hp)).toEqual([900, 700, 400, 300, 100]);
    expect(r.filter((x) => x.kind === "good")).toHaveLength(3);
    expect(rank(f, { showUncertain: true })[0]!.cost.hp).toBe(5000);
  });
  it("win-probability cost counts in the ordering", () => {
    expect(costScore({ ...mk("mistake", 0), cost: { winProbDelta: -0.1 } })).toBeGreaterThan(costScore(mk("mistake", 100)));
  });
});

describe("early-hp-dump", () => {
  const base = load(fixtures[0]!);
  const withHits = (amounts: [number, number][]): BattleTimeline => ({ ...base, events: [...base.events.filter((e) => !(e.k === "damage" && e.target === base.recorder.vid)), ...amounts.map(([t, amount]) => ({ k: "damage" as const, t, target: base.recorder.vid, attacker: 1, amount, hpBefore: 0, hpAfter: 0, reason: 0 }))].sort((a, b) => a.t - b.t) });
  const max = base.vehicles.find((v) => v.isRecorder)!.maxHealth;
  it("positive: ≥50% of max HP lost before 2:00 → one mistake with exact HP cost and stable id", () => {
    const f = earlyHpDump.detect({ tl: withHits([[30, max * 0.4], [60, max * 0.2]]), cfg: earlyHpDump.cfg });
    expect(f).toHaveLength(1); expect(f[0]!.kind).toBe("mistake"); expect(f[0]!.cost.hp).toBeCloseTo(max * 0.6, 5);
    expect(f[0]!.id).toBe(`early-hp-dump:${base.recorder.vid}:30.0`);
  });
  it("negative: same damage after 2:00, or under the threshold, gives nothing", () => {
    expect(earlyHpDump.detect({ tl: withHits([[130, max * 0.9]]), cfg: earlyHpDump.cfg })).toEqual([]);
    expect(earlyHpDump.detect({ tl: withHits([[30, max * 0.3]]), cfg: earlyHpDump.cfg })).toEqual([]);
  });
  it("is pure: same input, same output", () => {
    const tl = withHits([[30, max * 0.7]]); expect(earlyHpDump.detect({ tl, cfg: earlyHpDump.cfg })).toEqual(earlyHpDump.detect({ tl, cfg: earlyHpDump.cfg }));
  });
});

describe("fixture harness", () => {
  for (const f of fixtures) it(`findings on ${f} match the snapshot`, () => {
    const out = rank(runDetectors(load(f), detectors), { showUncertain: true });
    const dir = join(FIX, "expected", "findings"), file = join(dir, f.replace(".timeline.json", ".findings.json"));
    if (process.env.UPDATE_SNAPSHOTS === "1" || !existsSync(file)) { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(out, null, 2) + "\n"); }
    expect(out).toEqual(JSON.parse(readFileSync(file, "utf8")));
    for (const x of out) { expect(MESSAGE_KEYS as readonly string[]).toContain(x.messageKey); expect(x.confidence).toBeGreaterThanOrEqual(0); expect(x.confidence).toBeLessThanOrEqual(1); if (x.kind === "mistake") expect(Object.keys(x.cost).length).toBeGreaterThan(0); }
  });
});
