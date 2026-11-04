/** Pure helpers for the upload progress + diagnostics UI (kept DOM-free so web tests
 *  can cover them without component infra — the web package has no jsdom/testing-library).
 *  The component wiring (onProgress → state → render, download on click) is thin and
 *  typechecked but not unit-tested, like every other web component. */

/** Label for a worker progress stage. Known stages map to i18n strings (passed in);
 *  unknown future stages fall back to the raw stage name until translated. */
export function stageLabel(stage: string, parseLabel: string): string {
  return stage === "parse" ? parseLabel : stage;
}

export interface UploadErrorInfo { stage: string; code?: string; message: string }

/** Diagnostics object for "send diagnostics" (UX §7): exactly the worker's error fields.
 *  Never the file, never its bytes — the caller downloads this JSON, nothing is posted. */
export function diagnosticsFor(err: UploadErrorInfo): { stage: string; code: string; message: string } {
  return { stage: err.stage, code: err.code ?? "Unknown", message: err.message };
}
