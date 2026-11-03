# ADR-0002 — Stack

Status: accepted (2026-11-03)

- Monorepo: pnpm workspaces, TypeScript `strict`, ESM only, Node 22 LTS.
- App: React 18 + Vite + Zustand; i18n with plain JSON key files (no runtime translation service).
- 2D rendering: **PixiJS v8** (WebGL, falls back to canvas). 3D: **three.js**.
- Tests: Vitest (unit + fixture snapshots), Playwright (a few end-to-end smoke tests and screenshots).
- Validation: zod schemas in `packages/model`, JSON Schema exported for non-TS consumers.
- Backend: one Cloudflare Worker (`services/api`) + R2 + D1, deployed by GitHub Actions with wrangler.
- Python only in `tools/` (probe, defs extraction). Never a runtime dependency.

Pin exact versions in `package.json`; a dependency upgrade is its own PR.
