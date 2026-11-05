import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { Economy } from "../src/features/report/Economy";
import fixture from "../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json";

(globalThis as unknown as { window: unknown }).window = { matchMedia: undefined, devicePixelRatio: 1, scrollTo: () => {} };

function base() {
  const r = validateTimeline(fixture as never);
  if (!r.ok) throw new Error("fixture invalid");
  return r.value;
}

describe("Economy", () => {
  it("renders nothing without personal economy", () => {
    expect(renderToString(createElement(Economy, { tl: base() }))).toBe("");
  });
  it("renders base → total, costs and derived profit", () => {
    const tl = { ...base(), results: { ...base().results!, personal: {
      xp: 3879, credits: 28184, xpBase: 862, creditsBase: 18542, repairCost: 5545, ammoCost: 5015,
    } } };
    // SSR inserts <!-- --> between JSX expressions; strip them before matching.
    const html = renderToString(createElement(Economy, { tl })).replace(/<!-- -->/g, "");
    expect(html).toContain("data-testid=\"economy\"");
    expect(html).toContain("Battle economy");
    expect(html).toContain("862 → 3,879");
    expect(html).toContain("18,542 → 28,184");
    expect(html).toContain("Repair −5,545");
    expect(html).toContain("Ammo −5,015");
    expect(html).toContain("Profit 17,624");
  });
  it("omits profit when a cost is missing", () => {
    const tl = { ...base(), results: { ...base().results!, personal: { xp: 100, credits: 200 } } };
    const html = renderToString(createElement(Economy, { tl })).replace(/<!-- -->/g, "");
    expect(html).toContain("100");
    // The note still mentions profit in its formula; only the profit value must be absent.
    expect(html).not.toContain("<b>Profit");
  });
});
