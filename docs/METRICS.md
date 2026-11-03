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
