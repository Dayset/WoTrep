import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseReplay } from "../src/index";

const rd = (p: string) => readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url));
const REPLAY = "replays/lesta-1.46-overlord-sbm44.mtreplay";
const NAME = "lesta-1.46-overlord-sbm44.mtreplay";

describe("fingerprint fallback (E1-14)", () => {
  it("with the manifest removed, the fixture still yields 24 kills and 1,362 recorder damage", async () => {
    const tl = await parseReplay(new Uint8Array(rd(REPLAY)), NAME, { manifests: [] });
    expect(tl.source.manifest.confidence).toBe("fingerprint");
    expect(tl.source.manifest.id).toMatch(/^fingerprint:/);
    expect(tl.events.filter((e) => e.k === "kill")).toHaveLength(24);
    const rec = tl.recorder.vid;
    const dmg = tl.events.reduce((s, e) => s + (e.k === "damage" && e.attacker === rec ? e.amount : 0), 0);
    expect(dmg).toBe(1362);
    expect(tl.results?.players[rec]?.damageDealt).toBe(1362);
  });
  it("default path still uses the exact manifest", async () => {
    const tl = await parseReplay(new Uint8Array(rd(REPLAY)), NAME);
    expect(tl.source.manifest.confidence).toBe("defs");
    expect(tl.source.manifest.id).toBe("lesta-1.46.0.0");
  });
});
