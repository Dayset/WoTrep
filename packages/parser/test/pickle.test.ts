import { describe, expect, it } from "vitest";
import { readBwString, unpickle } from "../src/index";

const b = (...x: number[]) => Uint8Array.from(x);
describe("unpickle", () => {
  it("decodes a protocol-2 dict with tuple, list, ints", () => {
    // {'a': (1, 2), 'b': [3]}
    const p = b(0x80, 2, 0x7d, 0x71, 0, 0x28, 0x55, 1, 0x61, 0x71, 1, 0x4b, 1, 0x4b, 2, 0x86, 0x71, 2, 0x55, 1, 0x62, 0x71, 3, 0x5d, 0x71, 4, 0x4b, 3, 0x61, 0x75, 0x2e);
    expect(unpickle(p)).toEqual({ a: [1, 2], b: [3] });
  });
  it("turns GLOBAL+REDUCE into a tagged object instead of executing", () => {
    const g = new TextEncoder().encode("cos\nsystem\n");
    const p = Uint8Array.from([0x80, 2, ...g, 0x55, 2, 0x6c, 0x73, 0x85, 0x52, 0x2e]);
    expect(unpickle(p)).toEqual({ __global: "os.system", args: ["ls"] });
  });
  it("rejects unknown opcodes with a typed error", () => {
    expect(() => unpickle(b(0x80, 2, 0xff, 0x2e))).toThrowError(/unknown opcode/);
  });
  it("survives 1000 random mutations without hanging or untyped errors", () => {
    const base = b(0x80, 2, 0x7d, 0x71, 0, 0x55, 1, 0x61, 0x4b, 1, 0x73, 0x2e);
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let i = 0; i < 1000; i++) {
      const m = base.slice(); m[rnd() % m.length] = rnd() & 255;
      const t0 = performance.now();
      try { unpickle(m); } catch (e) { expect((e as Error).name).toBe("ParseError"); }
      expect(performance.now() - t0).toBeLessThan(50);
    }
  });
});
describe("readBwString", () => {
  it("reads short and long forms", () => {
    expect(readBwString(b(2, 65, 66, 9))).toEqual([b(65, 66), 3]);
    const long = Uint8Array.from([0xff, 3, 0, 0, 1, 2, 3]);
    expect(readBwString(long)[0]).toEqual(b(1, 2, 3));
  });
});

import { readFileSync } from "node:fs";
import { inflateSync } from "fflate";
import { readContainer, walkPackets } from "../src/index";
describe("fixture updateArena payloads", () => {
  it("decodes all 89 avatar method-66 payloads (zlib-wrapped ones included)", () => {
    const { packets } = readContainer(new Uint8Array(readFileSync(new URL("../../../fixtures/replays/lesta-1.46-overlord-sbm44.mtreplay", import.meta.url))));
    const ps = walkPackets(packets).packets;
    let avatar = 0;
    for (const p of ps) if (p.type === 0x0a) { const dv = new DataView(p.payload.buffer, p.payload.byteOffset); if (dv.getUint32(4, true)) { avatar = dv.getUint32(0, true); break; } }
    let n = 0; const kinds = new Set<number>();
    for (const p of ps) {
      if (p.type !== 0x08) continue;
      const dv = new DataView(p.payload.buffer, p.payload.byteOffset);
      if (dv.getUint32(0, true) !== avatar || dv.getUint32(4, true) !== 66) continue;
      const a = p.payload.subarray(12, 12 + dv.getUint32(8, true));
      const [s] = readBwString(a, 1);
      const body = s[0] === 0x78 ? inflateSync(s.subarray(2)) : s;
      expect(unpickle(body)).toBeDefined(); kinds.add(a[0]!); n++;
    }
    expect(avatar).toBe(13880579);
    expect(n).toBe(89);
    expect(kinds.has(6)).toBe(true);
  });
});
