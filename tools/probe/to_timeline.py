#!/usr/bin/env python3
"""Replay -> BattleTimeline v1 (docs/contracts/battle-timeline.md). Mock producer until packages/parser lands.
Usage: python3 -I tools/probe/to_timeline.py <replay> <out.json>"""
import hashlib, json, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wotrep_probe as P

def main(path, out):
    blocks, _ = P.read_container(path)
    with tempfile.TemporaryDirectory() as tmp:
        P.main(path, tmp)
        tl = json.load(open(f"{tmp}/timeline.json")); meta = json.load(open(f"{tmp}/meta.json"))
    b0, res = blocks[0], (blocks[1] if len(blocks) > 1 else None)
    T0, rec = tl["battleStartClock"], tl["recorderVehicle"]
    r = lambda v, n=2: round(v, n)
    vehicles, anon = [], {}
    realnames = {}
    if res:
        for k, p in res[0]["players"].items():
            realnames[k] = p["realName"]
    for k, v in b0["vehicles"].items():
        # anonymizer: results realName differs from the in-battle name, matched by player name order
        vehicles.append({"vid": int(k), "team": v["team"], "name": v["name"], "anonymized": False,
                         "vehicleType": v["vehicleType"], "maxHealth": v["maxHealth"], "isRecorder": int(k) == rec})
    # players{} in results is keyed by accountDBID; map via vehicles[...][0].accountDBID -> avatarSessionId
    anon_vids = set()
    if res:
        for sid, lst in res[0]["vehicles"].items():
            acc = str(lst[0]["accountDBID"]); pl = res[0]["players"].get(acc)
            if pl and pl["realName"] != pl["name"]: anon_vids.add(int(sid))
    for v in vehicles:
        if v["vid"] in anon_vids: v["anonymized"] = True
    tracks = {}
    for k, l in tl["positions"].items():
        t = [r(c[0] - T0) for c in l]
        vis, s, prev = [], t[0], t[0]
        for x in t[1:]:
            if x - prev > 1.5: vis.append([s, prev]); s = x
            prev = x
        vis.append([s, prev])
        tracks[k] = {"t": t, "x": [c[1] for c in l], "z": [c[2] for c in l], "y": [c[3] for c in l],
                     "yaw": [c[4] for c in l], "visible": vis}
    ev = []
    ev.append({"k": "period", "t": 0, "period": 3, "lengthS": 900})
    for h in tl["health"]:
        ev.append({"k": "damage", "t": r(h["clock"] - T0), "target": h["vehicle"], "attacker": h["attacker"],
                   "amount": h["old"] - max(h["new"], 0), "hpBefore": h["old"], "hpAfter": max(h["new"], 0), "reason": h["reason"]})
    for k in tl["kills"]:
        ev.append({"k": "kill", "t": r(k["clock"] - T0), "victim": k["victim"], "killer": k["killer"], "reason": k["reason"], "equipment": k["equipment"]})
    for s in tl["tracers"]:
        ev.append({"k": "shot", "t": r(s["clock"] - T0), "shooter": s["shooter"], "shotId": s["shot"]})
    ev.sort(key=lambda e: e["t"])
    out_tl = {
        "schema": "wotrep.timeline/1",
        "source": {"realm": "lesta" if path.endswith(".mtreplay") else "wg", "regionCode": b0["regionCode"], "server": b0["serverName"],
                   "clientVersion": b0["clientVersionFromExe"], "manifest": {"id": "lesta-1.46.0.0", "confidence": "defs"},
                   "fileName": os.path.basename(path), "hasMods": b0["hasMods"], "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest()},
        "arena": {"arenaUniqueId": str(b0["arenaUniqueID"]), "map": b0["mapName"], "mapDisplayName": b0["mapDisplayName"],
                  "gameplay": b0["gameplayID"], "battleType": b0["battleType"], "startedAt": b0["dateTime"],
                  "durationS": res[0]["common"]["duration"] if res else None, "winnerTeam": res[0]["common"]["winnerTeam"] if res else None,
                  "finishReason": res[0]["common"]["finishReason"] if res else None, "battleStartClock": T0},
        "recorder": {"vid": rec, "team": next(v["team"] for v in vehicles if v["isRecorder"]), "name": b0["playerName"]},
        "vehicles": vehicles, "tracks": tracks, "events": ev,
        "camera": {"t": [r(c["clock"] - T0) for c in tl["camera"]], "mode": [c["mode"] for c in tl["camera"]]},
        "diagnostics": {"unknownPacketTypes": {}, "warnings": ["mock built by tools/probe/to_timeline.py"]},
    }
    if res:
        out_tl["results"] = {"players": {}}
        for sid, lst in res[0]["vehicles"].items():
            v = lst[0]
            out_tl["results"]["players"][sid] = {"damageDealt": v["damageDealt"], "assistRadio": v["damageAssistedRadio"], "assistTrack": v["damageAssistedTrack"],
                "assistStun": v.get("damageAssistedStun", 0), "blocked": v["damageBlockedByArmor"], "kills": v["kills"], "spotted": v["spotted"], "shots": v["shots"],
                "hits": v["directEnemyHits"], "pens": v["piercingEnemyHits"], "damageReceived": v["damageReceived"], "lifeTimeS": v["lifeTime"],
                "deathReason": v["deathReason"], "killerVid": v["killerID"] or None, "mileageM": v["mileage"], "xp": v["xp"],
                "capturePoints": v.get("capturePoints", 0), "droppedCapturePoints": v.get("droppedCapturePoints", 0)}
    json.dump(out_tl, open(out, "w"), separators=(",", ":"), ensure_ascii=False)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
