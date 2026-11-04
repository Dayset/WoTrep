import { parseReplay } from "@wotrep/parser";
import { validateTimeline, type BattleTimeline } from "@wotrep/model";
import { analyseTimeline, type CorpusRecord } from "./analyse";

export interface CorpusFailure { file: string; stage: "read" | "parse" | "analyse"; error: string }
export type ProcessResult = { record: CorpusRecord } | { failure: CorpusFailure };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Bytes in, timeline out. `.timeline.json` files are validated, replays go through the TS parser. */
export async function loadTimeline(name: string, bytes: Uint8Array): Promise<BattleTimeline> {
  if (name.endsWith(".timeline.json")) {
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      throw new Error(`invalid JSON: ${msg(e)}`);
    }
    const r = validateTimeline(json);
    if (!r.ok) throw new Error(`invalid timeline: ${r.errors.join("; ")}`);
    return r.value;
  }
  if (name.endsWith(".wotreplay") || name.endsWith(".mtreplay")) return parseReplay(bytes, name);
  throw new Error(`unsupported file type (want .wotreplay, .mtreplay or .timeline.json)`);
}

/** One file through read → parse → analyse. Never throws: failures come back tagged with their stage. */
export async function processFile(read: (path: string) => Promise<Uint8Array>, path: string): Promise<ProcessResult> {
  const file = path.split("/").at(-1)!;
  let bytes: Uint8Array;
  try {
    bytes = await read(path);
  } catch (e) {
    return { failure: { file, stage: "read", error: msg(e) } };
  }
  let tl: BattleTimeline;
  try {
    tl = await loadTimeline(file, bytes);
  } catch (e) {
    return { failure: { file, stage: "parse", error: msg(e) } };
  }
  try {
    return { record: analyseTimeline(tl, file) };
  } catch (e) {
    return { failure: { file, stage: "analyse", error: msg(e) } };
  }
}
