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
  is < `maxWp` (0.9, outcome still open), and the gun is not *known* to be reloading (reload estimator, confidence ≥ 0.3).
- **Episode**: consecutive openings (gap ≤ 2 s). **Taken**: the player fired within `windowS` (5 s) of the episode.
- **Initiative = taken / episodes**, shown only with ≥ 3 episodes; otherwise "—". Same definition for all 30 players (each only judged in seconds we can see them).
- Config: `packages/analysis/config/boldness-v0.json`, every value "initial guess, recalibrate in E13".
- Fixture: spread 17%-100% across players, recorder 7 of 10 (70%).

Known limits (v0): it counts *taking* a chance, not whether it paid off; a good ambusher or sniper may rightly score low; a shot at long range counts as
taking a chance; reload and cover are only partly modelled. **v1 (planned):** split taken episodes into "paid off" (Impact > 0, damage per HP lost) and "cost more than it gave",
so the headline becomes *bold and rewarded* vs *bold and reckless* vs *safe*; add opposition weighting (chances against stronger targets count more), the way
PS2 Elite weights by enemy strength.
