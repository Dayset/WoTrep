# Roadmap — epics mindmap and milestones

Issue numbers for every epic and task: see the **Epics** table at the bottom (filled after the issues were created).

```mermaid
mindmap
  root((WoTrep))
    E0 Foundations
      Monorepo + CI
      Pages deploy
      Mock timelines from probe
      Fixture corpus
    E1 Parser
      Container · Blowfish · zlib
      Packet walker
      Safe pickle
      Manifests per realm+version
      Entity dispatch
      Positions · events · results
      Anonymizer filter
      Worker
      WG + Lesta
      Fingerprint fallback
    E2 Battle model
      BattleTimeline v1
      stateAt snapshot · ghosts
      Reload estimator
      Engagements
      Compact format
      Multi-POV merge
    E3 Game data
      Vehicles WG + Lesta
      WN8 expected values
      Maps · bounds · bases
      Minimaps
      Class icons
    E4 2D tactical player
      Clock · speeds · seek
      Map layer · grid
      Units · fog ghosts
      Tracers · damage · kills
      Timeline + WP curve
      Army bars · rosters
      Coach mode autopause
    E5 Classic stats
      Scoreboard
      WN8 · EFF · MoE
      Account stats via API
      Classic vs WoTrep
      Lesta expected values
    E6 Analysis
      Win probability v0 → v1
      Impact WPA
      Cleanup · threat · clutch
      Trades · luck · clips
      Theory vs practice
    E7 Coaching
      Detector framework
      Wave 1 detectors
      Wave 2 detectors
      Findings UI + 👍/👎
    E8 AI Commander
      Map zones
      Flank state
      Orders + look-ahead
      Panel · debrief · team view
      Voice · LLM wording
    E9 Guides & drills
      Guide format
      First guides
      2D clips
      Drills from your replay
      Map playbooks
    E10 POV moment
      Asset ADR
      three.js scene
      Local game-files loader
      Shots · aim · ghosts
    E11 Platform
      Worker · R2 · D1
      API proxy
      Share links
      Aggregates
      Local library
    E12 App shell & UX
      Shell · i18n en/ru
      UI kit flat
      Upload
      Report page
      Session view
    E13 QA & calibration
      Corpus CLI
      Golden diff CI
      Precision review
      Threshold recalibration
```

## Milestones

| | Milestone | Done when | Main epics |
|---|---|---|---|
| M0 | Foundation | monorepo builds in CI, contract types exist, mock timelines in `fixtures/timelines/` | E0, E2-01, E12-01/02 |
| M1 | Parse & Play | drop the fixture → report skeleton + 2D playback with fog ghosts, tracers, kills | E1, E2, E4, E12 |
| M2 | Classic parity | scoreboard + WN8/EFF/MoE match trackers; WG replay supported | E3, E5 |
| M3 | Coach v1 | WP v0, Impact, wave-1 detectors, coach mode, findings with 👍/👎 | E6, E7 |
| M4 | Commander & Guides | zones, commander call/debrief, guides, drills, wave-2 detectors | E8, E9 |
| M5 | POV & Platform | 3D moment, share links, aggregates, WP v1, Lesta expected values | E10, E11, E13 |

Parallel lanes from day one (no waiting on each other once E0-01 and E2-01 land):
**parser lane** (E1) · **player lane** (E4 on mock timelines) · **shell/UI lane** (E12, E5-01) ·
**analysis lane** (E6/E7 on mock timelines) · **data lane** (E3, needs owner for API ids) · **platform lane** (E11).
