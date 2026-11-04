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
| 0x1A | 3,613 | Recorder vehicle / camera: 15 × f32 — position (3), ?, position (3), aim direction (3), … | O |
| 0x1B | 46 | Camera mode string: `arcade`, `sniper`, `strategic`… | V |
| 0x1C / 0x1D | 3,085 / 2,491 | 1 × f32 each, ~10 Hz — likely gun/turret control axes | ? |
| 0x20 | 15 | 2 × f32 | ? |
| 0x23 | 4 | Chat message, HTML (`<font color=…>Name[CLAN] (Tank)&nbsp;: </font>text`) | V |
| 0x24 | 955 | Small per-entity records (11–19 B) | ? |
| 0x26 | 3,491 | 10 × f32 — camera/aim state | ? |
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
| 60 | onBattleEvents (personal events: damage/spot/assist) | list | ? |
| 73 | quest progress (`regular_4_3_13`…) | pickle | O |

`updateArena` types seen: `3` period `(period, endTime, length, …)` — **period 3 = battle start**, fixture
clock 33.26 s; `5` vehicle status; `6` **vehicle killed** `(victimId, killerId, equipmentId, reason, n)` [V, 24 kills
match results]; `7` avatar ready; `8` base/team info; `4` vehicle list; `24`, `26`, `30` config.

**Vehicle** (entity id = avatarSessionId = keys of block 0 `vehicles`):

| idx | method | args | conf |
|---|---|---|---|
| 3 | onHealthChanged | `i16 newHealth, i16 oldHealth, u32 attackerId, u8 attackReason` | V — recorder's 28 events sum to 1,362 = results `damageDealt` |
| 1 | showShooting | `u8 burstCount, u8 gunIndex` | O |
| 10 | showDamageFromShot | `u32 attackerId, …` (16 B) | ? |
| 8 | (collision / ramming?) | 36 B | ? |

Vehicle properties: `15` health (i16, 429 updates = 429 health calls) [O], `14` gun angles packed (u16) [?],
`16` (u16) [?], `6` crew/alive flag [?], `4` stun/state [?].

Open questions (good first issues): recorder has **61** `showTracer` vs **59** `shots` in results; meaning of
0x1C/0x1D/0x20/0x24/0x26; showDamageFromShot payload (hit points → armour-hit markers); spotting events.

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
