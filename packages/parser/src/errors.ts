export type ParseStage = "container" | "decrypt" | "inflate" | "packets" | "entities" | "events" | "results";
export class ParseError extends Error {
  constructor(public code: "BadMagic" | "Truncated" | "DecryptFailed" | "InflateFailed" | "BadBlock", public stage: ParseStage, message: string) {
    super(message); this.name = "ParseError";
  }
}
