import { useMemo } from "react";
import { goodPlaysAll, ledger } from "@wotrep/coach";
import { vehicleLabel } from "@wotrep/gamedata";
import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";
import { SortTable } from "./SortTable";

/** Sacrifice ledger for one team: who made space for teammates' good plays, and who cashed in (docs/METRICS.md §3.12). The stats page renders both teams. */
export function Ledger({ tl, team }: { tl: BattleTimeline; team: 1 | 2 }) {
  const rows = useMemo(() => ledger(tl, goodPlaysAll(tl)).filter((r) => r.team === team).sort((a, b) => b.madeFor - a.madeFor || b.absorbedHp - a.absorbedHp || b.carried - a.carried), [tl, team]);
  const info = new Map(tl.vehicles.map((v) => [v.vid, v]));
  const side = team === tl.recorder.team ? t("report.allies") : t("report.enemies");
  return (
    <div className="ledger" data-testid={`ledger-${team === tl.recorder.team ? "own" : "enemy"}`}>
      <h3>{t("led.title")} · {side}</h3>
      <SortTable sortKey="made" cols={[{ key: "name", label: t("led.player"), name: true }, { key: "made", label: t("led.made"), title: t("led.made.tip") }, { key: "hp", label: t("led.hp") }, { key: "died", label: t("led.died") }, { key: "cashed", label: t("led.cashed"), title: t("led.cashed.tip") }]}
          rows={rows.map((r) => { const v = info.get(r.vid)!; return { id: r.vid, cls: v.isRecorder ? "me" : "", side: v.team === tl.recorder.team ? "ally" : "foe", cells: { name: { v: v.name, node: <span title={vehicleLabel(v.vehicleType).label}>{v.name}</span> }, made: { v: r.madeFor, node: r.madeFor }, hp: { v: r.absorbedHp, node: r.absorbedHp || "—" }, died: { v: r.diedFor, node: r.diedFor || "—" }, cashed: { v: r.plays ? r.carried / r.plays : null, node: r.plays ? `${r.carried}/${r.plays}` : "—" } } }; })} />
      <details className="how"><summary>{t("gl.how")} · {t("gl.mean")}</summary><p>{t("gl.ledger.how")}</p><p>{t("gl.ledger.mean")}</p></details>
    </div>
  );
}
