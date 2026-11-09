import { useMemo } from "react";
import { dangerSpots, type DangerSpot } from "@wotrep/coach";
import { vehicleLabel } from "@wotrep/gamedata";
import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";
import { SortTable } from "./SortTable";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Danger spots for one team: where each player lost the most, why, and what not to do (docs/METRICS.md §3.15). The stats page renders both teams. */
export function Danger({ tl, team }: { tl: BattleTimeline; team: 1 | 2 }) {
  const rows = useMemo(() => {
    const all = dangerSpots(tl).filter((d) => d.team === team), best = new Map<number, DangerSpot>();
    for (const d of all) { const b = best.get(d.vid); if (!b || d.got - d.dealt > b.got - b.dealt) best.set(d.vid, d); }
    return [...best.values()].sort((a, b) => b.got - b.dealt - (a.got - a.dealt));
  }, [tl, team]);
  const info = new Map(tl.vehicles.map((v) => [v.vid, v]));
  const side = team === tl.recorder.team ? t("report.allies") : t("report.enemies");
  return (
    <div className="ledger" data-testid={`danger-${team === tl.recorder.team ? "own" : "enemy"}`}>
      <h3>{t("dg.title")} · {side}</h3>
      {rows.length === 0 ? <p>{t("dg.none")}</p> : (
        <SortTable sortKey="lost" cols={[{ key: "player", label: t("led.player"), name: true }, { key: "when", label: t("dg.when") }, { key: "lost", label: t("dg.lost") }, { key: "cause", label: t("dg.cause") }, { key: "advice", label: t("dg.advice") }]}
          rows={rows.map((d) => { const v = info.get(d.vid)!; const cause = t(`dg.cause.${d.cause}`); return { id: `${d.vid}-${d.tStart}`, cls: v.isRecorder ? "me" : "", side: v.team === tl.recorder.team ? "ally" : "foe", cells: { player: { v: v.name, node: <span title={vehicleLabel(v.vehicleType).label}>{v.name}</span> }, when: { v: d.tStart, node: mmss(d.tStart) }, lost: { v: d.got - d.dealt, node: `${d.got} / ${d.dealt}${d.died ? " ☠" : ""}` }, cause: { v: cause, node: `${cause}${d.cause === "alone" && d.nearestAllyM != null ? ` (${d.nearestAllyM} m)` : ""}${d.cause === "crossfire" ? ` (${d.foes.length})` : ""}` }, advice: { v: t(`dg.do.${d.cause}`), node: t(`dg.do.${d.cause}`) } } }; })} />)}
      <details className="how"><summary>{t("gl.how")} · {t("gl.mean")}</summary><p>{t("gl.danger.how")}</p><p>{t("gl.danger.mean")}</p></details>
    </div>
  );
}
