# WoTrep

**Web replay analyzer for World of Tanks and Mir Tankov.** Drop a `.wotreplay` or `.mtreplay`, watch the battle
top-down like a StarCraft replay, and let it pause on your mistakes — with the cost of each one in HP, damage and
win chance, the fix, and what an AI Commander would have ordered at that second. Any moment can be opened in 3D.

Status: **design done, build starting** (2026-11-03). Everything is planned as GitHub issues: [14 epics](https://github.com/Dayset/WoTrep/issues?q=is%3Aissue+label%3Aepic) and 111 tasks across milestones M0–M5. Agents: start with [AGENTS.md](AGENTS.md) and the **Start here** list in [docs/ROADMAP.md](docs/ROADMAP.md#start-here-no-blockers).

| | |
|---|---|
| What we build and why | [docs/DESIGN.md](docs/DESIGN.md) |
| Screens and controls | [docs/UX.md](docs/UX.md) |
| Epics mindmap and milestones | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Replay file format (verified) | [docs/REPLAY_FORMAT.md](docs/REPLAY_FORMAT.md) |
| Classic + our metrics | [docs/METRICS.md](docs/METRICS.md) |
| Mistake detectors | [docs/COACHING.md](docs/COACHING.md) |
| AI Commander | [docs/COMMANDER.md](docs/COMMANDER.md) |
| Guides | [docs/GUIDES.md](docs/GUIDES.md) |
| Contracts between packages | [docs/contracts/](docs/contracts/) |
| Decisions | [docs/adr/](docs/adr/) |
| First replay, analysed by hand | [docs/analysis/first-replay.md](docs/analysis/first-replay.md) |
| **Agents: read this first** | [AGENTS.md](AGENTS.md) |

Principles: replays are parsed in your browser (nothing is uploaded unless you share) · exact numbers, no letter
grades · classic tracker stats next to ours so you can compare · luck separated from decisions · the anonymizer is
respected · no one is ever called a cheater.

WoTrep is a fan project, not affiliated with Wargaming or Lesta Games.

## Develop

```bash
pnpm i                 # Node 22, pnpm 9
pnpm -r typecheck
pnpm lint              # also enforces the package dependency direction (docs/DESIGN.md §3)
pnpm -r test
pnpm dev               # apps/web
```
A package may import another only as allowed in `eslint.config.js`; add the workspace dependency
(`"@wotrep/x": "workspace:*"`) in your own package.json when your task needs it.
