/// <reference lib="webworker" />
// Parser Web Worker: main thread posts {file: ArrayBuffer, name}; worker posts progress/done/error. Cancel = terminate().
import { parseReplay } from "./build";
import { ParseError } from "./errors";

export type WorkerIn = { buffer: ArrayBuffer; name: string };
export type WorkerOut =
  | { kind: "progress"; stage: string; pct: number }
  | { kind: "done"; timeline: unknown }
  | { kind: "error"; stage: string; code: string; message: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);
self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  try {
    post({ kind: "progress", stage: "parse", pct: 10 });
    const timeline = await parseReplay(new Uint8Array(e.data.buffer), e.data.name);
    post({ kind: "progress", stage: "done", pct: 100 });
    post({ kind: "done", timeline });
  } catch (err) {
    const pe = err instanceof ParseError ? err : null;
    post({ kind: "error", stage: pe?.stage ?? "unknown", code: pe?.code ?? "Unknown", message: String(err instanceof Error ? err.message : err) });
  }
};
