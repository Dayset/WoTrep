import type { BattleTimeline } from "@wotrep/model";
import { workerErrorInfo, type UploadErrorInfo } from "../features/upload/progress";
// The URL of the emitted worker chunk, for diagnostics (which script failed to load).
// `?worker&url` asks Vite to build the worker and give back its URL; the worker
// itself is still created via `new Worker(new URL(...))` below.
import workerUrl from "../../../../packages/parser/src/worker.ts?worker&url";

export interface ParseHandle { promise: Promise<BattleTimeline>; cancel: () => void }
/** Parse a replay file off the main thread. Buffer is transferred, not copied. */
export function parseFile(file: File, onProgress?: (stage: string, pct: number) => void): ParseHandle {
  // NOTE: the `new URL(...)` must stay inline inside `new Worker(...)` — Vite only
  // recognises that exact pattern as a worker entry and emits a separate chunk.
  // Hoisting the URL into a variable breaks the detection and the worker gets
  // inlined as a base64 data URL (no separate fetch, and the diagnostic would
  // carry a ~130KB data URL instead of the chunk URL).
  const worker = new Worker(new URL("../../../../packages/parser/src/worker.ts", import.meta.url), { type: "module" });
  const meta = { fileName: file.name, fileSize: file.size, workerUrl };
  const promise = new Promise<BattleTimeline>((resolve, reject) => {
    // `started` flips on the first worker message of any kind; `lastStage` tracks the
    // last progress stage. Both are what make a worker failure diagnosable: a load
    // failure (script 404 / stale page) posts nothing at all, so `worker.onerror`
    // fires with an empty message and `started` still false.
    let started = false, lastStage = "none";
    const rejectWith = (info: UploadErrorInfo) => reject(Object.assign(new Error(info.message), info));
    worker.onmessage = (e) => {
      started = true;
      const m = e.data;
      if (m.kind === "progress") { lastStage = m.stage; onProgress?.(m.stage, m.pct); }
      else if (m.kind === "done") { worker.terminate(); resolve(m.timeline as BattleTimeline); }
      else {
        worker.terminate();
        rejectWith({ stage: m.stage, code: m.code, message: m.message, ...meta, workerStarted: started, lastProgressStage: lastStage });
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      rejectWith(workerErrorInfo({
        started, lastProgressStage: lastStage, eventMessage: e.message,
        fileName: file.name, fileSize: file.size, workerUrl,
      }));
    };
    file.arrayBuffer().then((buffer) => worker.postMessage({ buffer, name: file.name }, [buffer]));
  });
  return { promise, cancel: () => worker.terminate() };
}
