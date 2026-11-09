import type { BattleTimeline, VehicleInfo } from "@wotrep/model";
import { playerMetrics, playerStats } from "@wotrep/analysis";
import { vehicleLabel } from "@wotrep/gamedata";
import { t } from "../../i18n";
import { SortTable } from "./SortTable";

const tank = (v: VehicleInfo) => vehicleLabel(v.vehicleType).label;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Classic scoreboard (#58): the table players expect, one team at a time (the stats page renders both sides).
 *  Every number comes straight from battle results, so fixture numbers equal results by construction.
 *  WN8 renders "—": battle WN8 arrives with #59, and the gap stays visible instead of a guessed number. */
export function Scoreboard({ tl, team }: { tl: BattleTimeline; team: 1 | 2 }) {
  const dpm = new Map(playerMetrics(tl).map((p) => [p.vid, p.dpm]));
  const st = new Map(playerStats(tl).map((p) => [p.vid, p]));
  const pc = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  const rows = tl.vehicles.filter((v) => v.team === team).map((v) => ({ v, r: tl.results?.players[v.vid] }));
  const side = team === tl.recorder.team ? t("report.allies") : t("report.enemies");
  return (
    <><h3>{t("ui.t.score")} · {side}</h3>
      <SortTable sortKey="dmg" wrapClass="tall" testId={`team${team}`}
        cols={["name", "tank", "dmg", "dpm", "assist", "blocked", "kills", "spots", "shots", "acc", "pen", "life", "received", "xp", "wn8"].map((c) => ({ key: c, label: t(`col.${c}`), name: c === "name" }))}
        rows={rows.map(({ v, r }) => ({ id: v.vid, cls: v.isRecorder ? "me" : "", cells: {
          name: { v: v.name.toLowerCase(), node: v.name }, tank: { v: tank(v), node: tank(v) },
          dmg: { v: r?.damageDealt ?? null, node: r?.damageDealt ?? "—" }, dpm: { v: r ? dpm.get(v.vid) ?? null : null, node: r ? dpm.get(v.vid) ?? "—" : "—" },
          assist: { v: r ? r.assistRadio + r.assistTrack + r.assistStun : null, node: r ? r.assistRadio + r.assistTrack + r.assistStun : "—" },
          blocked: { v: r?.blocked ?? null, node: r?.blocked ?? "—" }, kills: { v: r?.kills ?? null, node: r?.kills ?? "—" }, spots: { v: r?.spotted ?? null, node: r?.spotted ?? "—" },
          shots: { v: r?.shots ?? null, node: r ? `${r.shots} / ${r.hits} / ${r.pens}` : "—" },
          acc: { v: st.get(v.vid)?.accuracy ?? null, node: pc(st.get(v.vid)?.accuracy) }, pen: { v: st.get(v.vid)?.penRate ?? null, node: pc(st.get(v.vid)?.penRate) },
          life: { v: r?.lifeTimeS ?? null, node: r ? <span title={pc(st.get(v.vid)?.lifeShare)}>{mmss(r.lifeTimeS)}</span> : "—" },
          received: { v: r?.damageReceived ?? null, node: r?.damageReceived ?? "—" }, xp: { v: r?.xp ?? null, node: r?.xp ?? "—" }, wn8: { v: null, node: "—" } } }))} />
    </>
  );
}
