# Findings log and stat backlog

Working notebook. **Append whenever you learn something about the data or think of a stat** (dated, one line, with how you know).
Public numbers are defined in `METRICS.md`; this file is where they come from and where the next ones are.

## 1. Findings (what the data really contains)

| Date | Finding | How we know |
|---|---|---|
| 2026-11-03 | Per-hit events exist for **other players**, not only the recorder: 429 `onHealthChanged` events, 27 attackers, **89%** of all official damage; recorder 100%. Coverage per player varies (e.g. one player 1467 of 3014). | fixture: sum of events per attacker vs results `damageDealt` |
| 2026-11-03 | Shot events exist for **all 30 vehicles** (761 total); a 10-shell autoloader shows as bursts of ~0.3 s gaps, then 8-50 s gaps. Clip size and a reload lower bound can be learned from shots alone. | fixture shot gaps; `estimateReload` |
| 2026-11-03 | Battle results hold a full scoreboard for every player (damage, assists, blocked, shots/hits/pens, life time, killer, mileage, xp, capture points). | `results.players` |
| 2026-11-03 | Enemy positions only while visible (fog); allies always. Ghosts, never interpolation across gaps. | position packets 0x0A |
| 2026-11-03 | The fixture has **no capture events** and no personal events, so cap-pressure and spotting-credit terms cannot be tested yet. | event counts: shot 761, damage 429, kill 24, period 1 |
| 2026-11-03 | Win probability v0 climbs to ~100% by 5:00 on the winning side with steps at kills; no calibration yet (all constants are guesses). | `wpSeries` on fixture |
| 2026-11-03 | Some players have huge shot counts with 0 pens (e.g. 493 shots / 321 hits / 0 pens): the shot model is per projectile, so rapid-fire or special weapons inflate "shots". Accuracy/pen rate must be read per tank. | scoreboard |
| 2026-11-03 | The Lesta public `demo` application id is blocked (407); real vehicle/gun data needs an owner key (#42). | API call |
| 2026-11-03 | Recorder tracers 61 vs results shots 59 (open, #31). | probe |
| 2026-11-03 | Debug view showed reload "lower bounds" of 0.1 s for guns with 11-162 shots and no burst structure (rapid-fire or special weapons). Meaningless, so confidence is now capped at 0.2 for any estimate under 1 s and it no longer excuses a missed opening in Initiative. | `?debug=1` per-player table |
| 2026-11-03 | Coverage is lowest for players who fought mostly out of the recorder's view (0.30-0.52 for 5 of 30); their Impact/threat numbers are shown as partial. Zero-damage players have no per-hit data at all. | `?debug=1` coverage column |
| 2026-11-03 | Initiative styles on the fixture: 9 bold-rewarded, 5 bold-costly, 6 balanced, 3 safe, 7 unrated (< 3 episodes). Few unrated players are the ones with almost no visible time. | boldness test log |
| 2026-11-03 | Searched for a public replay corpus. Found replay-sharing sites (wotreplays.eu, wot-record.com: EU/NA/ASIA, RU only as a player filter; no mention of Lesta/.mtreplay), parsers (wotdecoder, wotreplay-parser) and an arXiv chat-analysis paper, but **no open, licensed replay dataset** and no API, bulk download or reuse terms on the two sites. Scraping them without permission is off the table. | web search + site pages, 2026-11-03 |

## 2. Hidden (debug) values

Like PS2 Elite's debug columns: intermediate numbers that feed the public ones. Open the report with `?debug=1` to see them (per-player coverage, threat weight,
reload estimate, openings/episodes/taken/rewarded/costly, and every config value with its `why`). Rule: if a public number depends on it, it is listed there.

## 3. Candidate stats (not built yet)

Feasibility: **now** = data we decode today; **gamedata** = needs #42; **decode** = needs more packet decoding (#26/#30); **corpus** = needs many replays to be meaningful.

| Stat | Idea | Data | When |
|---|---|---|---|
| Exposure share | share of alive time visible to the enemy; damage per exposed second | `Track.visible` | now |
| Reaction time | seconds from first becoming visible/seeing an enemy to the first shot | visibility + shots | now |
| Gun uptime | share of enemy-in-range time with a loaded gun; pairs with Initiative (was the gun the reason?) | shots + reload estimate | now |
| Isolation | distance to nearest living ally over time; "% of life with no ally within 120 m" | positions | now |
| Front/back position | player's position along the team axis relative to the team centroid | positions | now |
| Idle time | seconds alive with < 5 m movement and no shot | positions + shots | now |
| Clip efficiency | damage per full clip; clips fired at < 50% pens (`low-yield-clip`) | shots + hits | now |
| Alpha usage | damage per shot vs the tank's alpha; wasted shots | hits ÷ shots | gamedata |
| Trade ratio | damage dealt / received per engagement (clustered hits) | hit events | now (recorder-weighted) |
| Last-alive share | seconds as the last survivor, and Impact earned then (clutch #65) | kills + alive state | now |
| Death timing | order of death within the team vs Impact before dying | kills | now |
| First contact | time of first damage dealt/received, early-HP-dump | hit events | now |
| Assist efficiency | assisted damage per second spotted / tracked | results + events | now (results) |
| Luck index | hits taken vs expected from dispersion/pen odds | hit details | decode + gamedata |
| Role-adjusted Initiative | compare Initiative to the same class/tier distribution | many battles + classes | corpus + gamedata |
| Opposition-weighted K/D | PS2 style: result per fight weighted by enemy strength over many battles | many battles | corpus |
| Calibrated win probability | fit WP constants to outcomes | many battles | corpus |
| Cap pressure | capture progress and defence response | capture events | decode |

## 4. Conventions

- A finding that changes a number or an assumption also goes into the doc that owns it (`METRICS.md`, `REPLAY_FORMAT.md`).
- A new public number needs a glossary entry (`METRICS.md` §3.8) and, if it has intermediate values, a line in the debug panel.

## 5. Where training/calibration data can come from (decision needed)

| Source | Consent | Privacy | Effort |
|---|---|---|---|
| **Player's own replays**: bulk drop (multi-file, #117) into a local library (#114, IndexedDB); behaviour of *this* player over time stays on their device | their own | none leaves the device | M |
| **Opt-in anonymous aggregates** (#111/#112): after parsing in the browser, send only per-tank/per-map/per-role numbers (no names, ids, positions) to the Worker | explicit checkbox | aggregates only | M |
| **Replay packs from people we ask** (friends, clan, community, replay-site owners): written permission, stored in `fixtures/` only if the owner agrees | explicit | strip names before commit | S |
| Scraping replay sites | none | n/a | **not doing** |

Rule kept from `REPLAY_FORMAT.md` §8: we do not build cross-battle profiles of *other* players; other players' behaviour is studied only as anonymous aggregates by tank, map and role (PS2 Elite style baselines).
