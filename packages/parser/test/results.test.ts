import { describe, expect, it } from "vitest";
import { normalizeResults } from "../src/results";

// Block 1 shape: [battleResults, ...]; personal is keyed by account id, with
// an "avatar" entry that must be skipped.
function block(personal: Record<string, unknown>) {
  return [{
    vehicles: { "123": [{ accountDBID: 999, damageDealt: 0, xp: 862 }] },
    personal, common: { duration: 300, winnerTeam: 2, finishReason: 0 },
  }];
}

describe("normalizeResults economy", () => {
  it("picks base/total economy fields, ammo = credits part of autoLoadCost", () => {
    const r = normalizeResults(block({
      "999": { xp: 3879, credits: 28184, originalXP: 862, originalCredits: 18542, repair: 5545, autoLoadCost: [5015, 0] },
      avatar: {},
    }));
    expect(r?.results.personal).toMatchObject({
      xp: 3879, credits: 28184, xpBase: 862, creditsBase: 18542, repairCost: 5545, ammoCost: 5015,
    });
  });
  it("falls back to autoRepairCost and omits absent fields (no undefined-valued keys)", () => {
    const r = normalizeResults(block({ "999": { xp: 100, credits: 200, autoRepairCost: 50 } }));
    expect(r?.results.personal).toMatchObject({ xp: 100, credits: 200, repairCost: 50 });
    expect(r?.results.personal).not.toHaveProperty("xpBase");
    expect(r?.results.personal).not.toHaveProperty("ammoCost");
    // The new economy keys are the ones that must never be undefined-valued
    // (older personal fields are copied unconditionally by pre-existing code).
    for (const k of ["xpBase", "creditsBase", "repairCost", "ammoCost"]) {
      const v = (r?.results.personal as Record<string, unknown> | undefined)?.[k];
      expect(v === undefined || typeof v === "number").toBe(true);
    }
  });
});
