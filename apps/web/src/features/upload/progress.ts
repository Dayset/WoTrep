/** Pure helpers for the upload progress + diagnostics UI (kept DOM-free so web tests
 *  can cover them without component infra — the web package has no jsdom/testing-library).
 *  The component wiring (onProgress → state → render, download on click) is thin and
 *  typechecked but not unit-tested, like every other web component. */

/** Label for a worker progress stage. Known stages map to i18n strings (passed in);
 *  unknown future stages fall back to the raw stage name until translated. */
export function stageLabel(stage: string, parseLabel: string): string {
  return stage === "parse" ? parseLabel : stage;
}

/** What the upload component keeps about a failed load. `stage`/`code`/`message` are
 *  the worker's error fields; the rest is safe main-thread metadata (never file
 *  content) so a failure is diagnosable even when the worker never started. */
export interface UploadErrorInfo {
  stage: string; code?: string; message: string;
  fileName?: string; fileSize?: number;
  /** True once the worker posted any message. False alone proves it never started. */
  workerStarted?: boolean;
  /** Last progress stage the worker posted, or "none" if it never posted one. */
  lastProgressStage?: string;
  /** Resolved URL of the worker script that was (or failed to be) loaded. */
  workerUrl?: string;
}

/** Diagnostics object for "send diagnostics" (UX §7): the worker's error fields plus
 *  safe main-thread metadata. Never the file, never its bytes — the caller downloads
 *  this JSON, nothing is posted. */
export function diagnosticsFor(err: UploadErrorInfo): {
  stage: string; code: string; message: string;
  fileName?: string; fileSize?: number; workerStarted?: boolean; lastProgressStage?: string; workerUrl?: string;
} {
  return {
    stage: err.stage, code: err.code ?? "Unknown", message: err.message,
    ...(err.fileName !== undefined ? { fileName: err.fileName } : {}),
    ...(err.fileSize !== undefined ? { fileSize: err.fileSize } : {}),
    ...(err.workerStarted !== undefined ? { workerStarted: err.workerStarted } : {}),
    ...(err.lastProgressStage !== undefined ? { lastProgressStage: err.lastProgressStage } : {}),
    ...(err.workerUrl !== undefined ? { workerUrl: err.workerUrl } : {}),
  };
}

/** The reload hint shown for a worker that never started. Kept as a plain string here
 *  (it is the diagnostic record's message); the UI renders the i18n key
 *  `upload.workerLoadFailed` for the same text in the user's language. */
export const WORKER_LOAD_FAILED_MESSAGE = "The replay reader failed to start — reload the page and try again.";

/** Build the error info for a worker `onerror` event. A module worker whose script
 *  fails to fetch fires `onerror` with an EMPTY message in Chromium, so the bare
 *  event tells nothing — the `started` flag is what distinguishes "never started"
 *  (load failure: reload hint) from "died mid-parse" (crash: the event's message). */
export function workerErrorInfo(opts: {
  started: boolean; lastProgressStage: string; eventMessage: string;
  fileName: string; fileSize: number; workerUrl: string;
}): UploadErrorInfo {
  const meta = {
    fileName: opts.fileName, fileSize: opts.fileSize,
    workerStarted: opts.started, lastProgressStage: opts.lastProgressStage, workerUrl: opts.workerUrl,
  };
  if (!opts.started) {
    return { stage: "worker", code: "WorkerLoadFailed", message: WORKER_LOAD_FAILED_MESSAGE, ...meta };
  }
  return {
    stage: "worker", code: "WorkerCrashed",
    message: opts.eventMessage || "The parser worker stopped unexpectedly.", ...meta,
  };
}
