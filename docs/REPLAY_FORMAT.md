# Replay format — what we know

Status: **verified on one replay** — Mir Tankov (Lesta) 1.46.0.0 #2308, RU2, map `101_dday` (Overlord), standard battle.
Fixture: `fixtures/replays/lesta-1.46-overlord-sbm44.mtreplay`. Oracle: `tools/probe/wotrep_probe.py`.
Every claim below has a confidence tag: **[V]** verified against battle results, **[O]** observed and consistent, **[?]** guess.

World of Tanks (Wargaming: EU/NA/ASIA, `.wotreplay`) and Mir Tankov (Lesta: RU, `.mtreplay`) share the
BigWorld engine and the same container. They diverge in content (vehicles, maps, method indices), so
everything version-specific is keyed by **(realm family, client version)** — see §6.

## 1. Container [V]

```
u32  magic = 0x11343212          (bytes 12 32 34 11)
u32  blockCount                  (1 = battle not finished / no results, 2 = has battle results)
repeat blockCount:
  u32  length
  u8[] JSON
u32  decompressedSize
u32  compressedSize
u8[] encrypted stream            (length rounded up to 8)
```

- **Block 0** (arena info): `playerName`, `playerID`, `playerVehicle`, `mapName`, `mapDisplayName`, `gameplayID`
  (`ctf` standard, `domination` encounter, `assault`…), `battleType`, `clientVersionFromExe`, `clientVersionFromXml`,
  `regionCode`, `serverName`, `dateTime`, `arenaUniqueID`, `hasMods`, `vehicles{avatarSessionId → {name, fakeName,
  vehicleType "nation:Tag", team, maxHealth, clanAbbrev, wtr, isAlive, …}}`.
- **Block 1** (when present) is a JSON array `[battleResults, vehiclesStatus, frags]`.
  `battleResults` = `{personal, players, vehicles, common, avatars, arenaUniqueID}`. `common.duration` (s),
  `common.winnerTeam`, `common.finishReason`. `vehicles[avatarSessionId][0]` has the full per-player scoreboard
  (damageDealt, damageAssistedRadio/Track/Stun, damageBlockedByArmor, kills, spotted, shots, directEnemyHits,
  piercingEnemyHits, damageReceived, lifeTime, deathReason, killerID, mileage, xp…). `personal` adds the recorder's
  economy, `details` per target, `movingAvgDamage`, `damageRating` (marks-of-excellence progress) and `marksOnGun`.

## 2. Encryption + compression [V]

- Blowfish **ECB**, key `DE72BEA0DE04BEB1DEFEBEEFDEADBEEF` (same on Lesta 1.46 as on WG).
- Chaining: `plain[0] = D(c[0])`; `plain[i] = D(c[i]) XOR plain[i-1]` for i ≥ 1.
- Then zlib (`78 da`) over the first `compressedSize` bytes. Output length must equal `decompressedSize`.
- In the browser: implement Blowfish in TS (≈200 lines, no deps) and use `DecompressionStream('deflate')`
  with an `fflate` fallback.

## 3. Packet stream [V]

```
u32 payloadLength
u32 type
f32 clock          (seconds since recording start; battle start = clock of arena period 3, §5)
u8[payloadLength] payload
```
The fixture parses to exactly the end of the stream: 120,261 packets, last one type `0xFFFFFFFF` (end marker).

