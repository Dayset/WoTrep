# CLAUDE.md

Read `AGENTS.md` before doing anything in this repo — it has the claim protocol, file ownership, contracts and the
definition of done. Then read `docs/DESIGN.md` and the contract docs your task touches.

Quick facts
- Monorepo (pnpm). Commands once E0-01 lands: `pnpm i`, `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, `pnpm --filter web dev`.
- Reference decoder: `python3 -I tools/probe/wotrep_probe.py <replay> <out>` (needs `pip install cryptography`).
- First fixture: `fixtures/replays/lesta-1.46-overlord-sbm44.mtreplay`, golden values in `fixtures/expected/`.
- Battle time = clock − battle start clock (arena period 3). Never use raw clock in UI or analysis.
- Never display `realName` or anonymized account ids. Never call anyone a cheater.
