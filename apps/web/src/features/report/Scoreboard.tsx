import { useState } from "react";
import type { BattleTimeline, VehicleInfo } from "@wotrep/model";
import { playerMetrics, playerStats } from "@wotrep/analysis";
import { vehicleLabel } from "@wotrep/gamedata";
import { t } from "../../i18n";

const tank = (v: VehicleInfo) => vehicleLabel(v.vehicleType).label;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

type PlayerResultLike = NonNullable<BattleTimeline["results"]>["players"][number];

/** Classic scoreboard (#58): the table players expect, one team at a time (the teams tab switches sides).
 *  Every number comes straight from battle results, so fixture numbers equal results by construction.
 *  WN8 renders "—": battle WN8 arrives with #59, and the gap stays visible instead of a guessed number. */
export function Scoreboard({ tl, team }: { tl: BattleTimeline; team: 1 | 2 }) {
  const dpm = new Map(playerMetrics(tl).map((p) => [p.vid, p.dpm]));
  const st = new Map(playerStats(tl).map((p) => [p.vid, p]));
  const pc = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: "dmg", dir: -1 });
  const val: Record<string, (v: VehicleInfo, r?: PlayerResultLike) => number | string> = {
    name: (v) => v.name.toLowerCase(), tank: (v) => tank(v), dmg: (_, r) => r?.damageDealt ?? -1, dpm: (v, r) => (r ? dpm.get(v.vid) ?? -1 : -1),
    assist: (_, r) => (r ? r.assistRadio + r.assistTrack + r.assistStun : -1), blocked: (_, r) => r?.blocked ?? -1, kills: (_, r) => r?.kills ?? -1,
    spots: (_, r) => r?.spotted ?? -1,
    shots: (_, r) => r?.shots ?? -1, acc: (v) => st.get(v.vid)?.accuracy ?? -1, pen: (v) => st.get(v.vid)?.penRate ?? -1, life: (_, r) => r?.lifeTimeS ?? -1, received: (_, r) => r?.damageReceived ?? -1,
    xp: (_, r) => r?.xp ?? -1, wn8: () => -1,
  };
  const rows = tl.vehicles.filter((v) => v.team === team).map((v) => ({ v, r: tl.results?.players[v.vid] })).sort((a, b) => {
    const x = val[sort.k]!(a.v, a.r), y = val[sort.k]!(b.v, b.r); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
  return (
    <div className="tablewrap tall" data-testid={`team${team}`}><table>
      <thead><tr>{["name", "tank", "dmg", "dpm", "assist", "blocked", "kills", "spots", "shots", "acc", "pen", "life", "received", "xp", "wn8"].map((c) => <th key={c} aria-sort={sort.k === c ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button type="button" className="sortbtn" onClick={() => setSort({ k: c, dir: sort.k === c ? (sort.dir === 1 ? -1 : 1) : c === "name" || c === "tank" ? 1 : -1 })}>{t(`col.${c}`)}{sort.k === c ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</button></th>)}</tr></thead>
      <tbody>{rows.map(({ v, r }) => (
        <tr key={v.vid} className={v.isRecorder ? "me" : ""}>
          <td className="nm">{v.name}</td><td className="tk">{tank(v)}</td>
          <td>{r?.damageDealt ?? "—"}</td><td>{r ? dpm.get(v.vid) : "—"}</td><td>{r ? r.assistRadio + r.assistTrack + r.assistStun : "—"}</td><td>{r?.blocked ?? "—"}</td>
          <td>{r?.kills ?? "—"}</td><td>{r?.spotted ?? "—"}</td><td>{r ? `${r.shots} / ${r.hits} / ${r.pens}` : "—"}</td><td>{pc(st.get(v.vid)?.accuracy)}</td><td>{pc(st.get(v.vid)?.penRate)}</td><td title={pc(st.get(v.vid)?.lifeShare)}>{r ? mmss(r.lifeTimeS) : "—"}</td><td>{r?.damageReceived ?? "—"}</td><td>{r?.xp ?? "—"}</td><td>—</td>
        </tr>))}</tbody>
    </table></div>
  );
}
