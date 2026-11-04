import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CodecError, decodeTimeline, encodeTimeline, validateTimeline, type BattleTimeline } from "../src/index";

const load = (): BattleTimeline => {
  const raw = JSON.parse(readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url), "utf8"));
  const r = validateTimeline(raw);
  if (!r.ok) throw new Error(`fixture invalid: ${r.errors.join("; ")}`);
  return r.value;
};

const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

describe("codec (E2-05)", () => {
  it("encodes the fixture to ≤ 400 KB and decodes it in < 50 ms (best of 3)", () => {
    const tl = load();
    const bytes = encodeTimeline(tl);
    expect(bytes.byteLength).toBeLessThanOrEqual(400 * 1024);
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      decodeTimeline(bytes);
      times.push(performance.now() - start);
    }
    expect(Math.min(...times)).toBeLessThan(50);
  });
  it("round-trips the fixture within quantisation", () => {
    const tl = load();
    const dec = decodeTimeline(encodeTimeline(tl));
    expect(validateTimeline(dec).ok).toBe(true);
    expect(dec.source).toEqual(tl.source);
    expect(dec.arena).toEqual(tl.arena);
    expect(dec.recorder).toEqual(tl.recorder);
    expect(dec.vehicles).toEqual(tl.vehicles);
    expect(dec.results).toEqual(tl.results);
    expect(dec.diagnostics).toEqual(tl.diagnostics);
    expect(dec.camera.mode).toEqual(tl.camera.mode);
    expect(dec.camera.t.length).toBe(tl.camera.t.length);
    for (let i = 0; i < tl.camera.t.length; i++) expect(close(dec.camera.t[i]!, tl.camera.t[i]!, 0.01)).toBe(true);
    expect(Object.keys(dec.tracks).sort()).toEqual(Object.keys(tl.tracks).sort());
    for (const vid of Object.keys(tl.tracks)) {
      const a = tl.tracks[Number(vid)]!, b = dec.tracks[Number(vid)]!;
      expect(b.visible).toEqual(a.visible.map(([f, t]) => [Math.round(f * 100) / 100, Math.round(t * 100) / 100]));
      for (const key of ["t", "x", "z", "y", "yaw"] as const) {
        expect(b[key].length).toBe(a[key].length);
        const tol = key === "t" ? 0.01 : key === "yaw" ? 0.01 : 0.1;
        for (let i = 0; i < a[key].length; i++) expect(close(b[key][i]!, a[key][i]!, tol)).toBe(true);
      }
    }
    expect(dec.events.length).toBe(tl.events.length);
    for (let i = 0; i < tl.events.length; i++) {
      const a = tl.events[i]!, b = dec.events[i]!;
      expect(b.k).toBe(a.k);
      expect(close(b.t, a.t, 0.01)).toBe(true);
      if (a.k === "projectileEnd" && b.k === "projectileEnd") {
        expect(b.shotId).toBe(a.shotId);
        expect(close(b.x, a.x, 0.1) && close(b.y, a.y, 0.1) && close(b.z, a.z, 0.1)).toBe(true);
      } else {
        const stripT = (e: typeof a) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== "t"));
        expect(stripT(b)).toEqual(stripT(a));
      }
    }
  });
  it("round-trips optionals: no results, aim present, gunYaw present", () => {
    const tl = load();
    const noResults = { ...tl };
    delete noResults.results;
    const withAim: BattleTimeline = {
      ...noResults,
      aim: { t: [0, 1.5, 3.25], pos: [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9], dir: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] },
    };
    const vid = Number(Object.keys(withAim.tracks)[0]!);
    withAim.tracks[vid] = { ...withAim.tracks[vid]!, gunYaw: withAim.tracks[vid]!.yaw.map((v) => v + 0.5) };
    const dec = decodeTimeline(encodeTimeline(withAim));
    expect(dec.results).toBeUndefined();
    expect(dec.aim).toBeDefined();
    expect(dec.aim!.t).toEqual([0, 1.5, 3.25]);
    for (let i = 0; i < dec.aim!.pos.length; i++) expect(close(dec.aim!.pos[i]!, withAim.aim!.pos[i]!, 1e-6)).toBe(true);
    const gy = dec.tracks[vid]!.gunYaw!;
    expect(gy.length).toBe(withAim.tracks[vid]!.yaw.length);
    for (let i = 0; i < gy.length; i++) expect(close(gy[i]!, withAim.tracks[vid]!.yaw[i]! + 0.5, 0.01)).toBe(true);
  });
  it("rejects bad magic, wrong version and truncated input", () => {
    const bytes = encodeTimeline(load());
    const badMagic = bytes.slice(); badMagic[0] = "X".charCodeAt(0);
    expect(() => decodeTimeline(badMagic)).toThrow(CodecError);
    const badVersion = bytes.slice(); badVersion[4] = 99;
    expect(() => decodeTimeline(badVersion)).toThrow(CodecError);
    expect(() => decodeTimeline(bytes.slice(0, 10))).toThrow(CodecError);
    expect(() => decodeTimeline(bytes.slice(0, bytes.length - 1))).toThrow(CodecError);
  });
});
