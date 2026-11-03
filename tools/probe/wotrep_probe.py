#!/usr/bin/env python3
"""WoTrep reference probe (NOT production code).

Reads a .wotreplay / .mtreplay file and writes what we can already decode:
  meta.json        block 0 (arena info) + block 1 (battle results) when present
  histogram.json   packet type counts / sizes
  timeline.json    positions, kills, health changes, tracers, camera modes, chat
  expected.json    golden values used by the TypeScript parser tests (packages/parser)

It exists so parser agents have a working oracle to diff against.
Method / property indices below were identified on Mir Tankov (Lesta) 1.46.0.0 #2308
by shape + cross-checking against battle results. They are NOT stable across versions:
production code must take them from a version manifest (see docs/REPLAY_FORMAT.md).

Usage: python3 -I tools/probe/wotrep_probe.py <replay> <out_dir>
Needs: python 3.10+, `cryptography` (pip install cryptography).
"""
import collections
import io
import json
import os
import pickle
import struct
import sys
import warnings
import zlib

warnings.filterwarnings("ignore")
try:
    from cryptography.hazmat.decrepit.ciphers.algorithms import Blowfish
except ImportError:  # older cryptography
    from cryptography.hazmat.primitives.ciphers.algorithms import Blowfish
from cryptography.hazmat.primitives.ciphers import Cipher, modes

MAGIC = 0x11343212
KEY = bytes.fromhex("DE72BEA0DE04BEB1DEFEBEEFDEADBEEF")

# ---- Lesta 1.46.0.0 indices (probe-verified, see docs/REPLAY_FORMAT.md §5) ----
AV_STOP_TRACER = 30      # u32 shotId, f32[3] endPoint            (16 B)
AV_SHOW_TRACER = 38      # u32 shooterVehicleId, u32 shotId, ...  (51 B)
AV_EXPLODE_PROJ = 62     # u32 shotId, ...                        (31 B)
AV_UPDATE_ARENA = 66     # u8 updateType, BW string (pickle, maybe zlib)
VEH_SHOW_SHOOTING = 1    # u8 burstCount, u8 gunIndex             (2 B)
VEH_HEALTH_CHANGED = 3   # i16 newHealth, i16 oldHealth, u32 attackerId, u8 attackReason (9 B)

ARENA_PERIOD = 3         # (period, endTime, length, extra)  period 3 = BATTLE
ARENA_VEHICLE_KILLED = 6 # (victimId, killerId, equipmentId, reason, numAffected)


class _SafeUnpickler(pickle.Unpickler):
    """Never instantiate classes from replay data: return a tagged tuple instead."""

    def find_class(self, module, name):
        return lambda *a, **k: ("__obj__", module, name, a)


def unpickle(b):
    return _SafeUnpickler(io.BytesIO(b), encoding="latin1").load()


def bw_string(a, off=0):
    """BigWorld string: u8 length, or 0xFF + u24 length."""
    if a[off] == 0xFF:
        n = int.from_bytes(a[off + 1:off + 4], "little")
        return a[off + 4:off + 4 + n]
    n = a[off]
    return a[off + 1:off + 1 + n]


