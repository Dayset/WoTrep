import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processFile } from "../src/run";

const fixture = readFileSync(new URL("../../../fixtures/timelines/lesta-1.46-overlord-sbm44.timeline.json", import.meta.url));
const read = (files: Record<string, Uint8Array>) => async (p: string) => {
  const b = files[p];
  if (!b) throw new Error("ENOENT");
  return b;
};

describe("processFile", () => {
  it("timeline JSON → record; bad JSON → parse failure; garbage replay → parse failure; missing file → read failure", async () => {
    const r = await processFile(read({ "a/b.timeline.json": fixture }), "a/b.timeline.json");
    expect("record" in r).toBe(true);
    if ("record" in r) expect(r.record.players.length).toBeGreaterThan(0);
    const bad = await processFile(read({ "bad.timeline.json": new TextEncoder().encode("{nope") }), "bad.timeline.json");
    expect(bad).toEqual({ failure: expect.objectContaining({ file: "bad.timeline.json", stage: "parse" }) });
    const garbage = await processFile(read({ "x.mtreplay": new Uint8Array([1, 2, 3]) }), "x.mtreplay");
    expect(garbage).toEqual({ failure: expect.objectContaining({ file: "x.mtreplay", stage: "parse" }) });
    const missing = await processFile(read({}), "gone.mtreplay");
    expect(missing).toEqual({ failure: expect.objectContaining({ file: "gone.mtreplay", stage: "read" }) });
  });
  it("unsupported extension → parse failure, not a crash", async () => {
    const r = await processFile(read({ "notes.txt": new TextEncoder().encode("hi") }), "notes.txt");
    expect(r).toEqual({ failure: expect.objectContaining({ stage: "parse" }) });
  });
});
