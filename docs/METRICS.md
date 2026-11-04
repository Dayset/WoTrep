# Metrics — classic (tracker parity) and WoTrep (ours)

Players trust the numbers they already know. We show those first, computed the standard way, so people can check
us against tomato.gg / XVM / in-game. Next to them we show our numbers and explain the difference in one line.
All formulas live in `packages/analysis`; each metric is a pure function with a unit test using the fixture.

## 1. Classic metrics (per battle and per session)

| Metric | Definition | Source |
|---|---|---|
| Damage, Assist (radio / track / stun), Blocked | from battle results | block 1 |
| Combined damage | `dmg + max(assistRadio, assistTrack, assistStun)` (MoE definition — verify against in-game MoE in E5) | block 1 |
| Kills, Spots, Survived, Lifetime | battle results | block 1 |
| Hit rate / Pen rate | `hits / shots`, `pens / hits` | block 1 |
| XP, Credits | results (recorder only) | block 1 personal |
| MoE progress | `personal.damageRating` (%), `movingAvgDamage`, `marksOnGun` | block 1 personal |
| **WN8** (battle) | standard WN8 with per-tank expected values, see 1.1 | gamedata |
| **EFF** | `dmg·(10/(T+2))·(0.23+2T/100) + kills·250 + spots·150 + log₁.₇₃₂(cap+1)·150 + def·150` | results + tier |
| WTR / personal rating | official rating from the realm API when available (`wtr` in block 0 is 0 in the fixture) | API |
| Win rate, battles, avg dmg (account / tank) | realm public API | API |

### 1.1 WN8

```
rDAMAGE = dmg/expDmg   rSPOT = spot/expSpot   rFRAG = frag/expFrag   rDEF = def/expDef   rWIN = win/expWin
rWINc    = max(0, (rWIN − 0.71) / (1 − 0.71))
rDAMAGEc = max(0, (rDAMAGE − 0.22) / (1 − 0.22))
rFRAGc   = max(0, min(rDAMAGEc + 0.2, (rFRAG − 0.12) / (1 − 0.12)))
rSPOTc   = max(0, min(rDAMAGEc + 0.1, (rSPOT − 0.38) / (1 − 0.38)))
rDEFc    = max(0, min(rDAMAGEc + 0.1, (rDEF  − 0.10) / (1 − 0.10)))
WN8 = 980·rDAMAGEc + 210·rDAMAGEc·rFRAGc + 155·rFRAGc·rSPOTc + 75·rDEFc·rFRAGc + 145·min(1.8, rWINc)
```
- **Battle WN8** follows the convention trackers use for single battles (to be confirmed against tomato.gg in E5;
  document the choice in `packages/analysis/src/classic/wn8.md`).
- Expected values: WG realms — tomato.gg table (WNX-era, includes newer tanks) with XVM v29.1 as fallback,
  versioned in `packages/gamedata/expected/`. **Lesta has no maintained table**: until we have one, show WN8 for
  Lesta tanks that exist on WG with the WG values and mark it "≈ WG values"; for Lesta-only tanks (e.g. `intunion:*`)
  show "—". E5 builds our own Lesta table from the corpus (50th-percentile method, like WNX) once n ≥ 300 battles/tank.
- Colour scale: the familiar tracker scale (red < 300 < orange < 750 < yellow < 1200 < green < 1800 < teal < 2450 < purple),
  numbers always printed.

## 2. Why we need more

WN8 is a damage total. It can't tell damage that won the game from damage farmed on a lost enemy at the end, and
it can't separate dice from decisions. PS2 Elite KD taught us three things that apply directly:
**weight by opposition**, **separate theory (mechanics) from practice (results)**, and **charge players for riding a
winning crowd** (🪳 Zerg). The WoT versions are below.

## 3. WoTrep metrics

### 3.1 Win probability (WP) — the engine under everything

