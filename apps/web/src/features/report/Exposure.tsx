import { useMemo } from "react";
import { vehicleLabel } from "@wotrep/gamedata";
import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";
import { SortTable } from "./SortTable";
import { exposure } from "./exposure";

const pc = (x: number, alive: number) => (alive === 0 ? "—" : `${Math.round((x / alive) * 100)}%`);

/** Fire exposure per player (docs/METRICS.md §3.22): how long each player was exposed to a ghost
 *  (red threat ring) or an actual enemy available to shoot, split solo vs shared with the team.
 *  Compare only within a team; the stats page renders both teams. */
export function Exposure({ tl, team }: { tl: BattleTimeline; team: 1 | 2 }) {
  const ex = useMemo(() => exposure(tl), [tl]), info = new Map(tl.vehicles.map((v) => [v.vid, v]));
  const rows = ex.teams[team].players, side = team === tl.recorder.team ? t("report.allies") : t("report.enemies");
  const tm = ex.teams[team];
  return (
    <div className="ledger" data-testid={`exposure-${team === tl.recorder.team ? "own" : "enemy"}`}>
      <h3>{t("ex.title")} · {side}</h3>
      <SortTable sortKey="exposed" cols={[{ key: "player", label: t("led.player"), name: true }, { key: "exposed", label: t("ex.exposed"), title: t("ex.exposed.tip") }, { key: "ghost", label: t("ex.ghost"), title: t("ex.ghost.tip") }, { key: "live", label: t("ex.live"), title: t("ex.live.tip") }, { key: "now", label: t("ex.now"), title: t("ex.now.tip") }, { key: "solo", label: t("ex.solo"), title: t("ex.solo.tip") }, { key: "shared", label: t("ex.shared"), title: t("ex.shared.tip") }]}
          rows={rows.map((p) => { const v = info.get(p.vid)!; return { id: p.vid, cls: v.isRecorder ? "me" : "", side: v.team === tl.recorder.team ? "ally" : "foe", cells: { player: { v: v.name, node: <span title={vehicleLabel(v.vehicleType).label}>{v.name}</span> }, exposed: { v: p.exposedS, node: `${p.exposedS} s (${pc(p.exposedS, p.aliveS)})` }, ghost: { v: p.ghostS, node: `${p.ghostS} s` }, live: { v: p.liveS, node: `${p.liveS} s` }, now: { v: p.nowS, node: `${p.nowS} s` }, solo: { v: p.soloS, node: `${p.soloS} s` }, shared: { v: p.sharedS, node: `${p.sharedS} s` } } }; })} />
      <p className="muted">{t("ex.total")}: {tm.sumExposed} s · {t("ex.union")}: {tm.unionExposed} s · {t("ex.now")}: {tm.sumNow} s · {t("ex.union")}: {tm.unionNow} s · {t("ex.avg")}: {pc(tm.sumExposed, tm.sumAlive)}</p>
      <details className="how"><summary>{t("gl.how")} · {t("gl.mean")}</summary><p>{t("gl.exposure.how")}</p><p>{t("gl.exposure.mean")}</p></details>
    </div>
  );
}
