#!/usr/bin/env python3
"""Audit tracer/showTracer accounting for issue #31 (E1-12).

Reads the raw replay with wotrep_probe's packet walk (no changes to the
probe or to_timeline.py) and reports, per shooter:

- showTracer (Avatar method 38) records and DISTINCT shotIds
- duplicate shotIds (same shotId shown twice) with their clocks
- stopTracer (method 30) and explodeProj (method 62) records per shotId
- showShooting (Vehicle method 1) burstCount values per vehicle

plus the timeline fixture's shot events and the results shots, so the
61-tracers-vs-59-shots gap can be checked from one run.

Usage: python3 tools/probe/tracer_audit.py <replay> [timeline.json]
Exits nonzero if the headline counts do not reproduce.
"""

import json
import struct
import sys
from collections import Counter, defaultdict

sys.path.insert(0, __file__.rsplit("/", 2)[0])
import wotrep_probe as probe

AV_SHOW_TRACER = 38
AV_STOP_TRACER = 30
AV_EXPLODE_PROJ = 62
VEH_SHOW_SHOOTING = 1


def main(replay, timeline_path):
    blocks, data = probe.read_container(replay)
    b0 = blocks[0]
    meta = {int(k): v for k, v in b0["vehicles"].items()}
    avatar_id = own_vid = None
    shows, stops, explodes, shooting = [], [], [], []
    for typ, clk, p in probe.packets(data):
        if typ == 0x0A:
            eid, attached = struct.unpack("<II", p[:8])
            if attached:
                avatar_id, own_vid = eid, attached
        elif typ == 0x08:
            eid, mid, ln = struct.unpack("<III", p[:12])
            a = p[12:12 + ln]
            if eid == avatar_id and mid == AV_SHOW_TRACER:
                shows.append({"clock": round(clk, 2),
                              "shooter": struct.unpack("<I", a[:4])[0],
                              "shot": struct.unpack("<I", a[4:8])[0],
                              "payload": a.hex()})
            elif eid == avatar_id and mid == AV_STOP_TRACER:
                stops.append({"clock": round(clk, 2),
                              "shot": struct.unpack("<I", a[:4])[0]})
            elif eid == avatar_id and mid == AV_EXPLODE_PROJ:
                explodes.append({"clock": round(clk, 2),
                                 "shot": struct.unpack("<I", a[:4])[0]})
            elif eid in meta and mid == VEH_SHOW_SHOOTING:
                shooting.append({"clock": round(clk, 2), "vehicle": eid,
                                 "burstCount": a[0] if len(a) > 0 else None,
                                 "gunIndex": a[1] if len(a) > 1 else None})

    tl = json.load(open(timeline_path))
    tl_shots = Counter(e["shooter"] for e in tl["events"] if e["k"] == "shot")
    results = {int(k): v["shots"] for k, v in tl["results"]["players"].items()}
    names = {v["vid"]: v["name"] for v in tl["vehicles"]}

    by_shooter = defaultdict(list)
    for s in shows:
        by_shooter[s["shooter"]].append(s)
    out = {"recorder": own_vid, "shooters": {}}
    for vid, lst in sorted(by_shooter.items()):
        ids = [s["shot"] for s in lst]
        dups = {x: [s["clock"] for s in lst if s["shot"] == x]
                for x, n in Counter(ids).items() if n > 1}
        out["shooters"][vid] = {
            "name": names.get(vid),
            "showTracer": len(lst),
            "uniqueShotIds": len(set(ids)),
            "duplicates": dups,
            "residueMod2048": sorted({s % 2048 for s in ids}),
            "timelineShots": tl_shots.get(vid, 0),
            "resultsShots": results.get(vid),
        }
    stop_by_shot = Counter(s["shot"] for s in stops)
    out["stopTracer"] = {"total": len(stops),
                         "recorderShotsWithStop": sum(1 for s in by_shooter[own_vid]
                                                      if stop_by_shot[s["shot"]] > 0)}
    out["explodeProj"] = {"total": len(explodes),
                          "recorderShotsWithExplode": sum(1 for s in by_shooter[own_vid]
                                                          if s["shot"] in {e["shot"] for e in explodes})}
    out["showShooting"] = {"total": len(shooting),
                           "recorder": sum(1 for s in shooting if s["vehicle"] == own_vid),
                           "burstCounts": Counter(s["burstCount"] for s in shooting)}
    print(json.dumps(out, indent=1, default=str))

    rec = out["shooters"][own_vid]
    assert rec["showTracer"] == 61, rec
    assert rec["uniqueShotIds"] == 59, rec
    assert rec["resultsShots"] == 59, rec
    assert rec["timelineShots"] == 61, rec
    print("OK: recorder 61 showTracer records, 59 unique shotIds, 59 results shots, 61 timeline shots")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
