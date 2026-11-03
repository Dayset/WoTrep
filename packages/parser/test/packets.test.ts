import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readContainer, walkPackets } from "../src/index";

const exp = JSON.parse(readFileSync(new URL("../../../fixtures/expected/lesta-1.46-overlord-sbm44.expected.json", import.meta.url), "utf8"));
const file = new Uint8Array(readFileSync(new URL("../../../fixtures/replays/lesta-1.46-overlord-sbm44.mtreplay", import.meta.url)));
describe("walkPackets", () => {
  it("matches the oracle's count and type histogram, fast", () => {
    const { packets } = readContainer(file);
    const t0 = performance.now();
    const w = walkPackets(packets);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(w.packets.length).toBe(exp.packetCount);
    const h: Record<string, number> = {};
    for (const p of w.packets) { const k = "0x" + p.type.toString(16).padStart(2, "0"); h[k] = (h[k] ?? 0) + 1; }
    const want: Record<string, number> = {};
    for (const [k, v] of Object.entries(exp.packetTypeCounts)) want[k.toLowerCase()] = v as number;
    expect(h).toEqual(want);
    expect(w.warnings).toEqual([]);
  });
  it("throws a typed error on a lying length", () => {
    const b = new Uint8Array(16); new DataView(b.buffer).setUint32(0, 999, true);
    expect(() => walkPackets(b)).toThrowError(/claims 999/);
  });
});
