import { describe, expect, it } from "vitest";
import { normalizePage } from "../src/lesta";

const ok = { status: "ok", meta: { count: 1 }, data: { "1": { tag: "R40_T-54", name: "T-54", short_name: "T-54", tier: 9, type: "mediumTank", nation: "ussr", default_profile: { anything: 1 } } } };
describe("normalizePage", () => {
  it("keeps certain fields and passes the profile through untouched", () => expect(normalizePage(ok)).toEqual([{ tag: "R40_T-54", name: "T-54", short: "T-54", tier: 9, type: "mediumTank", nation: "ussr", profile: { anything: 1 } }]));
  it("rejects API errors and malformed vehicles instead of storing junk", () => {
    expect(() => normalizePage({ status: "error", error: { code: 407 } })).toThrow();
    expect(() => normalizePage({ ...ok, data: { "1": { tag: "x" } } })).toThrow();
  });
});
