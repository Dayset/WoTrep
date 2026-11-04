import { describe, expect, it } from "vitest";
import { diagnosticsFor, stageLabel } from "../src/features/upload/progress";

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
});
