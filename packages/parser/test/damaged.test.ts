import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseReplay } from "../src/index";

// Damaged copies of the checked-in replay must still give a timeline (with warnings), not a hard failure.
const full = new Uint8Array(readFileSync(new URL("../../../fixtures/replays/lesta-1.46-overlord-sbm44.mtreplay", import.meta.url)));
const cut = (share: number) => full.subarray(0, Math.floor(full.length * share));

describe("damaged replays", () => {
  it("a complete copy parses with no truncation warning", async () => {
    const tl = await parseReplay(full, "x.mtreplay");
    expect(tl.diagnostics.warnings.some((w) => /cut off|stopped early|ends inside/.test(w))).toBe(false);
  });
  it("a copy cut at 90% still gives a timeline and says it is cut off", async () => {
    const tl = await parseReplay(cut(0.9), "x.mtreplay");
    expect(tl.events.length).toBeGreaterThan(0);
    expect(tl.diagnostics.warnings.some((w) => /cut off|stopped early|ends inside|decompressed/.test(w))).toBe(true);
  });
  it("a copy cut at 50% still gives a timeline with fewer events", async () => {
    const full90 = await parseReplay(cut(0.9), "x.mtreplay");
    const half = await parseReplay(cut(0.5), "x.mtreplay");
    expect(half.events.length).toBeLessThan(full90.events.length);
  });
  it("a corrupted byte in the middle still gives a timeline", async () => {
    const b = new Uint8Array(full); const mid = Math.floor(b.length / 2); b[mid] = (b[mid] ?? 0) ^ 0xff;
    const tl = await parseReplay(b, "x.mtreplay");
    expect(tl.events.length).toBeGreaterThan(0);
  });
  it("an empty file fails with a typed container error, not a crash", async () => {
    await expect(parseReplay(new Uint8Array(0), "x.mtreplay")).rejects.toMatchObject({ stage: "container" });
  });
});
