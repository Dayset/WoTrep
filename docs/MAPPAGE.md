# Map page (heatmaps + map stats)

Status: **PLAN, written before code** (2026-11-03). Update the Progress table as work lands, so another agent can resume after an interruption.
Origin: user asked to repeat the best practices of other replay analyzers' map pages (e.g. map.wotinspector.com/en/pc/70-overlord/) as a separate page.

## What we know about the reference
- wotinspector's map page (fetched text only): headline stats (team win rate 53%/46%, 17,534 battles, average tier 9), a "upload your replay" box processed locally. Heatmap types and filters are NOT visible in the fetched text; ask the owner for a screenshot/list before copying any (do not guess).
- Their numbers come from thousands of replays. We have one fixture. So v1 = per-replay layers on the loaded map; aggregate stats stay empty until opt-in data exists (#111/#112).

## Map image (owner-supplied, never committed)
- Overlord = `101_dday`; minimap 512x512 found in lgfrbcsgo/wot-external-minimap (`minimap-ui/public/minimap/vanilla/spaces/101_dday/mmap.dds.png`). MIT covers that repo's code, not Lesta art. ADR #104: keep local, load through the player's map loader (IndexedDB, `lib/mapStore.ts`).
- Bounds unknown: fixture tracks span x -274..600, z -466..500, so the map is wider than +-500 m. Owner types them or loads the arena XML. Never guess.

## Layers (v1, one or more local replays)
| id | Layer | How computed | Meaning for the player |
|----|-------|--------------|------------------------|
| presence | Where tanks spent time | per-second positions of alive, known units binned into a grid | where fights and lanes really are |
| dmgdealt | Damage dealt | damage events placed at the target's position (weight = amount) | where damage is won |
| dmgrecv | Damage received | same, at the victim, for the chosen player | where you get hurt |
| deaths | Deaths | position at death, with time | where tanks die and when |
| routes | Opening routes | tracks 0..60 s battle time per spawn | which lanes each spawn takes |
| spots | First sighting | where a unit was first seen by the enemy | where you get found |

Filters: team (own/enemy/both), vehicle class, time window (opening 0-60 s / mid / end), player (all or selected). Every layer has a `how/mean` glossary entry (en + ru) per AGENTS.md DoD.
Rules: battle time only (clock minus battle start); never show `realName` or anonymized ids; no cheating claims.

## Architecture
- `packages/analysis/src/heatmap.ts`: pure `heatGrid(tl, layer, opts) -> {cols, rows, cell, bounds, values, total}`; bounds come from the loaded map or track extents. Unit tests on the fixture (totals equal inputs; damage layer sums to observed damage).
- `apps/web/src/features/map/MapPage.tsx`: canvas, shared camera code from the player where practical (do not edit Player.tsx beyond extracting helpers), layer + filter chips, legend with scale, how/mean text.
- Entry: "Map" tab in the report next to Watch (2D); reuse `loadMap`.
- Colour: single-hue sequential ramp per dataviz skill, validated light and dark; heat drawn over the minimap at 0.6 alpha.
- Aggregates section (win rate by spawn, tier mix): placeholder card stating "needs many battles", wired later to #111/#112.

## Progress
| step | state |
|------|-------|
| 1 plan doc + issue #126 | done |
| 2 `heatGrid` + tests (packages/analysis/src/heatmap.ts) | done |
| 3 MapPage with layers/filters (apps/web/src/features/map/MapPage.tsx, "Map heatmaps" button in the report) | done (v1) |
| 4 glossary: how/mean text lives in `mp.l.<layer>.how/.mean` (en+ru); FINDINGS notes | done |
| 5 screenshot check | phone done (with placeholder +-600 m bounds, visual only); desktop todo |
| 6 owner: wotinspector heatmap list, true map bounds | waiting on owner |

## Not done / next
- Class filter: needs vehicle class from game data (#42); not in the replay.
- Pinch zoom/pan on the map page (reuse the player's pointer code), per-player picker beyond "only me".
- Spawn side and win-rate cards: need aggregates (#111/#112).
- Real bounds for 101_dday: unverified; the +-600 m screenshot is only a plausibility check (heat follows the roads).

## Competitor notes: map.wotinspector.com Overlord page (observed 2026-11-03 by browsing as a user; nothing scraped or stored)
Page structure: tabs **stats / heatmaps / top games / specs**, plus an upload box ("processed locally, not uploaded") that plays the user's replay on the map.
- **specs**: tech name `101_dday`, **size 1000 x 1000 m**, accessible area 0.917 km2, camouflage summer. So the bounds are a 1000 m square; our fixture tracks span x -274..600, so the world origin is not the map centre (probably an offset such as x -400..600). Unverified until we have the arena XML: do not hard-code.
- **stats** (all-player aggregates, filters region/period/game mode/player name): battles, average duration, average tier, draws, team 1 vs team 2 win rate, class mix, win rate by team, finish reason (extermination/base/timeout), tier distribution, duration distribution, win-score distribution, and a sortable "performance by tank" table (battles, win rate, damage per game, profit). Many controls are locked behind their mod/subscription.
- **heatmaps**: presets team movements, class movements, experience (locked), assisted damage (A) and (B), tracers, damages, custom. Filters: period, heatmap type, segmentation (by team), tank, game mode, player name ("me"), time range, exp range, player WTR. Spawn markers A (south) and B (north) drawn on the map.
- Ideas we lack: win rate by spawn (needs aggregates), finish-reason mix, duration/score distributions, tracers (shot lines), assisted-damage layers, per-class movement (needs class data #42), "me" personal heatmaps over many battles (needs the local library #114/#117).
- Our edge to keep: per-battle coaching linked to the replay, relative metrics, explanations.
