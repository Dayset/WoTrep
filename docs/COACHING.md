# Mistake coaching — detector catalog

A detector finds a **moment**, measures what it **cost**, and shows the **fix**. Output = `Finding` (contract:
`docs/contracts/findings.md`). One detector = one file = one issue, so many agents can work in parallel.

## 1. Principles

1. **Moments, not totals.** "4:13 — peeked the TDM-54 right after it reloaded, −421 HP" beats "low survival".
2. **Cost in exact numbers**: HP lost, damage missed, ΔWP. No cost → `info`, not `mistake`.
3. **Fog-of-war fair:** judge only on what the recorder could know at that second (`stateAt` with `known` ≠ "never").
   Merged multi-POV data may be used to *explain* ("the hidden Lowe was here"), never to *blame*.
4. **Dice are not decisions:** if the outcome came mostly from RNG, mark `luck` and soften the wording.
5. **Also find good plays.** Players come back for praise with numbers ("punished the reload: +396 dmg, +3.2%").
6. **Few and sharp.** Max 5 mistakes + 3 good plays per battle in the default view, highest cost first.
7. **Calibrate with the owner.** Every finding card has 👍/👎. Precision per detector is tracked in E13; a detector
   below 70% precision on ≥ 30 rated findings is switched to "experimental".

## 2. Catalog

Data needs: **P** positions · **H** health events · **T** tracers/shots · **C** camera/aim · **R** reload model (gamedata)
· **Z** map zones · **W** win-probability model.

