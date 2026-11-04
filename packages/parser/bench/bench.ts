import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveManifest } from "@wotrep/defs";
import {
  buildTracks, decodeCamera, decodeChat, decodeEvents, dispatchCalls, findAvatar, findBattleStart,
  killsFromResults, normalizeResults, parseReplay, readContainer, walkPackets,
} from "../src/index";
import { killsFromPackets } from "../src/wgkill";

/** Parser benchmark (#35): each DESIGN.md §4 worker stage, 10 runs per fixture, medians.
 *  Stages mirror parseReplay's pipeline (build.ts) using the same exported functions:
 *  - container: readContainer = Blowfish decrypt + inflate (budget 150 ms)
 *  - walk: walkPackets + findAvatar + dispatchCalls + findBattleStart (budget 400 ms)
 *  - build: normalizeResults + decodeEvents + decodeChat + kills rebuild + buildTracks + decodeCamera (budget 150 ms)
 *  Excluded from the stages, and reported as the residual: manifest resolution (per-fixture,
 *  computed once), the KNOWN-type scan (~1 ms), the vehicles map, timeline validation and the
 *  sha256 — plus the DESIGN "transfer to main thread" part, which has no Node equivalent.
 *  Fails (exit 1) when any stage median exceeds its budget by > 30%.
 */
const BUDGETS = { container: 150, walk: 400, build: 150 } as const;
type Stage = keyof typeof BUDGETS;
const RUNS = 10;

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2; };
const time = <T>(fn: () => T): [T, number] => { const s = performance.now(); const v = fn(); return [v, performance.now() - s]; };

/** The block-0 fields the bench reads — the same three build.ts reads (see parser/src/build.ts). */
interface Block0 { clientVersionFromXml?: string; clientVersionFromExe?: string; vehicles: Record<string, unknown> }

interface Setup { b0: Block0; b1: unknown; realm: "wg" | "lesta"; version: string; manifest: ReturnType<typeof resolveManifest>; vehicleIds: Set<number> }

function setup(bytes: Uint8Array, fileName: string): Setup {
  const { blocks } = readContainer(bytes);
  const b0 = blocks[0] as Block0, b1 = blocks[1];
  const realm: "wg" | "lesta" = /\.mtreplay$/i.test(fileName) || /Мир танков/.test(b0.clientVersionFromXml ?? "") ? "lesta" : "wg";
  const version: string = b0.clientVersionFromExe ?? "";
  return { b0, b1, realm, version, manifest: resolveManifest(realm, version), vehicleIds: new Set(Object.keys(b0.vehicles).map(Number)) };
}

function runStages(bytes: Uint8Array, s: Setup): Record<Stage, number> {
  const [container, containerMs] = time(() => readContainer(bytes));
  const raw = container.packets;
  const [walked, walkMs] = time(() => {
    const walk = walkPackets(raw);
    const av = findAvatar(walk.packets, s.vehicleIds);
    if (!av) throw new Error("recorder avatar not found");
    const calls = s.manifest.manifest ? dispatchCalls(walk.packets, { ...av, vehicleIds: s.vehicleIds }, s.manifest.manifest, {}) : [];
    const t0 = s.manifest.manifest ? findBattleStart(calls, s.manifest.manifest) : null;
    return { packets: walk.packets, calls, t0 };
  });
  const T0 = walked.t0 ?? 0;
  const [, buildMs] = time(() => {
    const nr = normalizeResults(s.b1);
    const events = [...(s.manifest.manifest ? decodeEvents(walked.calls, s.manifest.manifest, T0) : []), ...decodeChat(walked.packets, T0)].sort((a, b) => a.t - b.t);
    if (nr && walked.t0 != null && !events.some((e) => e.k === "kill")) {
      const fromPk = killsFromPackets(walked.packets, s.vehicleIds, T0);
      const have = new Set(fromPk.map((e) => (e.k === "kill" ? e.victim : -1)));
      events.push(...fromPk, ...killsFromResults(nr.results).filter((e) => e.k === "kill" && !have.has(e.victim)));
    }
    buildTracks(walked.packets, s.vehicleIds, T0);
    decodeCamera(walked.packets, T0);
  });
  return { container: containerMs, walk: walkMs, build: buildMs };
}

const FIXDIR = new URL("../../../fixtures/replays/", import.meta.url).pathname;
const fixtures = readdirSync(FIXDIR).filter((f) => /\.(mt|wo)replay$/i.test(f)).sort();
if (!fixtures.length) { console.error("no fixtures in fixtures/replays/"); process.exit(1); }
let failed = false;
for (const f of fixtures) {
  const bytes = new Uint8Array(readFileSync(join(FIXDIR, f)));
  const s = setup(bytes, f);
  await parseReplay(bytes, f); // warmup + proves the fixture parses
  const samples: Record<Stage, number[]> = { container: [], walk: [], build: [] };
  for (let i = 0; i < RUNS; i++) { const r = runStages(bytes, s); for (const k of Object.keys(samples) as Stage[]) samples[k].push(r[k]); }
  const totals: number[] = [];
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); await parseReplay(bytes, f); totals.push(performance.now() - t0); }
  console.log(`\n${f} (median of ${RUNS} runs)`);
  const meds = {} as Record<Stage, number>;
  for (const k of Object.keys(samples) as Stage[]) {
    meds[k] = median(samples[k]);
    const limit = BUDGETS[k] * 1.3, ok = meds[k] <= limit;
    if (!ok) failed = true;
    console.log(`  ${k.padEnd(10)} ${meds[k].toFixed(1).padStart(7)} ms  budget ${BUDGETS[k]} ms  limit ${limit.toFixed(0)} ms  ${ok ? "ok" : "OVER"}`);
  }
  const sum = meds.container + meds.walk + meds.build, total = median(totals);
  console.log(`  ${"total".padEnd(10)} ${total.toFixed(1).padStart(7)} ms  (stages sum ${sum.toFixed(1)} ms, other ${(total - sum).toFixed(1)} ms)`);
}
if (failed) { console.error("\nbench FAILED: a stage median exceeds its DESIGN budget by > 30%"); process.exit(1); }
console.log("\nbench ok: all stage medians within DESIGN budgets +30%");
