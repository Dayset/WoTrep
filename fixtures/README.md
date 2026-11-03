# Fixtures

| file | realm / version | map / mode | recorder | special |
|---|---|---|---|---|
| `replays/lesta-1.46-overlord-sbm44.mtreplay` | Lesta 1.46.0.0 #2308, RU2 | Overlord (`101_dday`), standard | YurOk_Zp, SBM-44 (autoloader) | win 15:8, survived, 4 anonymized players, enemy autoloader peek at 4:13 |

- `expected/<name>.expected.json` — produced by `tools/probe/wotrep_probe.py`. Never hand-edit.
- `timelines/<name>.timeline.json` — BattleTimeline v1 mock built from the probe (issue E0-04).
- `expected/findings/<name>.json` — detector snapshots (E7).

Wanted (see the fixture-corpus issue): a WG `.wotreplay` of the current version, a battle where the recorder dies,
an unfinished replay (1 JSON block), encounter/assault modes, a platoon, two replays of the same battle, artillery.
