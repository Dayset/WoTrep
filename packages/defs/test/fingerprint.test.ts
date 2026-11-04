import { describe, expect, it } from "vitest";
import { fingerprintManifest, type FingerprintCall } from "../src/fingerprint";

const VIDS = new Set([1001, 1002, 1003]);
const REC = 1001;
const enc = new TextEncoder();

function health(nh: number, oh: number, atk: number): Uint8Array {
  const b = new Uint8Array(9);
  const dv = new DataView(b.buffer);
  dv.setInt16(0, nh, true); dv.setInt16(2, oh, true); dv.setUint32(4, atk, true); b[8] = 1;
  return b;
}
function tracer(vid: number): Uint8Array {
  const b = new Uint8Array(51);
  new DataView(b.buffer).setUint32(0, vid, true);
  return b;
}
/** Arena stub: 0xAA-prefixed args decode as {type, JSON value}; anything else is undecodable. */
const decode = (args: Uint8Array) => {
  if (args[0] !== 0xaa) return null;
  return { type: args[1]!, value: JSON.parse(new TextDecoder().decode(args.subarray(2))) as unknown };
};
function arena(type: number, value: unknown): Uint8Array {
  const body = enc.encode(JSON.stringify(value));
  const b = new Uint8Array(2 + body.byteLength);
  b[0] = 0xaa; b[1] = type; b.set(body, 2);
  return b;
}

function baseCalls(): FingerprintCall[] {
  return [
    // onHealthChanged idx 7: recorder-attacker deltas 500 + 400 + 462 = 1362; decoy idx 9 sums to 999.
    { kind: "vehicle", idx: 7, args: health(500, 1000, REC) },
    { kind: "vehicle", idx: 7, args: health(600, 1000, REC) },
    { kind: "vehicle", idx: 7, args: health(538, 1000, REC) },
    { kind: "vehicle", idx: 9, args: health(1, 1000, REC) },
    { kind: "vehicle", idx: 11, args: new Uint8Array(12) },
    // showTracer idx 12 (all 51 bytes, vid-start); decoy idx 13 starts with a non-vehicle id.
    { kind: "avatar", idx: 12, args: tracer(1002) },
    { kind: "avatar", idx: 12, args: tracer(1003) },
    { kind: "avatar", idx: 13, args: tracer(999999) },
    // updateArena idx 5: period sequence 1, 2, 3 + two vehicleKilled-shaped values.
    { kind: "avatar", idx: 5, args: arena(3, [1, 100000, 60]) },
    { kind: "avatar", idx: 5, args: arena(3, [2, 200, 30]) },
    { kind: "avatar", idx: 5, args: arena(3, [3, 3000000, 15]) },
    { kind: "avatar", idx: 5, args: arena(6, [1002, 1003, 0, 0]) },
    { kind: "avatar", idx: 5, args: arena(6, [1003, 1002, 0, 0]) },
    // variable-length but undecodable avatar method: must not be picked as updateArena.
    { kind: "avatar", idx: 8, args: new Uint8Array(10) },
    { kind: "avatar", idx: 8, args: new Uint8Array(20) },
    { kind: "avatar", idx: 8, args: new Uint8Array(30) },
  ];
}
const ctx = { vehicleIds: VIDS, recorderVid: REC, recorderDamageDealt: 1362, realm: "lesta" as const, version: "9.99.9.9" };

describe("fingerprintManifest", () => {
  it("infers the three methods and both arena types into a fingerprint draft", () => {
    const r = fingerprintManifest(baseCalls(), ctx, decode);
    expect(r).not.toBeNull();
    expect(r!.methods).toEqual({ onHealthChanged: 7, showTracer: 12, updateArena: 5 });
    expect(r!.arenaUpdateTypes).toEqual({ period: 3, vehicleKilled: 6 });
    expect(r!.manifest.confidence).toBe("fingerprint");
    expect(r!.manifest.id).toBe("fingerprint:lesta-9.99.9.9");
    expect(r!.manifest.vehicle.onHealthChanged!.idx).toBe(7);
    expect(r!.manifest.avatar.showTracer!.idx).toBe(12);
    expect(r!.manifest.avatar.updateArena!.idx).toBe(5);
    expect(r!.manifest.vehicleProperties).toEqual({});
  });
  it("health sum mismatch → null (no guess)", () => {
    expect(fingerprintManifest(baseCalls(), { ...ctx, recorderDamageDealt: 1363 }, decode)).toBeNull();
  });
  it("two valid tracers → null (ambiguous)", () => {
    const calls = [...baseCalls(), { kind: "avatar", idx: 14, args: tracer(1002) }, { kind: "avatar", idx: 14, args: tracer(1003) }] as FingerprintCall[];
    expect(fingerprintManifest(calls, ctx, decode)).toBeNull();
  });
  it("undecodable arena payloads → null", () => {
    expect(fingerprintManifest(baseCalls(), ctx, () => null)).toBeNull();
  });
  it("zero-damage recorder with a single 9-byte vehicle method still matches", () => {
    const calls: FingerprintCall[] = [
      { kind: "vehicle", idx: 7, args: health(500, 1000, 1002) },
      { kind: "avatar", idx: 12, args: tracer(1002) },
      { kind: "avatar", idx: 5, args: arena(3, [1, 100000, 60]) },
      { kind: "avatar", idx: 5, args: arena(3, [2, 200, 30]) },
      { kind: "avatar", idx: 5, args: arena(3, [3, 3000000, 15]) },
      { kind: "avatar", idx: 5, args: arena(6, [1002, 1003, 0, 0]) },
    ];
    const r = fingerprintManifest(calls, { ...ctx, recorderDamageDealt: 0 }, decode);
    expect(r?.methods.onHealthChanged).toBe(7);
  });
});
