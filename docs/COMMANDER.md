# AI Commander (WoT edition)

Same idea as the PS2Map Oracle commander in `Dayset/ps2-elite-kd` (`oracle/js/commander.js`,
`oracle/backend/commander_live.py`), re-built for tank battles:
**a clear, dummy-proof signal on the best move, looking a few steps ahead, ignoring low-value options.**
In PS2 it orders "all forces on base X"; here it says "fall back to E2 now — north is 2 v 5 and the TDM-54 is loaded".

## 1. What it does

| Feature | When | Output |
|---|---|---|
| **Call** | any paused second in the 2D player (key C) | `CommanderCall`: situation + up to 3 orders, the first is "the call" |
| **Shadow commander** | while playing | small panel: current call; flashes when the player's action diverges from it for > 10 s |
| **Debrief** | after a battle | the 3 biggest win-probability swings: what happened, what the call was, ΔWP |
| **Team view** | toggle | calls for every ally (what the team should have done), numbered on the map like the PS2 orders |
| **Voice** | button | Web Speech API reads the call in the UI language (en/ru), like `oracle/js/voice.js` |

## 2. Situation model

1. **Zones** per map (`packages/gamedata/maps/<map>.zones.json`): 3–6 named lanes/areas (polygons) drawn once per
   map by a human or an agent from heatmaps of the corpus, with grid squares (A–K / 1–0).
2. **Flank state** per zone: allies, known enemies, ghost enemies (seen < 30 s ago), HP pools, DPM pools,
   Lanchester strength `S_own/S_enemy`, trend over the last 20 s, reload windows.
3. **Global:** WP (METRICS.md §3.1), time left, base capture state, tags:
   `LOCKED_WIN` / `LOCKED_LOSS` (WP > 0.95 / < 0.05), `COLLAPSE_FORMING` (a flank's strength fell ≥ 40% in 30 s),
   `TWO_FRONT`, `TRADE_WINDOW` (≥ 2 nearby enemies reloading), `CAP_RACE`.

## 3. Choosing orders

1. Generate candidates for the recipient: stay, push zone, fall back to the nearest cover cell, rotate to another
   zone, defend/reset cap, wait for reload, spot (LT), trade now.
2. **Look ahead:** simulate 20 s with a per-flank Lanchester ODE (+ travel time from the zone graph) for each
   candidate; score `expectedWinProbDelta` vs "stay".
3. Drop options worth < 1 point of WP. Rank. Keep at most 3. If nothing is worth ≥ 1 point, the call is "hold".
4. Solo vs Team mode: solo = what the recorder alone can do; team = joint orders (each ally once).

## 4. Rules carried over from PS2Map Oracle

- Dummy-proof: one clear action first; numbers next to it; no essays.
- Ignore low-value targets; prefer moves that change the outcome (the decisive flank, the cap race).
- Extreme players must not distort the model: WP is computed from tank stats, not player ratings.
- Calls are **estimates**: always show the ΔWP and "why" chips (`TDM-54 loaded`, `north 2 v 5`).

## 5. Optional LLM wording (never facts)

- `services/api` `POST /debrief` takes only `CommanderCall[]` + `Finding[]` JSON and returns friendlier text in the
  player's language using WoT community words (RU: "размен", "засвет", "отъезжай на перезарядке", "фланг продавлен").
- Guard: the response is rejected if it contains a number, tank or name not present in the input. Fallback = templates.
- Key-gated, rate-limited, off by default. The product must be complete without it.

## 6. Validation

- Backtest on the corpus: does following the call correlate with better outcomes? Track the ΔWP of moments where
  the player did what the call said vs did not. Published in `docs/benchmarks/commander.md`.
- The owner reviews 20 calls per release on real replays (👍/👎), like the PS2 oracle reviews.
