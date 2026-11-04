import { describe, expect, it } from "vitest";
import { killsFromPackets } from "../src/wgkill";

const rec = (victim: number, killer: number, reason: number) => { const b = new Uint8Array(16); const d = new DataView(b.buffer); b[0] = 0x78; b[1] = 1; d.setUint32(2, victim, true); d.setUint32(6, killer, true); b[10] = reason; return b; };
const pk = (clock: number, payload: Uint8Array, type = 0x37) => ({ type, clock, payload });

describe("killsFromPackets", () => {
  const ids = new Set([100, 101, 102]);
  it("reads victim, killer, reason and battle time, earliest record per victim", () => {
    const k = killsFromPackets([pk(50, rec(100, 101, 2)), pk(60, rec(100, 101, 2)), pk(70, rec(102, 100, 0))], ids, 30);
    expect(k).toEqual([{ k: "kill", t: 20, victim: 100, killer: 101, reason: 2, equipment: 0 }, { k: "kill", t: 40, victim: 102, killer: 100, reason: 0, equipment: 0 }]);
  });
  it("ignores unknown ids, other packet types and short or garbage payloads", () => {
    expect(killsFromPackets([pk(50, rec(999, 101, 0)), pk(50, rec(100, 101, 0), 0x07), pk(50, new Uint8Array([0x78, 1, 0, 0]))], ids, 0)).toEqual([]);
  });
});