`WP(t)` = chance the recorder's team wins, from the state at second `t`.
- **v0 (no data needed, ships first):** Lanchester square-law material eval.
  `S_team = (Σ_alive √(hp_j · dpm_j))²`, `WP = σ(a · ln(S_own / S_enemy) + b · capPressure + c · timeLeftTerm)`,
  `a, b, c` hand-set (initial guess, label it).
- **v1 (corpus):** logistic regression / gradient boosting on states sampled every 5 s from shared replays, features:
  alive counts, HP pools, DPM pools, tier mix, base capture, time left, spotted-enemy share, flank structure.
- **Benchmark like the PS2 oracle:** Brier score per time slice (`t/duration` deciles), held-out replays, calibration plot.
  A new model ships only if it beats the current one on Brier overall and in ≥ 7 of 10 slices.
  Report lives in `docs/benchmarks/wp.md`.

### 3.2 Impact (WPA)

Win-probability added. Every damage event moves WP: `ΔWP = WP(after) − WP(before)`. Credit it to the attacker (+) and
log it against the target (−). For the recorder we also credit spotting/track assist using personal events.
`Impact = Σ credited ΔWP` in percentage points. "+4.1%" = your actions moved your team's win chance by 4.1 points.
Damage on a full-HP threat early is worth more than finishing a 50-HP artillery at the end — automatically.

### 3.3 Cleanup share (🪳 analog)

Share of a player's damage dealt while their team's WP ≥ 0.90 (garbage time). High cleanup share + high damage =
"padding" pattern. Shown as a number, never as an accusation. Session-level: median over battles.

### 3.4 Threat-weighted damage

`Σ damage × w(target)`, `w = (target dpm × target hp_before) / median(dpm × hp)` at that moment. Rewards hitting
what is dangerous. Easier to explain than Impact; used in the Classic | WoTrep scoreboard.

### 3.5 Trade ratio and exchanges

Engagement = window where the player and an enemy damage each other with gaps < 12 s. Per engagement:
`dealt / received`, HP spent, who started it, who had the reload advantage. Battle trade ratio = Σ dealt / Σ received in
engagements (ignores damage from unseen artillery, reported separately).

### 3.6 Clutch (🦁 Brave analog)

Share of the player's Impact earned while their team's WP < 0.40. High clutch = performs when it matters.

### 3.7 Luck (🎲)

Separates dice from decisions so coaching stays honest.
- **Damage-roll luck:** each hit's damage vs the shell's nominal alpha (gamedata): `Σ(actual − nominal) / Σ nominal`.
- **Close calls:** times the player survived with ≤ 10% HP, and times they died to a high roll.
- Findings whose outcome was mostly the roll get `luck: "rng-bad" | "rng-good"` and are shown as "unlucky", not as mistakes.

### 3.8 Theory vs practice (🔀 Diff)

Same idea as PS2 Elite KD's Diff column.
`Theory` = percentile of mechanics in that tank class: hit rate, pen rate, DPM utilisation (`damage / (alive time × DPM)`).
`Practice` = percentile of Impact. `Diff = practice pct − theory pct`, −99…+99.
Negative = good aim that doesn't convert (positioning / target choice problem). Positive = decisions beat mechanics.
Needs the corpus (E13); until then hidden behind "experimental".

### 3.9 Bottom-tier constancy (⚡ Const analog)

Impact as bottom tier vs as top tier (matchmaking position from block 0 tiers). 1.00 = holds completely.

## 4. Data quality guards (from PS2 Elite KD)

- **Outlier guard:** a value is an outlier when robust z = (v − median)/(1.4826·MAD) is beyond ±Z **and** it sits past
  `p99 + K·(p99 − median)`. Outliers don't enter baselines or WP training until reviewed.
- **Baselines exclude** battles with `finishReason` ≠ normal end, < 120 s, bots, training rooms, and duplicates
  (same `arenaUniqueId` + recorder).
- **Thresholds are measured**, stored with `n`, date and percentile in config, re-measured when the corpus grows.
- **Wording:** impossible numbers → "flagged: impossible stats". `hasMods: true` → "client mods: yes" (neutral; most mods
  are allowed). Never "cheater".

