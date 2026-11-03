import type { BattleTimeline } from "@wotrep/model";

export interface ParseHandle { promise: Promise<BattleTimeline>; cancel: () => void }
/** Parse a replay file off the main thread. Buffer is transferred, not copied. */
export function parseFile(file: File, onProgress?: (stage: string, pct: number) => void): ParseHandle {
  const worker = new Worker(new URL("../../../../packages/parser/src/worker.ts", import.meta.url), { type: "module" });
  const promise = new Promise<BattleTimeline>((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.kind === "progress") onProgress?.(m.stage, m.pct);
      else if (m.kind === "done") { worker.terminate(); resolve(m.timeline as BattleTimeline); }
      else { worker.terminate(); reject(Object.assign(new Error(m.message), { stage: m.stage, code: m.code })); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message)); };
    file.arrayBuffer().then((buffer) => worker.postMessage({ buffer, name: file.name }, [buffer]));
  });
  return { promise, cancel: () => worker.terminate() };
}
