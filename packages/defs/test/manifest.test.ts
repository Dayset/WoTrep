import { describe, expect, it } from "vitest";
import { resolveManifest } from "../src/index";

describe("resolveManifest", () => {
  it("exact match", () => {
    const r = resolveManifest("lesta", "1.46.0.0");
    expect(r.manifest?.id).toBe("lesta-1.46.0.0");
    const m = r.manifest!;
    expect(m.avatar.updateArena?.idx).toBe(66); expect(m.vehicle.onHealthChanged?.idx).toBe(3);
    expect(m.avatar.updateArena?.conf).toBe("V"); expect(m.arenaUpdateTypes.vehicleKilled).toBe(6);
  });
  it("same minor falls back, flagged", () => {
    const r = resolveManifest("lesta", "1.46.1.0");
    expect(r.manifest?.confidence).toBe("fallback"); expect("exact" in r && r.exact).toBe(false);
  });
  it("unknown version/realm returns null with a reason, never throws", () => {
    const a = resolveManifest("lesta", "2.0.0.0"), b = resolveManifest("wg", "1.46.0.0");
    expect(a.manifest).toBeNull(); expect(b.manifest).toBeNull();
    expect("reason" in a && a.reason).toMatch(/no manifest/);
  });
});
