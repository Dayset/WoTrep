import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { Report } from "../src/features/report/Report";
import fixture from "../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json";

// #118 render check: the Report renders the one fixture timeline. Server rendering
// runs the component function but not effects, so canvas/three drawing is skipped;
// the only browser surface the render touches is Player's window.matchMedia probe,
// stubbed here (Feedback's localStorage and Debug's location reads are try/caught).
(globalThis as unknown as { window: unknown }).window = { matchMedia: undefined, devicePixelRatio: 1, scrollTo: () => {} };

describe("report renders the fixture", () => {
  it("header, KPIs and tabs render without a browser", () => {
    const r = validateTimeline(fixture as never);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("fixture invalid");
    const html = renderToString(createElement(Report, { tl: r.value, onBack: () => {} }));
    expect(html).toContain("data-testid=\"report\"");
    expect(html).toContain("Victory");
    expect(html).toContain("Оверлорд");
    expect(html).toContain("1362");
    expect(html).toContain("+10.3");
    expect(html).toContain("Replay");
  });
});
