# UI / UX specification

Audience: WoT / Mir Tankov players from beginner to unicum, mostly Russian- and English-speaking.
They know trackers (WN8, MoE, tomato.gg/XVM colours) and the in-game minimap. Speak their language, then
show them what trackers can't.

## 0. Style rules (apply to every screen)

- **Flat, sharp square corners**, no rounded cards, no gradients, no glassmorphism (same house style as PS2 Elite KD).
- Dark theme by default (battle feel), light theme available. Design tokens in `packages/ui-kit/tokens.css`.
- **Exact numbers, never letter grades.** "−6.2% win chance", not "D". Category icons are allowed next to numbers.
- **Short text.** One line title, ≤ 2 lines body, one fix. Details behind "why?" (hover on desktop, tap on phone).
- Every number has a hover that says how it was computed (formula + inputs).
- i18n from day one: `en` and `ru`; keys in `apps/web/src/i18n/*.json`; no string literals in components.
- Team colours: green/red default, colour-blind preset green/purple (WoT's own option). Never rely on colour alone:
  enemies also have a different outline.
- Phone: everything readable in portrait; tables keep a pinned header and pinned first column; blocks collapsible.

## 1. Home — drop and library

```
┌──────────────────────────────────────────────────────────────┐
│ WoTrep                                         EN | RU   ☾   │
├──────────────────────────────────────────────────────────────┤
│   ┌──────────────────────────────────────────────────────┐   │
│   │   Drop .wotreplay / .mtreplay here  ·  or browse     │   │
│   │   Parsed on your computer. Nothing is uploaded.      │   │
│   └──────────────────────────────────────────────────────┘   │
│  Your replays (stored in this browser)        [Session view] │
│  ▸ 03.11 20:25  Overlord  SBM-44   WIN  1362 dmg  +4.1% imp  │
│  ▸ …                                                         │
└──────────────────────────────────────────────────────────────┘
```
- Multi-file drop = a session. Parsing progress per file. Unsupported version → still opens with a banner
  "partially supported version: positions and results only".

## 2. Battle report (first screen after a drop)

Top to bottom:
1. **Header**: map, mode, tier, date, result, duration, your tank. Buttons: **▶ Watch (2D)**, **🎓 Coach mode**, Share.
2. **Your battle in 3 numbers**: `Impact` (Σ ΔWP of your actions, in %), `Damage vs your usual` (dmg / movingAvgDamage),
   `Luck` (RNG share of the result). Hover explains each.
3. **Win-probability strip**: the whole battle as one curve (like a chess eval bar), markers for kills, your
   findings (red = mistake, green = good). Click = open the 2D player at that second.
4. **Findings** (sorted by cost): icon · time · title · cost in exact numbers · ▶ (jump) · 📖 (guide).
5. **Scoreboard — classic** (both teams): dmg, assist, blocked, kills, spots, hits/pens, WN8 (battle), XP. Same
   colour scale people know from trackers. Toggle **Classic | WoTrep** swaps in our columns (Impact, Cleanup %,
   Opp-weighted dmg, Trade ratio, Luck).
6. **Classic vs ours** explainer box: "WN8 says 1,850 (good). Impact says +4.1% — 61% of your damage came while
   your team was already winning by 4+." Short, factual.

## 3. 2D tactical player (the core screen)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▮▮▮▮▮▮▮▮▮ 14 · 18,240 HP     WIN 63% ▲      HP 15,900 · 12 ▮▮▮▮▮▮▮           │  team bars (SC2 army value)
├────────────┬─────────────────────────────────────────────────┬───────────────┤
│ ALLIES     │                                                 │ 🎖 COMMANDER  │
│ ■ SBM-44   │          map (minimap image, grid A–K / 1–0)    │ North: 3 v 5  │
│  ███▌ 1246 │      ◆ allies   ◇ enemies (ghost = hollow)      │ str 0.6 ▼     │
│  ⟳ 2.1s    │      ─ tracers  ┄ spot lines  ○ view range      │ ► FALL BACK   │
│ ■ T-44 ... │                                                 │   to F2 (+3%) │
│ ENEMIES    │                                                 ├───────────────┤
│ ■ TDM-54   │         [ finding card when paused ]            │ ⚠ FINDING     │
│  ⟳ 9s ⚠   │                                                 │ Peeked a      │
│            │                                                 │ loaded auto-  │
│            │                                                 │ loader −421HP │
├────────────┴─────────────────────────────────────────────────┴───────────────┤
│ ◀◀ ▶ ▶▶  0.25 0.5 1 2 4 8×   4:13 / 5:28   ⚑ next finding   👁 POV  ⚙ layers   │
│ ▁▂▃▅▆▆▅▇▇█  win% curve                                                       │
│ ┼──x──x──◆──x─x───⚠──x──x──◆───x──  event ticks (kills, damage, findings)   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Map layer
- Minimap image with the game's grid (letters A–K, numbers 1–0). Coaching text uses these squares ("move to E5").
- Tanks: class shapes (LT, MT, HT, TD, SPG, like the in-game minimap), hull direction notch, gun line when known,
  HP ring. Recorder is outlined in yellow.
- **Fog of war is the default**: enemies drawn only while the recorder saw them; afterwards a hollow ghost at the last
  known position, fading over 30 s, with age label. Toggle "merged view" when several replays of the same battle
  (same `arenaUniqueId`) are loaded — then more is visible (badge shows "3 POVs merged").
- Tracers (short-lived lines), hit markers (pen / bounce / no-damage when decodable), floating damage numbers,
  kill crosses with time, spot lines, base circles and capture progress.
- Optional layers: view range circle, 445 m spotting limit, 565 m draw distance, heat of where you spent time,
  reload timers over enemy tanks (estimated, dashed when uncertain).

Controls (keyboard first; all have buttons)
| key | action | key | action |
|---|---|---|---|
| Space | play / pause | ← / → | −5 s / +5 s |
| , / . | step 0.1 s | 1…6 | speed 0.25, 0.5, 1, 2, 4, 8 |
| N / Shift+N | next / previous finding | F | follow recorder (toggle) |
| V | fog: my view / merged | L | layers menu |
| C | commander call at this second | P | POV at this second |
| click a tank | select, show its HP/reload/damage log | double-click | follow that tank |

Coach mode
- Plays at 2×, slows to 0.5× near a finding, **auto-pauses** `leadS` seconds before it, draws the evidence (threat
  lines, exposed zone, enemy reload timer, suggested path) and shows the card:
  **title** · what happened (numbers) · what to do instead · [Show suggested move] [Ask Commander] [Drill me] [Continue].
- Drill me: rewinds to the decision moment, hides the outcome, asks "what's the best move?" with 3–4 choices on the map;
  then plays the real outcome and the Commander's call.

## 4. POV moment viewer

Opened from the player (P) at a given second. Loads ±10 s around it.
- 3D terrain + tanks at their positions, your camera (from recorder aim data), aim line, shell traces, the enemy you
  could not see shown as a ghost.
- Two asset modes, shown in a badge: **"Your game files"** (models/terrain loaded from the user's local install,
  never uploaded) or **"Simple"** (generic low-poly hulls by class, flat-shaded height map).
- Scrub only inside the loaded window; "back to 2D" keeps the time.

## 5. Guides

- Guide page = 1 idea, ≤ 5 short steps, 1 animated 2D clip, 1 drill. Linked from findings.
- Index by topic (autoloaders, flanking, spotting as LT, side-scraping, map control per map) and by map / spawn.
- "From your battles" section lists your findings for that topic with links.

## 6. Session view

Several replays: per-battle Impact / dmg / WN8 line chart, the most frequent finding types, "you play worse after
3 losses in a row" style patterns when supported by the numbers (n shown).

## 7. Empty, error and edge states

- Unsupported/corrupt file: say which step failed (container / decrypt / packets) and offer "send diagnostics"
  (only the diagnostics object, never the file, opt-in).
- Unfinished replay (no results block): report hides result-based numbers and says why.
- Old WG versions: "positions only" banner.

### 4.1 Simple 3D in the player (built 2026-11-03)
Toggle in the player controls: Top-down / First person / Behind the tank. Three.js scene (lazy loaded), flat ground (minimap as texture when a map is loaded), boxes for hull, turret and gun, blue = your team, red = enemy, faded = last known position, yellow = enemy that hit the followed tank in the last 4 s. Camera follows the selected tank (default: recorder) and the replay clock. Limits: no height or cover, camera uses hull direction (gun aim not decoded). Next: open it from a finding or danger spot at the moment of the mistake (E10).
Update: free look in both 3D views (drag = rotate, wheel/pinch = zoom, double-click = reset); seeded decoration (trees, bushes, clouds, far mountains) that is NOT map data and must never be read as cover.
Update: scope zoom in first person (selector No scope / 3x / 6x / 12x, default 6x (raised 50% from 2x/4x/8x, owner request: more pleasant to observe)). The view zooms smoothly while the estimated turret is on a real target (arrived for a coming shot or holding after one) and shows a scope vignette. It is a stand-in for the sniper mode the shooter likely used; real zoom levels need per-player settings and are not in the replay.
Update: camera and tank rotation in 3D are smoothed (exponential, about 0.16 s) so left/right turns are as smooth as forward/back movement; a seek snaps instead of sweeping. "Lock view to the replay" disables free look (the camera follows the replayed player's own direction); "Resync view" returns a free-looked camera to that direction (double-click does the same).
