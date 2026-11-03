# ADR-0001 — Parse replays in the browser

Status: accepted (2026-11-03)

**Context.** Replays are 1–5 MB, contain other players' data, and most users want one quick look. A server
parser costs money per replay and makes privacy promises harder.

**Decision.** `packages/parser` is pure TypeScript with no Node-only APIs and runs in a Web Worker. The same code
runs in Node for tests and for the corpus CLI. The server never receives replay files; it may receive the derived
`BattleTimeline` when the user shares (opt-in).

**Consequences.** Works offline and on the free tier forever. Blowfish and the pickle decoder are implemented in TS.
Heavy corpus jobs run in Node/GitHub Actions, not in the Worker.