## Relative metrics: what we can know about other players (verified on the fixture)

Two sources, different completeness:

1. **Battle results, all 30 players, exact:** damage, assist (radio/track/stun), blocked, kills, spotted, shots/hits/pens,
   damage received, life time, death reason, killer id, mileage, xp. Derived for everyone: DPM, accuracy (hits/shots),
   pen rate (pens/hits), survival time, blocked per damage received, spots per minute, metres per minute.
2. **Per-hit events for other players, partial:** the replay delivers `onHealthChanged` (attacker id, amount) for every
   vehicle inside the recorder's area of interest. On the fixture 429 events cover 27 attackers and **89%** of all official damage
   (41 932); the recorder's own 28 hits are 100%. Per player, `coverage = observed hit damage / results damage`
   (`playerHeuristics`, `packages/analysis`). Impact, threat-weighted damage, cleanup share are therefore computed for everyone;
   values with coverage < 75% are shown as partial (`~`, dashed) and never silently ranked as complete.

Not recoverable for others: their aim, reload state, shots that missed or hit nothing outside our view, positions of unspotted enemies
(fog gaps stay gaps), their own damage-received detail. Win-probability swing for a player uses that player's team's win probability.
Open question: whether a larger corpus shows coverage patterns by role (heavies at the front are seen more than flankers).

## 3.7 Initiative (boldness) v0 — took the chance to fight, or played safe

Question: *how often did a player have a chance to improve the team's odds and take it?* (PS2 Elite's 🦁 Brave measures how K/D holds against stronger enemies;
this is the opportunity-based counterpart and does not need long histories, one battle is enough.)

