import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseReplay } from "../src/index";

// The replay is a user's file with real player names, so it lives in the git-ignored fixtures/local/ and this test skips without it.
const path = new URL("../../../fixtures/local/wg-2.4.1-overlord-eu.wotreplay", import.meta.url);
describe.skipIf(!existsSync(path))("Wargaming 2.4.1.0 draft manifest (local replay)", () => {
  it("matches the official recorder numbers, battle start and shell end points", async () => {
    const tl = await parseReplay(new Uint8Array(readFileSync(path)), "x.wotreplay"), rec = tl.recorder.vid, ev = tl.events as any[];
    expect(tl.source.realm).toBe("wg"); expect(tl.source.manifest).toEqual({ id: "wg-2.4.1.0", confidence: "fingerprint" });
    expect(tl.arena.battleStartClock).toBeCloseTo(31.41, 1);
    const mine = ev.filter((e) => e.k === "damage" && e.attacker === rec && tl.vehicles.find((v) => v.vid === e.target)?.team !== tl.recorder.team);
    expect(mine.reduce((s, e) => s + e.amount, 0)).toBe(6753);                         // = results damageDealt
    expect(ev.filter((e) => e.k === "shot" && e.shooter === rec).length).toBe(25);      // = results shots
    const ids = new Set(ev.filter((e) => e.k === "shot").map((e) => e.shotId)), ends = ev.filter((e) => e.k === "projectileEnd");
    const kills = ev.filter((e) => e.k === "kill"); expect(kills.length).toBe(27);       // results list 27 destroyed tanks
    expect(kills.every((k) => tl.vehicles.some((v) => v.vid === k.victim))).toBe(true);
    expect(tl.diagnostics.warnings.some((w) => w.startsWith("kills read from 0x37 packets"))).toBe(true);
    for (const k of kills) { const r = tl.results!.players[k.victim]!; expect(k.killer).toBe(r.killerVid); expect(k.reason).toBe(r.deathReason); expect(Math.abs(k.t - r.lifeTimeS)).toBeLessThan(35); }
    expect(ends.length).toBe(121); expect(ends.every((e) => ids.has(e.shotId))).toBe(true);
  });
});
