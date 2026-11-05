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
| 2026-11-03 | Hull heading in track data is (sin yaw, cos yaw) in (x, z); 141 of 163 checked moves agree, the rest are reversing. Track times start at about -33 s (before battle start); the player clamps to battle time 0..duration. | yaw vs movement on the recorder's track |
| 2026-11-03 | Map extent on Overlord from positions alone: x -274..600, z -466..500 (so not a symmetric 1000 m square); the player fits bounds from data until map data (#43) gives the real ones. | track min/max |
| 2026-11-03 | **Correction:** the reload estimate (shortest gap between bursts) is an *upper* bound on the true reload, not a lower bound as first written (a player cannot fire before the gun is ready; waiting only makes gaps longer). So "reloading" means "within this player's fastest cycle", not proven. Initiative uses it only to excuse missed openings and says "probably ready"; detectors that blame/praise reload timing (`peek-into-loaded-autoloader`, `punished-reload`, `exposed-while-reloading`) stay blocked until real gun data (#42). | reasoning + debug table |
| 2026-11-03 | On the fixture only `won-trade` fires (2 good plays at 2:03 and 2:55, +2.6 and +1.8 pts win chance); no mistake detector fires for the recorder, who took 7 hits in total and survived. Positive cases are covered by synthetic timelines. Needs more replays to see the detectors' real rates. | coach snapshot |
| 2026-11-03 | Buttons placed inside the map container never got `click` because the container captured the pointer on pointerdown; overlay controls must stop pointerdown propagation. | zoom buttons did nothing in the browser test |

| 2026-11-04 | Damage events timestamp up to ~0.3 s after their shot (flight + packet skew; e.g. the 125.30 pen from a 125.2 shot). Clip damage attribution therefore uses a 1 s window past the clip's last shot; windows still never overlap because clips are separated by reload gaps. | fixture pens vs shots |
| 2026-11-04 | **Correction to the 11-03 correction:** the shortest-gap reload estimate is NOT always an upper bound — a mid-clip pause longer than intraMax splits one clip into two bursts, and the gap between them reads as a reload far shorter than the true one (fixture TDM-54: 5.3 s estimated vs ~14 s true). So a reload-timing detector must require the previous burst to be a FULL clip before it claims a reload happened; `peek-into-loaded-autoloader` does exactly that, plus a confidence gate. | fixture TDM-54 shots: 6-shot burst, 5.3 s pause, 2 more shots, all inside one 10-shell clip |
| 2026-11-04 | `peek-into-loaded-autoloader` fires on the fixture: 1 mistake at 4:13 vs the TDM-54, −421 HP (5 hits). The won-trade duel at 2:03 stays clean — no peek finding there, so the two detectors do not contradict on the same moment. | coach snapshot |

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
| Scraping replay sites (even gently, aggregates only) | none from the sites; terms unknown | third-party data | **not doing without the site owners' written OK**; ask them first |

Rule kept from `REPLAY_FORMAT.md` §8: we do not build cross-battle profiles of *other* players; other players' behaviour is studied only as anonymous aggregates by tank, map and role (PS2 Elite style baselines).

## Running curves (player strip)
- Fixture: recorder's shot events = 61, official shots = 59. Cause unknown (maybe shots not counted by the game, e.g. before the first second). The hit-rate curve uses event shots, so it reads slightly low; never show it as the official accuracy.
- Running curves (cumulative damage, damage/min, damaging-hit rate) come only from observed events; the player strip notes when a player's hit coverage is under 98%. Survival probability v0 is not built: it needs calibration data (#111/#112, E13).

## Tracers (map page)
- 2026-11-03: **stopTracer (method 30) decoded**: `u32 shotId, f32 x, y, z`. Fixture: 584 end points for 761 shots (77%), all matching a shot id; shot-to-end distance median ~100 m, p90 ~224 m, max ~470 m. The remaining ~23% of shots have no stopTracer in the stream (not an error we can fix). Shot lines now drawn on the map page (`tracerLines`). The fixture timeline JSON was patched with these events (built by the Python probe before); the TS parser produces the same.
- Still undecoded: assist and personal events (method 60 onBattleEvents), so assisted-damage layers remain blocked (#26/#30).

## Wargaming replays
- 2026-11-03: user supplied two Wargaming `.wotreplay` files on 101_dday: client **2.3.1.0** (NA, 446 s; no manifest yet, kept for later per the user) and client **2.4.1.0** (EU, 782 s). Both open in the container reader (vehicles, chat, results, positions). Headers name the recording player: never display that name beyond the normal player list, and never commit these files (they live in the git-ignored `fixtures/local/`).
- **WG 2.4.1.0 draft manifest** (`packages/defs/manifests/wg-2.4.1.0.json`, confidence `fingerprint`), found by payload shape and checked against results: vehicle method 4 `onHealthChanged` (10 B, same field order as Lesta; recorder damage 6753 = official 6753, all 108 attackers valid), avatar method 37 `showTracer` (50 B; recorder 25 shots = official 25), avatar method 28 `stopTracer` (16 B; 121/121 ends match a shot), avatar method 58 `updateArena` (type 3 period 3 = battle start at clock 31.41).
- **Kill message not decoded.** It is not in avatar updateArena (types seen: 30, 3, 24, 26, 8) and no avatar/vehicle method carries victim ids. The (victim, killer) pair does appear inside packet type **0x37** (728 packets, variable length, pickled property updates with a `deathOrder` key) at about the victim's death time, but its layout is not understood. **Workaround shipped:** `killsFromResults` rebuilds kills from the results block (victim, killer and reason exact; time = lifeTime + 0.5 s). On the Lesta fixture the real kill is 0..1 s after lifeTime and all 24 killers and reasons match. Applied only when the battle start is known and no kill message was decoded; a parse warning says so.
- **Survey of 9 more replays (2026-11-03)**, draft manifest vs official recorder numbers: 2.4.1.0 on dday/asia_great_wall/alaska/prohorovka x2/tundra/monastery/epic desert and 2.4.0.0 lakeville (via the same-minor fallback) all give battle start and shell ends. Recorder shots equal official on 8 of 9 (epic battle differs: 57 vs 14, mode with respawns/other vehicles). Recorder damage equals official on 5 of 9 (lakeville, dday, great wall, alaska, prohorovka 2); lower elsewhere (tundra 532/725, prohorovka 1 1946/2011, monastery 690/1363, epic 5252/2995 over): WG only sends health events for tanks the recorder could see, so **WG coverage must be reported per replay** (`coverage` already does). Some stopTracer end points have no showTracer in the stream (other players' shots): tracers skip them.
- Modes seen: random battle (battleType 1, ctf 30 players), tundra battleType 46 (14 players), epic battle 27 (60 players). Only random battle is supported by the coach so far.
- The NA 2.3.1.0 replay has no manifest (parked by the owner).
- WG replays seem to carry fewer events for other players (187 shots in 782 s vs 761 in 328 s on the Lesta fixture): treat coverage per replay, never assume Lesta levels.

## Comparison with wotinspector's replay viewer (same battle, observed 2026-11-03)
- Same final result as ours: 15 enemy kills vs 9 losses (24 kills; our parser: 24).
- Their viewer: small 2D player, side menu (world, teams, log, clear, display), team HP bars with kill counts, speed/pause, a kill/damage **log** with times, names and per-hit numbers, rosters where several players show "(no data)".
- We are ahead on: all 30 vehicles named, full positions, per-hit damage for everyone (89% coverage), findings and coaching linked to the map, linked curves, explained metrics.
- We lag on: a visible damage/kill **log** panel (#54), team HP bars with kill counts at the bar (we show alive count and HP), many-battle aggregate stats and heatmaps (need data), class data (#42).

## Damage log (#54)
- 2026-11-03: Player has a "Damage log" toggle (apps/web/src/features/player/DamageLog.tsx): every damaging hit with time, attacker → target (team-coloured), damage, HP left, ☠ on the killing hit; kills without a matching hit (results-derived kills on Wargaming) get their own row. Filter Everyone / Me; click a row to jump 3 s before; the row at the playhead is highlighted and followed.
- It states its own coverage from the data: log damage ÷ sum of official damageDealt: **89%** on the Lesta fixture, **67%** on the WG 2.4.1.0 dday replay (hits on tanks the recorder could not see are not reported).
- Compared with wotinspector's log: same idea; ours adds team colours, HP left, coverage, jump-to-moment and the filter. Still missing: per-player filter beyond "me", ammo/penetration result per hit (needs undecoded events).

## Teamplay and force distribution: ideas beyond v0 (2026-11-03)
- **Local force ratio** at each engagement: living HP of allies vs enemies within ~200 m of the target when the fight began (Lanchester-style). Tells if a fight was started with local superiority; needs visible enemies' positions.
- **Support timing**: when an ally is hit, how fast did you start shooting at the same enemy? (response latency, 0 if you never joined.)
- **Pushing from behind / baiting**: you advanced while allies behind you were quiet vs allies leading while you stayed back; use progress rank *change* over time.
- **Weighted decisions**: when the team's win chance was falling, did the player shift toward the weaker flank (reinforce), or stay? Needs a flank model: split the map along the team's main axis into left/centre/right and compare HP share per flank against enemy HP share per flank (force distribution); a "reinforce score" = move toward the flank with the worst ratio.
- **Lane balance**: HP share by flank over time vs the enemy's; shown as three strips under the player.
- **Trade quality in pairs**: after an ally dies, did the nearest ally avenge within 10 s (kill or damage to the killer)?
- All of the above need calibration data (E13) and, for the enemy side, enough replays; none is implemented.

## Good plays for all and enabled-by credit (2026-11-03)
- Fixture (Lesta): 24 good plays across both teams (recorder 2): 14 carried, 0 shared, 10 solo; alignment own team 55% (6/11), enemy 69% (9/13); lowest coverage 59%.
- WG 2.4.1.0 Overlord: 19 plays (6 carried, 13 solo); own team alignment 0% (0/9), enemy 60%; lowest coverage 44%. WG 2.4.0.0 Lakeville: 30 plays (6 carried, 24 solo); lowest coverage 22%, so many of those plays are uncertain.
- "shared" never occurs yet: when teammates absorb anything, the share is already above 50% because won trades have low damage taken. Candidate refinement: compare absorbed damage with the player's *team-relative* share, or use the focus window (who the enemies were shooting at when the player started).
- Candidate stat: **sacrifice ledger** per player: how many teammates' deaths/damage preceded each good play by that player, and how often a player's own HP loss enabled a teammate's play (gives the "who creates space" and "who cashes in" view).

## Sacrifice ledger and flank model (2026-11-03)
- Fixture ledger (own team): top helpers absorbed 748 HP (2 plays), 452 HP (1 died for it), 343 HP; the recorder helped nobody. Own plays enabled: 3/3 for the top helper (a helper who also cashes in).
- Flank model, own HP share left/centre/right: fixture 34/31/35 (enemy seen 22/29/49), WG Overlord 62/21/17 (enemy seen 49/29/22), Prohorovka 40/21/39 (enemy seen 0/18/82: mostly unseen), Lakeville 70/17/13. The enemy side is a lower bound everywhere.
- Candidate next: **reinforce score** = after a flank's ratio falls below 40% for 15 s, did any teammate move toward it within 30 s? Per-player credit for the mover, and a team-level "reaction time". Needs lane geometry to be fair on maps with one-sided lanes.

## Reinforce and coverage on real replays (2026-11-03)
- Reinforce (episodes answered/total): Lesta fixture 4/4 (reaction 15-30 s), WG Overlord 2/2, Prohorovka 1/4, Lakeville 2/3. Epic battle (60 players): 2/3 but not meaningful, the flank model assumes 15v15.
- Coverage: Lesta fixture damage 89%, own positions 90%, enemy 39% -> "partial"; WG Overlord 67% / 65% / 19%; Lakeville 70% / 77% / 19%; Epic Battle 84% / 31% / 4%. Nothing reached "good" yet because the enemy is rarely visible for 40% of its time; the 40% threshold is a guess, recalibrate when more replays exist (E13).
- Epic Battle (60 players, battleType 27) and Tundra (14) are not supported by the coach or flank model: the badge is the only honest signal for now. Candidate: a "mode not supported" banner from `battleType`.

## Danger spots (2026-11-03)
- Lesta fixture: 32 danger spots over all players (alone 12, crossfire 10, outtraded 9, early 1). Recorder: one, at 4:13, 421 lost / 51 dealt, nearest ally 49 m, so "outtraded".
- Ideas not done: danger heat layer on the map page (deaths + danger spots by cell), line-of-sight/cover reasoning (needs map geometry), "should have retreated" check using the retreat path, danger markers on the player timeline, per-class thresholds.

## Unsupported-mode banner (2026-11-03)
Report shows a banner when battleType != 1 or vehicle count != 30 (tundra 14 players, epic 60 seen in local WG replays). Numbers are not rescaled; only flagged.

## First calibration pass (2026-11-03, 8 random 15v15 replays: 7 WG + Lesta fixture; 695 engagements, players with >=80% damage coverage)
- Loss share per engagement: p50 0.05, p75 0.26, p90 0.49, p95 0.68. Most heavy losses have dealt/received = 0 (the player was hit and never hit back), so the ratio cut matters little between 0.3 and 0.8.
- Danger rule at minLoss 0.25 / maxRatio 0.5: 0.56 spots per player; won-trade rule at the current thresholds: 0.61 good plays per player. Both feel balanced, so thresholds are kept; `danger.json` records n.
- Not calibrated: causes (alone/crossfire/early distances), flank and teamplay thresholds, anything needing class or gun data. Corpus is 8 replays on 3 maps; E13 proper needs the uploaded corpus (#111/#112).
- Gun data (#42) is blocked on an owner-provided Lesta application id (the public demo id is rejected). Nothing to build until then.

## Game fundamentals to reverse engineer into heuristics (2026-11-03, owner request: "whatever is important in the game")
Done: assist per minute + share (card "support"); damage trades; positioning vs allies; crossfire; opening.
Next, by value: (1) spot quality and spot-to-damage link (needs 0x37 / #26); (2) vanish-event layer and aggregated cover map; (3) peek-and-retreat / exposure time; (4) class roles (heavy holds, medium flanks, scout spots, TD ambush) needs class data (#42); (5) reload and gun uptime (#42); (6) base capture / reset timing; (7) HP-pool trading (who has more HP left) at key moments; (8) tier and matchmaking context.

## Movement and exposure (2026-11-03)
- Fixture medians (recorder team / enemy): m/min 333 / 194, standing still 20% / 27%, under 2+ enemies at 150 m 16% / 73%. The enemy figure is inflated by the spotting bias, so compare within a team.
- Packets: 0x37 (kill message on WG) still not decoded; needs a packet-layout pass. Spot-to-damage link and exact assists remain blocked on #26/#30.
- Next: line-of-sight from aggregated vanish events; pair "under 2+ enemies" with the danger spots to separate daredevils who got away from those who paid.

## WG kill message found (2026-11-03)
Kill records in 0x37 packets (`78 01 victim killer reason`) give exact killer, reason and packet time for Wargaming replays; see REPLAY_FORMAT.md. 203/203 match results. Gaps: 23 of 27 deaths in one dday replay (rest from results), Tundra/Epic layout unknown. Also seen in the same stream: `deathOrder` pickles, and per-slot records `0c b7 02 06 <slot> 98 <n>` that look like per-vehicle counters (undecoded). Candidate source for assists and spots: look at records around damage events (next).

## Assist and spot events research (2026-11-03)
- **Estimator tried and rejected:** credit teammate damage on a visible enemy to the nearest living ally within 300/445 m. Compared to the results' assistRadio per player on 8 random replays + Lesta fixture: Spearman rho 0.0-0.55 (best Lakeville/Prohorovka), predicted totals 1-4x too big. Own damage alone is no better (rho 0.0-0.33). Not shipped; the real spotter cannot be inferred from positions.
- **Lesta avatar method 60 (`onBattleEvents`)**: `u8 count` then 8-byte entries `u32 enemy vid, u16 a, u16 b` (b was 0x10 in all 50 entries). Entries come 0.5-1 s after the recorder's own hits on that enemy (39.2 s vs hit at 38.5 s, 124.4/125.0/... vs hits 123.2-125.3), so this is a per-hit event about the recorder's attack, not a team assist feed. Low byte of `a` takes 0x10,0x11,0x12,0x20,0x28,0x30,0x60 (looks like flags), high byte 0/1/0x0d. Meaning of the flags not decoded; assist totals in the results (radio 56, track 243 for this recorder) could not be matched to any entry sum.
- **WG 2.4.1 unnamed calls**: avatar#54 (len 10: `01 <enemy vid> <2 bytes> 10 00 00`) matches the recorder's own hits 1:1 (20 calls, same times and 20 hit events); vehicle#10 (127 calls) contains u16 values equal to teammate damage amounts in 23 of 127 calls (offsets 19/23); vehicle#7 (4 calls) similar. Not decoded.
- **What would settle it:** the Lesta/WG `BATTLE_EVENT_TYPES` table and the `onBattleEvents` flag layout from game scripts (owner-provided or from the Lesta API docs), or a replay where the recorder has many radio assists and known spotted enemies so entries can be matched one by one. Until then assist stays results-total only (card "support").
- **Lead for event types (2026-11-03):** a public WoT mod (Arkhorse/WOT-Spot-Counter) reads these through `BattleFeedbackCommon.BATTLE_EVENT_TYPE` (has `SPOTTED`; the code also treats other types as assists) and `feedback_events.PlayerFeedbackEvent.fromDict`. The numeric values and the packed layout live in the game's own client scripts, which are not public in anything reachable here. The mod does not list them.

## Battle economy fields in block 1 `personal` (2026-11-04)
- End-screen numbers map exactly: `originalXP` = base XP, `xp`/`factualXP` = total XP, `originalCredits` = base credits, `credits` = total credits, `repair` (= `autoRepairCost` here) = repair cost, `autoLoadCost[0]` = ammo cost in credits (`[credits, gold]`). Verified on the fixture battle: 862 → 3,879 XP; 18,542 → 28,184 credits; −5,545 repair; −5,015 ammo; profit 28,184 − 5,545 − 5,015 = 17,624. Note the trap: per-vehicle `xp` in `vehicles` is the BASE (862), not the total — the scoreboard XP column shows base XP. Economy exists only for the recorder (`personal`); other players have no economy fields.

## Is the camera really looking down? (2026-11-03)
First-person screenshots looked "down" only because the camera was level over flat ground while the target stood lower in the picture. Real data: shooter and shell end heights on the recorder's first shots differ by 1.3 m over 130-160 m (elevation -0.5 to -1.2 degrees), so there was no hill there. The replay does carry heights (tracks y 24-94 m, shell end y with 0 = missing), so the 3D view now builds terrain from where tanks drove and pitches the camera with the gun elevation. Limits: terrain is only known along tank routes; shell drop is ignored; end y = 0 happens on some shots (first two of the fixture).

## Real Overlord heights, verified and wired into the player (2026-11-05)
- Heights come from the player's own game files, never hosted (ADR-0003): the owner runs `extract_dday_local.py` (Python 3 only, `~/workspace/your_files/`) on their `101_dday.pkg` and loads the resulting `dday_heights.zip` in the map panel. The ZIP holds `manifest.json` + one float32-LE-metres grid per chunk (196 chunks, 133×133, chunk 100 m). It is stored in IndexedDB (`wotrep`, store `heights`, like map images) and parsed on load (`parseHeightsZip`, fflate).
- Format facts: current client ships 8-bit RGBA heights, 4 bytes/px as one little-endian Int32 × 0.001 = metres (nuTerra `get_heights`); if alpha is 255 the low 24 bits (RGB) are used instead — the extractor picks by which range fits the header h_min/h_max. Old maps shipped 16-bit grayscale × 0.001 (caps at 65.5 m). Chunk file is the BWT2 resource string minus its last `/terrain2` segment.
- Mapping (found by translation search, not from the docs): sample heights at world (x − 300, z), no swap, no mirrors. The −300 x-offset is the arena's placement inside the 1400 m space; per-map rule still open. Open question: the offset may be the negative of the arena `boundingBox` centre — check against an arena XML when one is on hand. Measured placements live in `packages/gamedata/src/terrain.ts` with provenance.
- Verified against all 51,469 fixture track points (Lesta 1.46 replay vs heights from the EU 2.4 client): direct sampler median err +0.03 m, median |err| 0.23 m, 64% ≤ 0.5 m, 74% ≤ 1 m, 87% ≤ 2 m; best chunks exact to 0.02 m. Global range 16.06–95.38 m (the guessed field was capped 24.3–90.9). Residuals: p90 2.8 m, max 14.2 m; 20/73 visited chunks median |err| > 2 m, worst (−3,5) +7.5 m, (−4,−4) +7.4 m — likely EU 2.4 vs Lesta 1.46 rework zones, cliff-face interpolation, or bridges/structures. Heights must match the replay's client version for a clean fit.
- Wiring: `heightField(tl, bounds, cell, real?)` overwrites the cells the real data covers with measured values and marks them seen; the rest stays estimated. The 2D heights overlay and the 3D view (ground mesh, tank/tree placement, sight fans, ghost spheres) all read the same field, so they all improve at once. At 25 m cells the resampled field is barely better than the guess ON TRACK POINTS (median |err| 0.77 vs 0.78 m) — the guess was fitted to those points — but on the 30% of cells no tank visited, the measured value differs from the guess by >2 m on 60% of them and >5 m on 29%: that is where the player gets better. The fine sampler (`realHeightAt`, 0.76 m) stays available for line-of-sight work, which is still not computed.

## Real heights feel off: the 25 m resampling smooths the cliffs (2026-11-05)
- Dayset loaded the heights ZIP and still felt the heights were not exactly the same as the game / other replay sites. Measured cause: the player resampled the 0.76 m real grid into 25 m HeightField cells. On a dense grid the 25 m field is a median 0.23 m off the measured ground, but the error is slope-driven — flat ground (58% of the map) 0.15 m, slopes 0.3–0.6 already 1.2 m, steep ground (slope > 1, 2% of the map) 4.1 m median, p90 10.4 m; worst spots are the western cliffs (x ≈ −200, z ≈ −60..480) at 12–14 m. 5% of the map sits >2 m off, 1.4% >5 m. Tanks on slopes sit a median 0.77 m off their true track height (p90 3.2 m).
- Fix: when real heights are loaded the field is built at 5 m cells (`REAL_HEIGHT_CELL_M`, `packages/analysis/src/realHeights.ts`); the guessed field stays at 25 m. At 5 m the field is the direct sampler to 0.02 m median on a dense grid (p90 0.16 m) and 0.26 m median on track points — the remaining tail (p90 2.8 m, max ~13 m) is the EU 2.4 vs Lesta 1.46 version gap, not resampling, and no cell size fixes it. The 5 m field is 192×211 cells on the fixture bounds; the 3D mesh and the heights overlay both use it.
- Still open: if the difference Dayset feels is in the 2D overlay's colours (our ramp vs other sites'), that is a rendering choice, not a heights error — ask which view looks off before touching the ramp.

## Overlord obstacles, verified and wired into the player (2026-11-05)
- Obstacles come from the player's own game files, never hosted (ADR-0003): the owner runs `extract_obstacles_local.py` (Python 3 only, `~/workspace/your_files/`) on their `101_dday.pkg` and loads the resulting `dday_obstacles.json` in the map panel. The JSON holds models (417), placements (10,908), trees (5,014), water (1). Stored in IndexedDB (`wotrep`, store `obstacles`, db version 3) and parsed on load (`parseObstacles`, strict — a model with no `destructible` flag, a `destroyed_model_index` of null, and a placement matrix with a 14× scale all broke the first parser draft and were fixed against the real file).
- Format facts: BSMO per model type (collision AABB, static/falling/fragile, destroyed-state model), BSMI per placement (4×4 transform, footprint = 4 lower AABB corners as an oriented quad, `height_m` = highest transformed AABB corner, absolute world y — NOT a height), SpTr trees (position + scale, bushes are the srt names with bush/shrub), BWWa water (rectangle + surface y). World x = space x + 300 (same offset as heights; the first extractor version had the sign backwards and was caught by the Y check).
- Verified against the fixture: placements sit on the real terrain to a median −0.02 m; filtered against the fixture track bounds ±40 m, 7,955 placements and 3,221 trees stay in-arena, of which 1,483 are solid footprints (static, hull > 1 m) and 4,826 are sight blockers (solid + fragile ≥ 3.5 m + trees). Track check: 4,105 of 51,469 points fall inside a solid footprint — diagnosable, not a mapping error (tanks parked at footprint edges, rubble/trenches driven over). So the AABB is an upper bound on the solid object: usable as-is for SIGHT, too crude for hard drive-blocking.
- Wiring: 2D draws the filtered footprints as filled quads under the tanks (colour by kind), trees as canopy circles, water as its rectangle; 3D extrudes solid footprints to boxes (one InstancedMesh, base = footprint's lowest corner, top = height_m) and replaces the 220 seeded-random decoration trees with real SpTr positions (bushes likewise replace the 9,000 seeded bushes) — the seeded trees were the "bumps in the middle" Dayset saw. Trainer cones in 2D are now LOS-aware: each cone is a 15-ray fan, each ray stopping at the first terrain or footprint blocker, the solid fan being what the tank can see and dashed radials marking the unknown part. The 3D sight fans do NOT check cover yet.
- Not in it: tall fragile models (a 30 m basilica) block sight but are not extruded in 3D (the extrusion is the solid-footprints set, not the sight set); the ghost threat markers ignored LOS until 2026-11-05 (see "Ghost threat markers are now line-of-sight aware" below); the 2D cone fan is a 15-ray approximation, so a blocker narrower than the ~4.3° ray spacing can slip between two rays.

## Ghost threat markers are now line-of-sight aware (2026-11-05)
- A ghost threatens a friendly only if some position it can reach (inside its reach disc, within 445 m) has a clear line of sight to the friendly. No such position = no marker at all (no ring, no countdown). The countdown is the earliest time the ghost can reach a position with LOS, driving straight there at its fastest seen speed. The dashed line now points at that firing position instead of the nearest point of the reach disc.
- LOS is blocked by terrain (heightmap), buildings/footprints, trees (all via `segmentBlocked`) and by other tanks: a tank is a cylinder, radius 3 m (`TANK_BLOCK_R_M`) and top at ground + 2.7 m (`TANK_HEIGHT_M`) — a hull is ~3 m wide and ~6–7 m long, so the circle splits the difference and errs toward blocking; both numbers are initial guesses. Only alive, live-known tanks block: dead tanks are wrecks, and ghosts are not blockers (their position is unknown — the last-known spot is not a blocker). A tank never blocks its own shot or a shot aimed at itself.
- Sampling is bounded, cheapest first: the direct point (the closest firing position to the vanish point), then rings of 8 angles at 445 / 250 / 100 m around the friendly, nearest first, with an early-out on the first position that is reachable in the 30 s window, outside every friendly's 50 m bubble, not in a proximity shadow, and LOS-clear. The direct point alone decides the common open-ground case (1 LOS test per pair); the rings only run when it is blocked. Worst case is 24 LOS tests per pair, only for pairs whose direct line is blocked.
- Without obstacles loaded there is no LOS data, so threats fall back to the old range-only rule exactly (and the cones stay full fans). The coach's retrospective `dangerSpots` is untouched — this is the forward-looking threat only. The 3D sight fans do NOT check cover yet.
