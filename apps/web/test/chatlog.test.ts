import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "@wotrep/model";
import { ChatLog } from "../src/features/player/ChatLog";
import fixture from "../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json";

// Fixture timeline carries no chat, so chat rows are injected: one pre-battle,
// one from a vehicle on the recorder's side (OTBEPTOK, team 2 = recorder team),
// one with no matching vehicle. Server rendering skips effects, so the
// auto-scroll effect is not exercised here; the row markup is.
(globalThis as unknown as { window: unknown }).window = { matchMedia: undefined, devicePixelRatio: 1, scrollTo: () => {} };

function withChat() {
  const r = validateTimeline(fixture as never);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("fixture invalid");
  return {
    ...r.value,
    events: [
      ...r.value.events,
      { k: "chat", t: -8.5, team: "all", sender: "OTBEPTOK[-TMN_] (TDM-54)", text: "hello pre-battle" },
      { k: "chat", t: 50, team: "all", sender: "NobodyHere (IS-7)", text: "second message" },
    ],
  } as typeof r.value;
}

describe("ChatLog", () => {
  it("renders nothing when the replay has no chat", () => {
    const r = validateTimeline(fixture as never);
    if (!r.ok) throw new Error("fixture invalid");
    expect(renderToString(createElement(ChatLog, { tl: r.value, now: 100, onSeek: () => {} }))).toBe("");
  });
  it("renders chat rows with time, sender side and text; past rows marked current", () => {
    const html = renderToString(createElement(ChatLog, { tl: withChat(), now: 60, onSeek: () => {} }));
    expect(html).toContain("data-testid=\"chatlog\"");
    expect(html).toContain("Battle chat");
    expect(html).toContain("−0:08");
    expect(html).toContain("0:50");
    expect(html).toContain("hello pre-battle");
    expect(html).toContain("second message");
    // OTBEPTOK is on the recorder's team, so the sender span carries ally.
    expect(html).toContain("class=\"ally\"");
    // Both rows are at or before now=60, so the latest one is current.
    expect(html).toContain("dlogrow cur");
  });
});
