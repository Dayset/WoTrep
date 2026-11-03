import { describe, expect, it } from "vitest";
import { resolveManifest } from "../src/manifest";

describe("wg 2.4.1.0 draft manifest", () => {
  it("resolves exactly for wg and is marked as a fingerprint draft; not for lesta", () => {
    const r = resolveManifest("wg", "2.4.1.0"); expect(r.manifest?.id).toBe("wg-2.4.1.0"); expect(r.manifest?.confidence).toBe("fingerprint");
    expect(r.manifest?.avatar.showTracer?.idx).toBe(37); expect(r.manifest?.vehicle.onHealthChanged?.idx).toBe(4);
    expect(resolveManifest("lesta", "2.4.1.0").manifest).toBeNull();
  });
});
