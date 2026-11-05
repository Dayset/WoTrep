import { describe, expect, it } from "vitest";
import { diagnosticsFor, stageLabel, workerErrorInfo, WORKER_LOAD_FAILED_MESSAGE } from "../src/features/upload/progress";
import en from "../src/i18n/en.json";

const META = {
  fileName: "good_0_9t71.mtreplay", fileSize: 1277724,
  workerUrl: "http://127.0.0.1:8471/assets/worker-D8O3k_Jt.js",
};

describe("upload progress + diagnostics", () => {
  it("known worker stage maps to its i18n label, unknown stages fall back to raw", () => {
    expect(stageLabel("parse", "Parsing")).toBe("Parsing");
    expect(stageLabel("decrypt", "Parsing")).toBe("decrypt");
  });
  it("diagnostics carry exactly the worker error fields, never file content", () => {
    expect(diagnosticsFor({ stage: "decrypt", code: "DecryptFailed", message: "bad key" }))
      .toEqual({ stage: "decrypt", code: "DecryptFailed", message: "bad key" });
    expect(diagnosticsFor({ stage: "?", message: "boom" }).code).toBe("Unknown");
  });
  it("diagnostics carry safe main-thread metadata when the error has it", () => {
    expect(diagnosticsFor({
      stage: "worker", code: "WorkerLoadFailed", message: WORKER_LOAD_FAILED_MESSAGE,
      ...META, workerStarted: false, lastProgressStage: "none",
    })).toEqual({
      stage: "worker", code: "WorkerLoadFailed", message: WORKER_LOAD_FAILED_MESSAGE,
      ...META, workerStarted: false, lastProgressStage: "none",
    });
    expect(diagnosticsFor({
      stage: "container", code: "Truncated", message: "need 8 bytes at 0",
      ...META, workerStarted: true, lastProgressStage: "parse",
    })).toEqual({
      stage: "container", code: "Truncated", message: "need 8 bytes at 0",
      ...META, workerStarted: true, lastProgressStage: "parse",
    });
  });
});

describe("worker onerror → error info", () => {
  it("a worker error before any message is a load failure with the reload hint", () => {
    const info = workerErrorInfo({ started: false, lastProgressStage: "none", eventMessage: "", ...META });
    expect(info.stage).toBe("worker");
    expect(info.code).toBe("WorkerLoadFailed");
    expect(info.message).toBe(WORKER_LOAD_FAILED_MESSAGE);
    expect(info.workerStarted).toBe(false);
    expect(info.lastProgressStage).toBe("none");
    expect(info.fileName).toBe(META.fileName);
    expect(info.fileSize).toBe(META.fileSize);
    expect(info.workerUrl).toBe(META.workerUrl);
  });
  it("the diagnostic hint matches the English UI string (they must not drift apart)", () => {
    expect(WORKER_LOAD_FAILED_MESSAGE).toBe((en as Record<string, string>)["upload.workerLoadFailed"]);
  });
  it("a worker error after progress is a crash carrying the event message", () => {
    const info = workerErrorInfo({ started: true, lastProgressStage: "parse", eventMessage: "boom", ...META });
    expect(info.stage).toBe("worker");
    expect(info.code).toBe("WorkerCrashed");
    expect(info.message).toBe("boom");
    expect(info.workerStarted).toBe(true);
    expect(info.lastProgressStage).toBe("parse");
  });
  it("a crash with an empty event message falls back to a non-empty message", () => {
    const info = workerErrorInfo({ started: true, lastProgressStage: "parse", eventMessage: "", ...META });
    expect(info.code).toBe("WorkerCrashed");
    expect(info.message.length).toBeGreaterThan(0);
  });
});