### Status (2026-11-03)
Shipped (all data we decode today, no gun data): `early-hp-dump`, `isolated-under-fire`, `bad-trade`, `won-trade` (good), `idle-with-targets`, `death-recap` (info), `survived-unused-hp` (info).
Blocked on real gun data (#42), because reload timing cannot be proven from shots alone (the estimate is an upper bound, FINDINGS.md): `peek-into-loaded-autoloader`, `punished-reload`, `exposed-while-reloading`, `low-yield-clip`.
Not started: `shooting-on-the-move`, `sniper-tunnel-vision`, `killshot-missed` (need aim/camera decoding #26/#30 or alpha from gun data).
The player shows findings as flags on the timeline, a card when you reach one, Coach mode (slows 6 s before, pauses `leadS` before, Continue), N / Shift+N to jump.

### Wave 1 — data we decode today (M3 "Coach v1")
| id | kind | trigger (initial thresholds = guesses, recalibrate) | needs | guide |
|---|---|---|---|---|
| `death-recap` | info | always on recorder death: killer, damage sources in last 30 s, exposure time, nearest ally, HP curve | P H T | why-you-died |
| `peek-into-loaded-autoloader` | mistake | took ≥ 2 hits from one autoloader within its clip window, its previous clip ended ≥ its reload time ago | P H T R | autoloader-timing |
| `punished-reload` | good | dealt damage to a target while its estimated reload had ≥ 3 s left | H T R | autoloader-timing |
| `isolated-under-fire` | mistake | nearest ally > 120 m **and** ≥ 3 known enemies within 300 m **and** took damage in the window | P H | stay-in-support |
| `bad-trade` | mistake | engagement dealt/received < 0.5 and received ≥ 1.5 × own alpha, recorder initiated it | H T | trading-hp |
| `exposed-while-reloading` | mistake | took damage while own reload > 2 s and recorder moved < 5 m since its last shot | P H T R | peek-shoot-hide |
| `early-hp-dump` | mistake | lost ≥ 50% HP before 2:00 battle time | H | first-two-minutes |
| `idle-with-targets` | mistake | alive, ≥ 60 s with no shot and < 20 m movement while an enemy was known within view range | P T | stay-useful |
| `low-yield-clip` | mistake | autoloader clip (≥ 4 shells within one clip) with ≤ 20% of shells penetrating; summary line "N clips did X% of your damage" | T H R | autoloader-timing |
| `shooting-on-the-move` | mistake | ≥ 30% of shots at > 20 km/h with hit rate on those shots < 50% (non-LT) | P T | aim-time |
| `sniper-tunnel-vision` | mistake | in sniper mode ≥ 8 s while a known enemy closed within 150 m from > 60° off the aim direction | P C | situational-awareness |
| `killshot-missed` | mistake | shot a tank with > 2× alpha HP left while a visible enemy with ≤ alpha HP was within range | P H T | target-priority |
| `survived-unused-hp` | info | team lost, recorder survived with ≥ 60% HP and dealt < 1× own max HP | H | using-your-hp |

### Wave 2 — needs map zones, WP model and more decoding (M4)
| id | kind | trigger | needs | guide |
|---|---|---|---|---|
| `stayed-on-collapsing-flank` | mistake | own flank strength < 0.5 and falling for ≥ 20 s, recorder stayed in zone | P Z W | when-to-fall-back |
| `wrong-flank-at-start` | mistake | by 1:30 recorder is on the flank with the lowest ally share while another flank decides the game | P Z W | map-opening |
| `base-cap-ignored` | mistake | enemy capping, recorder was the nearest healthy defender < 250 m and did not reset | P Z | cap-defense |
| `crossfire-entered` | mistake | moved into a spot visible to ≥ 2 known enemies with ≥ 60° angle between them | P Z | angles-and-crossfire |
| `artillery-standstill` | mistake | ≥ 2 SPG hits taken while stationary ≥ 10 s in the open | P H Z | arty-awareness |
| `lt-no-spotting` | mistake | LT spotted nothing in the first 3:00 or died before spotting | P + spot events | lt-spotting |
| `clutch-play` | good | Impact ≥ +10% earned while WP < 0.40 | W | — |
| `trade-window-used` | good | pushed during an enemy-side reload window and won the exchange | H T R | trading-hp |

### Wave 3 — needs decoding of hit details (armour, modules) (later)
`side-shown-to-enemy`, `ammo-rack-risk`, `wrong-ammo`, `hull-down-broken`, `module-damage-cascade`.

## 3. Reload model (shared by several detectors)

`packages/model/reload.ts` estimates each vehicle's gun state from gamedata (reload, clip size, intra-clip, autoreloader
steps) and the observed shots of that vehicle (tracers / showShooting). Output per vehicle and second:
`{ state: "loaded" | "reloading" | "clip", secondsLeft, shotsInClip, confidence }`.
Confidence drops when the vehicle was not visible (shots unseen) or crew/equipment are unknown (assume standard
crew 100% + rammer for the tier; widen the interval ±10%). Detectors must require `confidence ≥ 0.6`.
Fixture check: Tsunemikih (TDM-54) fired 10-shot bursts at 3:56–3:59, 4:13–4:17, 4:46–4:48 — the 4:13 burst is the one
that hit the recorder for 421 HP.

## 4. Death recap card (always shown when the recorder dies)

Layout template (illustrative numbers — the fixture's recorder survived):
```
💀 Died at 4:51 · killer: TDM-54 (Tsunemikih)
Last 30 s: −421 HP from TDM-54 (5 hits), −80 from SBM-44
Spotted for 14 s before the first hit · nearest ally 64 m
Your reload when hit: 2.3 s left
Fix: (top finding's fix)
```

## 5. Per-player mode

Detectors take a subject: `d.detect({ tl, cfg, subject: vid })`, or `runDetectors(tl, detectors, vid)`.
Without `subject` the subject is the recorder, so existing callers are unchanged. Any vehicle works —
teammate or enemy — and the report's Stats and Coach tabs let the viewer pick the subject. The stats side
needed no change: `playerHeuristics(tl, vid)`, `boldnessAll`, `teamplayAll` and `playerStats` already key
every vehicle.

What changes for a non-recorder subject, and what does not:

- Damage dealt *by* the subject is as complete as the replay saw it; damage *taken* is partly unseen
  (shots outside the recorder's area of interest are missing), so HP costs are lower bounds, not exact.
- Positions and visibility are the recorder's view of the battle (`stateAt`), not what the subject saw.
  Principle 3 therefore reads differently here: a finding about an enemy judges them on recorder-visible
  information, which is not a fair judgment of what the enemy knew. Treat non-recorder findings as
  best-effort analysis, not coaching verdicts.
- The report UI shows a partial-data note whenever the subject is not the recorder.
- `vanishEvents` stays recorder-relative by data necessity: only the recorder's side has a known spotter set.
