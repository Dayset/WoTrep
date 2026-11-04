import { createWriteStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { processFile } from "./run";

const USAGE = "usage: pnpm corpus <folder> [--out results.ndjson]\n  Parses every .wotreplay, .mtreplay and .timeline.json under <folder> (recursive),\n  analyses each, and writes one wotrep.corpus/1 JSON object per line.\n  Failures are skipped and logged to stderr with their stage (read | parse | analyse).\n  Exit code is 0 when at least one replay succeeded, 1 otherwise.";
const WANTED = /\.(wotreplay|mtreplay|timeline\.json)$/;

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (WANTED.test(e.name)) out.push(p);
  }
}

async function main(argv: string[]): Promise<number> {
  let folder = "", out = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") { console.log(USAGE); return 0; }
    if (a === "--out") { out = argv[++i] ?? ""; if (!out) { console.error("missing value for --out"); return 2; } }
    else if (a.startsWith("--")) { console.error(`unknown flag ${a}\n${USAGE}`); return 2; }
    else if (!folder) folder = a;
    else { console.error(`unexpected argument ${a}\n${USAGE}`); return 2; }
  }
  if (!folder) { console.error(USAGE); return 2; }
  let files: string[];
  try {
    files = [];
    await walk(folder, files);
  } catch (e) {
    console.error(`cannot read ${folder}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  if (!files.length) { console.error(`no replay files under ${folder}`); return 1; }
  const fileStream = out ? createWriteStream(out) : null;
  const write = (s: string) => { if (fileStream) fileStream.write(s); else process.stdout.write(s); };
  let ok = 0, failed = 0;
  for (const f of files) {
    const r = await processFile((p) => readFile(p), f);
    if ("record" in r) { write(`${JSON.stringify(r.record)}\n`); ok++; }
    else { console.error(`FAIL ${r.failure.file} [${r.failure.stage}] ${r.failure.error}`); failed++; }
  }
  if (fileStream) await new Promise<void>((res, rej) => { fileStream.end((e?: Error) => (e ? rej(e) : res())); });
  console.error(`${ok} ok, ${failed} failed`);
  return ok > 0 ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
