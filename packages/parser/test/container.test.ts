import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Blowfish, ParseError, readContainer } from "../src/index";

const file = new Uint8Array(readFileSync(new URL("../../../fixtures/replays/lesta-1.46-overlord-sbm44.mtreplay", import.meta.url)));
describe("Blowfish", () => {
  it("matches the Eric Young test vector (key 0000000000000000, plain 0 -> 4EF997456198DD78)", () => {
    const bf = new Blowfish(new Uint8Array(8));
    const b = Uint8Array.from([0x4e, 0xf9, 0x97, 0x45, 0x61, 0x98, 0xdd, 0x78]);
    bf.decryptBlock(b, 0);
    expect([...b]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
describe("readContainer", () => {
  it("reads the fixture", () => {
    const c = readContainer(file);
    expect(c.blocks.length).toBe(2);
    expect(c.packets.byteLength).toBe(5148653);
    expect([...c.packets.subarray(0, 12)]).toEqual([...Uint8Array.from([0x0c, 0, 0, 0, 0x18, 0, 0, 0, 0, 0, 0, 0])]);
  });
  it("types its errors", () => {
    const t = (f: () => unknown) => { try { f(); } catch (e) { return (e as ParseError).code; } return "none"; };
    expect(t(() => readContainer(file.subarray(0, 100)))).toBe("Truncated");
    expect(t(() => readContainer(new Uint8Array(64)))).toBe("BadMagic");
    // a stream cut short keeps the output it has and says so
    const cutC = readContainer(file.subarray(0, file.length - 5000));
    expect(cutC.packets.byteLength).toBeGreaterThan(0);
    expect(cutC.warnings.join(" ")).toMatch(/cut off|stopped early|decompressed/);
  });
});