def read_container(path):
    d = open(path, "rb").read()
    magic, n = struct.unpack("<II", d[:8])
    if magic != MAGIC:
        raise ValueError(f"bad magic {magic:#x}")
    off, blocks = 8, []
    for _ in range(n):
        ln = struct.unpack("<I", d[off:off + 4])[0]
        off += 4
        blocks.append(json.loads(d[off:off + ln]))
        off += ln
    dec_size, comp_size = struct.unpack("<II", d[off:off + 8])
    off += 8
    enc = d[off:]
    c = Cipher(Blowfish(KEY), modes.ECB()).decryptor()
    raw = c.update(enc[: len(enc) // 8 * 8]) + c.finalize()
    out, prev = bytearray(), bytes(8)
    for i in range(0, len(raw), 8):
        b = raw[i:i + 8]
        if i:
            b = bytes(x ^ y for x, y in zip(b, prev))
        prev = b
        out += b
    data = zlib.decompress(bytes(out[:comp_size]))
    assert len(data) == dec_size, (len(data), dec_size)
    return blocks, data


def packets(data):
    off = 0
    while off + 12 <= len(data):
        ln, typ, clk = struct.unpack("<IIf", data[off:off + 12])
        yield typ, clk, data[off + 12:off + 12 + ln]
        off += 12 + ln


def main(path, out):
    os.makedirs(out, exist_ok=True)
    blocks, data = read_container(path)
    b0 = blocks[0]
    meta = {int(k): v for k, v in b0["vehicles"].items()}

    hist = collections.Counter()
    sizes = collections.defaultdict(list)
    avatar_id = own_vid = None
    pos = collections.defaultdict(list)
    kills, hp, tracers, shooting, cams, chat, version = [], [], [], [], [], [], None
    t0 = None

    for typ, clk, p in packets(data):
        hist[typ] += 1
        sizes[typ].append(len(p))
        if typ == 0x18:
            version = bw_len_str(p)
        elif typ == 0x0A:
            eid, attached = struct.unpack("<II", p[:8])
            f = struct.unpack("<9f", p[8:44])
            if attached:  # the Avatar entity carries the recorder's vehicle id here
                avatar_id, own_vid = eid, attached
            elif eid in meta:
                pos[eid].append([round(clk, 2), round(f[0], 2), round(f[2], 2), round(f[1], 2), round(f[6], 3)])
        elif typ == 0x08:
            eid, mid, ln = struct.unpack("<III", p[:12])
            a = p[12:12 + ln]
            if eid == avatar_id and mid == AV_UPDATE_ARENA:
                ut = a[0]
                s = bw_string(a, 1)
                if s[:1] == b"x":
                    s = zlib.decompress(s)
                v = unpickle(s)
                if ut == ARENA_PERIOD and v[0] == 3 and t0 is None:
                    t0 = clk
                if ut == ARENA_VEHICLE_KILLED:
                    kills.append({"clock": round(clk, 2), "victim": v[0], "killer": v[1], "equipment": v[2], "reason": v[3]})
            elif eid == avatar_id and mid == AV_SHOW_TRACER:
                tracers.append({"clock": round(clk, 2), "shooter": struct.unpack("<I", a[:4])[0], "shot": struct.unpack("<I", a[4:8])[0]})
            elif eid in meta and mid == VEH_HEALTH_CHANGED:
                nh, oh, att, rs = struct.unpack("<hhIB", a[:9])
                hp.append({"clock": round(clk, 2), "vehicle": eid, "old": oh, "new": nh, "attacker": att, "reason": rs})
            elif eid in meta and mid == VEH_SHOW_SHOOTING:
                shooting.append({"clock": round(clk, 2), "vehicle": eid})
        elif typ == 0x1B:
            cams.append({"clock": round(clk, 2), "mode": bw_len_str(p)})
        elif typ == 0x23:
            chat.append({"clock": round(clk, 2), "html": p[4:].decode("utf8", "ignore").rstrip("\x00")})

    results = blocks[1] if len(blocks) > 1 else None
    json.dump({"block0": b0, "block1": results}, open(f"{out}/meta.json", "w"), ensure_ascii=False)
    json.dump({f"{t:#04x}": {"n": c, "min": min(sizes[t]), "max": max(sizes[t])} for t, c in sorted(hist.items())},
              open(f"{out}/histogram.json", "w"), indent=1)
    timeline = {"battleStartClock": t0, "avatarEntity": avatar_id, "recorderVehicle": own_vid,
                "vehicles": {str(k): {"name": v["name"], "fakeName": v.get("fakeName"), "type": v["vehicleType"],
                                      "team": v["team"], "maxHealth": v["maxHealth"]} for k, v in meta.items()},
                "positions": {str(k): l for k, l in pos.items()}, "kills": kills, "health": hp,
                "tracers": tracers, "shooting": shooting, "camera": cams, "chat": chat}
    json.dump(timeline, open(f"{out}/timeline.json", "w"), ensure_ascii=False)

    mine_dealt = [h for h in hp if h["attacker"] == own_vid and h["vehicle"] != own_vid]
    expected = {
        "_about": "Golden values for packages/parser tests. Produced by tools/probe/wotrep_probe.py. "
                  "Do not hand-edit; regenerate and explain any change in the PR.",
        "clientVersion": version,
        "realm": b0.get("regionCode"),
        "map": b0.get("mapName"),
        "gameplayID": b0.get("gameplayID"),
        "recorder": {"name": b0.get("playerName"), "vehicleId": own_vid, "avatarEntity": avatar_id},
        "packetCount": sum(hist.values()),
        "packetTypeCounts": {f"{t:#04x}": c for t, c in sorted(hist.items())},
        "battleStartClock": t0,
        "battleDurationResults": results[0]["common"]["duration"] if results else None,
        "winnerTeam": results[0]["common"]["winnerTeam"] if results else None,
        "kills": kills,
        "recorderDamageDealtEvents": len(mine_dealt),
        "recorderDamageDealtSum": sum(h["old"] - max(h["new"], 0) for h in mine_dealt),
        "recorderDamageReceivedEvents": [h for h in hp if h["vehicle"] == own_vid],
        "recorderTracers": sum(1 for t in tracers if t["shooter"] == own_vid),
        "cameraModeChanges": len(cams),
        "positionSamplesPerVehicle": {str(k): len(l) for k, l in sorted(pos.items())},
    }
    if results:
        personal = [v for k, v in results[0]["personal"].items() if k != "avatar"][0]
        expected["resultsCrossCheck"] = {k: personal[k] for k in
                                        ("damageDealt", "shots", "directEnemyHits", "piercingEnemyHits",
                                         "damageReceived", "kills", "damageAssistedRadio", "damageAssistedTrack")}
    json.dump(expected, open(f"{out}/expected.json", "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: expected[k] for k in ("clientVersion", "realm", "map", "packetCount", "battleStartClock",
                                               "recorderDamageDealtSum", "recorderTracers")}, ensure_ascii=False))
    if results:
        print("results:", expected["resultsCrossCheck"])


def bw_len_str(p):
    n = struct.unpack("<I", p[:4])[0]
    return p[4:4 + n].decode("utf8", "ignore")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