| type | n (fixture) | meaning | conf |
|---|---|---|---|
| 0x00 | 1 | BattleSetup: avatar entity id + pickled arena setup | O |
| 0x05 | 422 | Entity create / enter AoI (vehicle becomes visible) | O |
| 0x04 | 277 | Entity leave AoI | O |
| 0x07 | 42,420 | Entity property update: `u32 entity, u32 propIdx, u32 len, value` | V |
| 0x08 | 3,046 | Entity method call: `u32 entity, u32 methodIdx, u32 len, args` | V |
| 0x0A | 55,202 | Position update (§4) | V |
| 0x18 | 1 | Client version string (`u32 len, ascii` → `1.46.0.0`) | V |
| 0x1A | 3,613 | Recorder camera/aim: 15 × f32 — `[aim point (3), a, b, camera pos (3), aim dir (3, unit), c, -1, -1, -1]` | O |
| 0x1B | 46 | Camera mode string: `arcade`, `sniper`, `strategic`… | V |
| 0x1C / 0x1D | 3,085 / 2,491 | 1 × f32 each, ~10 Hz, no entity field (recorder's own channel) — likely gun/turret control axes; ranges 0x1C (−1.32, 1.92), 0x1D (−0.19, 0.14) | ? |
| 0x20 | 15 | 2 × f32: pre-battle `(0.0, -1.0)` then 7 pairs `(0.0, 11.813)` / `(-11.813, 11.813)` ~11.7 s apart; no kill correlation | ? |
| 0x23 | 4 | Chat message, HTML (`<font color=…>Name[CLAN] (Tank)&nbsp;: </font>text`) | V |
| 0x24 | 955 | Per-entity method records: `[u32 id, 01, method u8, 00 00 00, payload]`; methods 02/04/05/06 on a non-vehicle id space, 09/10 duplicate Vehicle method 10 (see §5) | O |
| 0x26 | 3,491 | 10 × f32 — recorder aim/hull state: `[?, dir (3, ~unit), ?, ?, ?, ?, 0.0, ?]`; direction differs from 0x1A aim dir | O |

0x1A, decoded further (verified geometrically at three clocks): `[5:8]` is the camera position and
`[0:3]` is the aim point — `normalize([0:3] − [5:8])` equals `[8:11]` to 0.001, and `[8:11]` has unit
norm at every sampled clock, so `[8:11]` is the aim direction. `[12:15]` is always `(-1, -1, -1)`
(3,613/3,613). `[3]`, `[4]` and `[11]` are angle-like fields with `[3] ≥ [4]` and gap ≤ 0.225 rad;
their exact meanings are open. 0x26 `[1:4]` has norm 0.99–1.00 (a direction, not the 0x1A aim
direction — consistent with hull direction, unverified against 0x0A yaw); `[8]` is 0.0 at sampled
clocks. 0x20's pairs are event-triggered, not periodic across the battle; three of its clocks
(158.56, 287.25, 322.05) coincide exactly with Avatar method 60 calls — an unexplained lead, not
a claim. 0x24 methods 09 (23 records) and 10 (397) join 420/420 with a Vehicle method 10 call on
the same target at the same clock [V], so they are target-side duplicates of showDamageFromShot; the
153 method 10 calls without a 0x24 duplicate may be out-of-AoI hits (unverified). 0x24 methods
02/04/05/06 (14/77/429/15 records) carry ids in `0xbfc10d–0xc06aXX`, distinct from vehicle ids —
a second entity space, unverified; method 05's count (429) equals the health-change count by
coincidence (only 25/429 share a clock within 0.06 s).
| 0x31 | 308 | Named client events, pickled args: `client_vehicle_state_32`, `applyZoom`… | O |
| 0x11 | 1 | End of battle (pickled) | ? |

## 4. Position packet 0x0A [V]

```
u32 entityId
u32 attachedVehicleId    0 for vehicles; for the Avatar entity = the recorder's vehicle id
f32 x, y(height), z      world metres; minimap uses (x, z)
f32 posError[3]
f32 yaw, pitch, roll     hull orientation, radians
u8  flag
```
~10 Hz per entity. **Fog of war:** allies are present all battle; enemies only while they are inside the
recorder's area of interest (spotted / close). Gaps are real gaps — renderers must show a *last known* ghost,
never interpolate across a gap (the straight red lines in `docs/img/first-replay-trails.png` are that bug).

## 5. Method and property indices — Lesta 1.46.0.0 [V unless marked]

**Avatar** (entity id from the 0x0A packet whose `attachedVehicleId ≠ 0`):

| idx | method | args | conf |
|---|---|---|---|
| 38 | showTracer | `u32 shooterVehicleId, u32 shotId, …` (51 B) | O |
| 30 | stopTracer | `u32 shotId, f32[3] endPoint` (16 B) | V: 584 of 761 shots on the fixture; every end matches a shot; shot-to-end distance median ~100 m, p90 ~224 m, max ~470 m |
| 62 | explodeProjectile | `u32 shotId, …` (31 B) | ? |
| 66 | updateArena | `u8 updateType, BWString pickle` (zlib when it starts with `x`) | V |
| 60 | onBattleEvents (personal shot-event log) | `u8 count, count × [u32 target, u8 flag, u8 flag, u16 0x0010]` | V: 15 calls, 50 records; per-target totals equal the recorder's Vehicle method 10 totals for all 5 targets, and every call's records share one target with clocks clustered on that target's bursts |
| 73 | quest progress (`regular_4_3_13`…) | pickle | O |

`updateArena` types seen: `3` period `(period, endTime, length, …)` — **period 3 = battle start**, fixture
clock 33.26 s; `5` vehicle status; `6` **vehicle killed** `(victimId, killerId, equipmentId, reason, n)` [V, 24 kills
match results]; `7` avatar ready; `8` base/team info; `4` vehicle list; `24`, `26`, `30` config.

**Vehicle** (entity id = avatarSessionId = keys of block 0 `vehicles`):

| idx | method | args | conf |
|---|---|---|---|
| 3 | onHealthChanged | `i16 newHealth, i16 oldHealth, u32 attackerId, u8 attackReason` | V — recorder's 28 events sum to 1,362 = results `damageDealt` |
| 1 | showShooting | `u8 burstCount, u8 gunIndex` | O: 104 calls on the fixture, none for the recorder (first-person shooting is shown via showTracer instead); burstCount is uniformly 1 here, so it carries no burst information on this fixture and is not a usable recorder shot counter — see the counting rule below |
| 10 | showDamageFromShot | `u32 attackerId, u8 type (01 = 16 B, 02 = 24 B), …` | O: 573 calls; fires for damaging and non-damaging hits alike (about a quarter have no same-clock health change), i.e. every shot that reached the target — the client-side armour-hit marker feed. Attacker = recorder for 50 calls, exactly the Avatar method 60 record count; 420/573 have a target-side 0x24 duplicate |
| 8 | (collision / ramming?) | 36 B | ? |

Vehicle properties: `15` health (i16) [V: 429 updates, every one equal to its health call's newHealth at
the same clock and entity], `14` gun angles packed (u16) [?: 28,723 updates on 29 vehicles; values do not
track 0x1C/0x1D at matched clocks], `16` (u16) [vehicle: 2-byte state — `(0,0)` = dead (entity set equals
the killed set, clocks within ±0.2 s of the kills), `(1,0)` = initial state (battle start and just before
death), other `(a, b)` states with `a` in 1–3 and `b` in 0–10 open; avatar: a different 8-byte property at
10 Hz, open], `6` (u8) [O: recorder-only spotted indicator — 16 toggles 01/00, and both recorder
damage bursts fall inside 01 periods; the old crew/alive guess is refuted (it toggles while the recorder
survives, and only the recorder's client knows his own spotted state)], `4` (u8) [O: a 4-state mode flag
seen almost only on two Swedish vehicles — S41_Bofors_Pagod_TK105 cycles 03→00→01→02 (77 updates),
S22_Strv_S1 once (00); the old stun guess is refuted (no SPGs, no stun in results)], `36` (u8) [V: death
marker, value 0 — entity set equals the killed set, clocks within ±0.2 s of the kills].

Other properties seen but undecoded: `1` (vehicle, 1 B, toggles 00/01 ~1 Hz while driving, not
speed-correlated), `9` (avatar, 1 B, 5 states 00–04), `17` (vehicle, 4 B, 16 updates all value 0, entities
a subset of the killed set, clocks not at kills), `23` (vehicle, 4 B, one vehicle, two ~15 s nonzero
windows separated by 0).

### Counting shots: the tracer rule (#31)

**Rule: count distinct `shotId`s from `showTracer`, ignore duplicate shows.** A shot is one
`shotId`; the same `shotId` sometimes arrives in two `showTracer` calls, and counting calls
overcounts. On the fixture this resolves the old 61-vs-59 question exactly.

Evidence (fixture, `tools/probe/tracer_audit.py` reproduces it and asserts the headline counts):

- Recorder: 61 `showTracer` records, 59 distinct `shotId`s, 59 `shots` in results, 61 timeline
  shot events (the timeline emits one event per show, no dedupe — see the consequence below).
- The two duplicates are `41740511` (shown at clocks 71.46 and 71.56) and `43213023` (301.85 and
  302.05): 0.10 s and 0.20 s after the first show, inside the same burst, with different tracer
  geometry in the payload — a genuine second show, not a retransmitted packet.
- All 30 shooters: distinct `shotId`s equal results `shots` for 19 of them; the other 11 differ
  only downward (distinct < results, never above) by tracers the recorder never saw — e.g.
  PERESVET_ROSTOV61 (`usa:A171_TF_4`): 162 tracers seen vs 493 results shots. 24 duplicated
  `shotId`s in total across the fixture, every one shown exactly twice. Counting distinct
  `shotId`s therefore never overcounts against results; it undercounts only by unseen tracers.
- `shotId` structure on this fixture: successive shots step by 2048, the low 11 bits are
  constant 223 for every shooter, and the counter is global (a recorder gap of 4096+ is other
  shooters' shots interleaved). `shotId` alone is a safe dedupe key — no per-shooter scoping
  needed.
- What does **not** count shots: `stopTracer` (only 52 of the recorder's 59 shots have a stop),
  `explodeProjectile` (6 of 59 — rare, not a shot proxy), `showShooting` (0 records for the
  recorder; see its row above).

Consequence (not fixed here — #31 owns docs + probe only): timeline shot events and everything
built on them inherit the inflation. The recorder's `shootingStats` clips read
`[10, 10, 10, 10, 11, 10]` on shows but `[9, 10, 10, 10, 10, 10]` on distinct shots, and accuracy
denominators read 61 instead of 59. The follow-up is to dedupe by `shotId` where shot events
are built or consumed (the timeline builder already carries `shotId` on every shot event).

Open questions (good first issues): 0x1C/0x1D
axes; 0x20's 11.813 s pairs; 0x24 methods 02/04/05/06 and their id space; showDamageFromShot's type-01 vs
type-02 distinction and its packed hit-point bytes; method 60's two flag bytes (same flags appear for
damaging and bouncing hits, so they are not damage/bounce); 0x1A fields `[3]`/`[4]`/`[11]`; 0x26 fields
other than the direction; Vehicle prop 16's `(a, b)` states; Avatar prop 16 (8 B); props 1/9/17/23;
Vehicle method 8 (36 B); Avatar method 62 explodeProjectile (why only 113 for 761 tracers).

## 6. Version manifests (how production code must handle indices)

Indices change between client versions and between WG and Lesta. Never hard-code them in parser logic.

- `packages/defs/manifests/<realm>-<version>.json`: `{realm, version, avatar:{methodName: idx}, vehicle:{…},
  properties:{…}, arenaUpdateTypes:{…}, argLayouts:{…}}`.
- **Source of truth:** generated from the client's `scripts/entity_defs` (`.def` files + `alias.xml`) by
  `tools/defs-extract` (run locally by someone who has the client installed; the client files are never committed).
  BigWorld assigns exposed indices from the definition order including interfaces — port the algorithm documented
  by `Monstrofil/replays_unpack` ("exposed index") and verify on every fixture.
- **Fallback:** a fingerprint matcher that guesses indices for an unknown version from payload shapes
  (e.g. 9-byte vehicle method whose health deltas sum to results `damageDealt` = onHealthChanged). It produces a
  *draft* manifest flagged `confidence: "fingerprint"`; the UI shows "partially supported version".
- **Fingerprint heuristics (E1-14, `packages/defs/src/fingerprint.ts`, wired in `parseReplay` when no
  manifest resolves):** onHealthChanged = the 9-byte vehicle method whose recorder-attacker health
  deltas sum exactly to results `damageDealt`; showTracer = the 51-byte avatar method starting with a
  vehicle id; updateArena = the variable-length avatar method whose payloads decode as bwstring+pickle
  (on the fixture it decodes 25/25; every other variable-length avatar method decodes 0/25). Arena
  types come from decoded values: vehicleKilled = values that are arrays of 4+ starting with two
  vehicle ids; period = the type whose values run 1, 2, 3. The draft carries only those three methods
  plus those arena types (`vehicleProperties` empty) and is flagged `confidence: "fingerprint"`; the UI
  banner uses `parser.partialSupport`. Any heuristic failing means no draft: parsing falls back to the
  old no-manifest behavior (container meta, results, positions, camera, chat only).
- A replay with no manifest still gets: container meta, battle results, positions (0x0A is stable), camera, chat.

## 7. Safety rules for parsing

- Replay files are untrusted. Pickles are decoded with a **whitelist unpickler**: primitives, tuples, lists, dicts,
  and named globals mapped to tagged plain objects. Never evaluate, never instantiate.
- Bound every length field by the remaining buffer; a malformed replay must produce an error object, not a hang.
- Parsing runs in a Web Worker; the main thread never touches raw bytes.

## 8. Privacy facts in the data

- **Anonymizer** [V]: block 0 `vehicles[].name`/`fakeName` hold the name shown in battle; battle results
  `players[].realName` can differ (4 of 30 players in the fixture). Show and store only the in-battle name.
  `realName` must be dropped by the parser before anything leaves the Web Worker — never displayed, stored,
  indexed or uploaded. The same applies to `accountDBID` and clan ids of anonymized players (an account id
  resolves to the real name through the public API). A parser test enforces this (E1-08, #27).
- Positions of other players exist in every replay; we show them only inside that battle's viewer, never as
  cross-battle per-player tracking.

### Wargaming 0x37: kill record (V on 8 replays)
Inside the nested property-update stream of 0x37 packets: `78 01 <victim u32 LE> <killer u32 LE> <reason u8> ...`, ids are vehicle entity ids. 203/203 killer and reason values equal the results block; distinct victims equal the deaths in the results in 7 of 8 replays (one replay has 23 records for 27 deaths, the rest are filled from results). Records repeat in later packets; the earliest wins. Next to it: pickled `{'deathOrder': n}` (`0c b7 02 1a ..`), the nth death. Tundra (14 players) and Epic (60) replays have no such record (layout differs), they fall back to results. Decoder: `packages/parser/src/wgkill.ts`.