- **Opening** (per second, per player): the player is alive and visible, an enemy is visible within `engageRangeM` (220 m), the player's team win probability
  is < `maxWp` (0.9, outcome still open), and the gun is probably ready (not within the player's own fastest observed shot cycle; reload estimator, confidence ≥ 0.3; an approximation until gun data lands).
- **Episode**: consecutive openings (gap ≤ 2 s). **Taken**: the player fired within `windowS` (5 s) of the episode.
- **Initiative = taken / episodes**, shown only with ≥ 3 episodes; otherwise "—". Same definition for all 30 players (each only judged in seconds we can see them).
- Config: `packages/analysis/config/boldness-v0.json`, every value "initial guess, recalibrate in E13".
- Fixture: spread 17%-100% across players, recorder 7 of 10 (70%).

Known limits (v0): it counts *taking* a chance, not whether it paid off; a good ambusher or sniper may rightly score low; a shot at long range counts as
taking a chance; reload and cover are only partly modelled. ### v1 (shipped): how the chances went

For every *taken* episode we look at the window from its start to `windowS` (5 s) after its end:

| Outcome | Rule (all numbers in `config/boldness-v0.json`, provenance "initial guess") |
|---|---|
| **Rewarded** | threat-weighted damage dealt ≥ `rewardRatio` (1.0) × HP lost, with something dealt — or a kill by the player in the window |
| **Costly** | HP lost ≥ `minLossShare` (10%) of max HP **and** threat-weighted damage dealt < HP lost **and** no kill |
| **Flat** | anything else (little happened) |

`paid = rewarded / taken`, `costly = costly / taken` (both need ≥ `minTaken` = 3 taken chances). **Style** (a description, not a grade):
`safe` initiative < 0.35 · `bold-costly` initiative ≥ 0.35 and costly ≥ 0.40 · `bold-rewarded` initiative ≥ 0.60, costly < 0.40 and paid ≥ 0.50 · else `balanced`.
Opposition weighting enters through the target weight on each hit (§3.4), as in PS2 Elite's strength weighting. Damage taken by other players is only seen where
they were visible to the recorder, so enemies' "costly" counts are lower bounds. Fixture: recorder 70% initiative, 4 of 7 paid off, 2 of 7 costly → bold, rewarded.

## 3.8 Rule: every value we show is explained

A new number, column or chart option is not done until it has (1) a row in the glossary below, (2) `gl.<key>.how` and `gl.<key>.mean` texts in `en.json` and `ru.json`
(shown to the player under the card / chart), and (3) its key in `METRIC_KEYS` (`apps/web/src/features/report/glossary.ts`); a test fails otherwise. "How" says exactly where the
number comes from (results field, event, model, config thresholds). "Mean" says what a player should take from high and low values and what it is *not*.

| Key | Source | Meaning for the player |
|---|---|---|
| impact | per-hit events + win-probability model v0 | win chance your hits added; compare inside one battle |
| threat | per-hit events × target weight (target DPM ÷ enemy median, 0.25–3) | whether your damage hit the dangerous players |
| onthreats | per-hit events, weight ≥ 1 | share of damage on dangerous targets |
| cleanup | per-hit events, team win chance ≥ 90% | damage dealt after the result was mostly decided |
| dpm | results: damage, life time | damage per minute alive |
| bold | positions + visibility + shots + reload estimate | how often you fought when a chance existed |
| paid / costly | bold episodes + hits + damage taken + kills | whether the chances you took won or lost the exchange |
| style | bold, paid, costly thresholds | description of the battle's style, not a grade |
| acc / pen / life | results: shots, hits, pens, life time | accuracy, penetration rate, share of the battle survived |

### 3.9 Running curves (player strip)
Per-second series from `seriesFor` (packages/analysis/src/series.ts): cumulative damage to enemies, damage/min (battle minutes, or life minutes once destroyed), cumulative shots, damaging hits ÷ shots (from the 3rd shot). Observed events only. The UI explains each curve under the chart (`curve.*.how`) and warns when hit coverage < 98%. Win chance reuses WP v0. Survival probability is planned, uncalibrated until E13.

### 3.10 Teamplay v0 (how you fight with the team)
Code: `packages/analysis/src/teamplay.ts`, thresholds in `config/teamplay-v0.json` (all initial guesses, recalibrate in E13). Computed for every player; shown for the recorder, and for others only when their track covers the team's spawn.
| value | how | what it tells |
|---|---|---|
| Focus fire | share of your damage on targets a teammate also hit within 4 s | breaking targets together vs shooting alone |
| Fought with company | share of your hits fired with a living teammate within 150 m | lone wolf vs fighting beside help |
| Hung back (s, share) | seconds alive in the rearmost third of the living team (distance from spawn), a teammate took damage in the last 5 s, and no shot of yours within 5 s either side | not supporting a fight that is happening |
| Position in the team | average place (0 last .. 100% furthest forward) by distance from spawn among living teammates | leading vs trailing |
| Team spread | mean distance of living members from their centre, every 5 s, averaged | grouped vs strung out |
Limits: positions only exist where the replay tracked them; hits only where the replay reported them (coverage differs per replay); "forward" is distance from spawn, not toward the enemy; map lanes are not modelled, so a deliberate flank can look like hanging back. Not yet: weighted decisions (below).

### 3.11 Good plays for everyone, enabled-by credit, team alignment
Code: `packages/coach/src/teamgood.ts`, thresholds in `packages/coach/config/team-good.json` (initial guesses, recalibrate in E13).
- **Good play (any player)** = a won trade by the same rule and thresholds as the `won-trade` detector (`config/won-trade.json`), run for every vehicle. Shown as dots under the player timeline: blue = teammates, red = enemies; faded when we see little of that player's damage (`coverage` = observed damage / official damageDealt).
- **Enabled by teammates** (`carried` / `shared` / `solo`): for the enemies the player traded with, damage they dealt to teammates in the 15 s before and during the play (`absorbedHp`) and teammates they destroyed (`sacrificed`). carried = a teammate was destroyed by them, or absorbed share >= 50% (absorbed / (absorbed + damage the player took)); shared = some absorbed but less; solo = none.
- **Team alignment** = share of a team's good plays that overlap (within 10 s) a good play by a different teammate. Needs >= 2 plays.
- **Luck is not separated.** It needs gun data (damage range, penetration, ricochet angles; #42). `Finding.luck` stays unused until then. "Carried" is evidence of teamplay, not proof; "solo" does not prove skill.
- Limits: enemies' plays rest on partial data (their damage taken is only partly reported), so they carry a coverage fade; the other team's positions are only known when seen; the absorbed-fire window ignores distance and line of sight.

### 3.12 Sacrifice ledger
Code: `ledger()` in `packages/coach/src/teamgood.ts`; table in `apps/web/src/features/report/Ledger.tsx` (recorder's team). For every good play (see 3.11) the helpers are the teammates who took damage from the same enemies in the 15 s before and during it, plus teammates those enemies destroyed. Per player: **made space for** (number of teammates' good plays helped), **HP absorbed**, **destroyed for** (died to the enemies in such a play), and **own plays enabled** (their own good plays that were carried / all their good plays). Taking hits alone earns nothing: credit exists only when a teammate then won a trade. Limits as in 3.11 (partial hit data, no line of sight, thresholds are guesses).

### 3.13 Flank model (force distribution)
Code: `packages/analysis/src/flank.ts`, config `flank-v0.json`. Axis from the team's spawn (first 10 s) to the centre of where the enemy was first seen (first 90 s). Lateral position (left/centre/right thirds by percentiles of all tracked positions) of every living, known unit; every 5 s the living HP of each team per flank; ratio = own / (own + enemy) where at least 600 HP are present. Shown as three strips in the player's curve panel ("Flanks"): blue ahead (> 60%), grey even, red behind (< 40%). `ownShare` / `foeShare` give the average split of each team's HP across flanks.
Limits: **enemies count only while seen** (live, or ghost under 20 s), so the ratio favours the recorder's team where the enemy is unseen; lanes are thirds, not real map lanes; the axis is a straight line between spawns; both teams' spawns need tracks (the enemy's is estimated from first sightings). Not yet: "reinforce score" (did a player move toward the flank that was falling behind) and flank alerts in the coach.

### 3.13b Reinforce score
`reinforce()` in `packages/analysis/src/flank.ts` (config `flank-v0.json`: behindRatio 0.4, behindForS 15, respondWithinS 30; initial guesses). An episode = a flank where own HP share stays below 40% for 15 s (one per flank until it recovers). A responder = a living teammate who started on another flank and reached that flank within 30 s of the episode start. Team card: episodes answered / episodes and the median arrival time; player card: episodes the player answered. Limits: enemies counted only while seen; flanks are map thirds; a player already on the flank cannot be a responder.

### 3.14 Data coverage badge
`coverage()` in `packages/analysis/src/coverage.ts`, shown at the top of the report (`CoverageBadge`). Values: damage the replay reports / official damage of all players; shot events / official shots; share of alive time with a known position for own and enemy team (enemy only while visible); whether kills were rebuilt from results. Level: **good** = damage >= 85% and enemy seen >= 40%; **low** = damage < 50%; otherwise **partial**. It is context for trusting every other number, not a score of the player.

### 3.15 Danger spots (per player)
Mirror of good plays (§3.11). Rule = the `bad-trade` rule applied to every player: an engagement (hits within `gapS` 8 s) with received >= 25% max HP and dealt/received < 0.5. Cause, first match: `alone` (nearest living ally > 120 m at the start), `crossfire` (>= 2 different enemies), `early` (before 60 s battle time), else `outtraded`. Each cause maps to a "what not to do + why" line. Config `packages/coach/config/danger.json` (all initial guesses, recalibrate in E13). Limits: hits on players the recorder never saw are missing (see coverage), cause is a likely reason not a verdict, no class/gun data (#42). UI: report panel `Danger.tsx`, own/enemy toggle, worst spot per player.
