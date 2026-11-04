import { useMemo } from "react";
import { movement } from "@wotrep/analysis";
import { vehicleLabel } from "@wotrep/gamedata";
import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";
import { SortTable } from "./SortTable";

const pc = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

/** Movement, exposure to several shooters, and time to first shot after a contact (docs/METRICS.md §3.16). Compare only within a team. */
export function Movement({ tl }: { tl: BattleTimeline }) {
  const m = useMemo(() => movement(tl), [tl]), info = new Map(tl.vehicles.map((v) => [v.vid, v]));
  const rows = m.players.filter((p) => p.team === tl.recorder.team).sort((a, b) => (b.multiShare ?? -1) - (a.multiShare ?? -1)), med = m.medians[tl.recorder.team as 1 | 2];
  return (
    <div className="ledger" data-testid="movement">
      <h3>{t("mv.title")}</h3>
      <SortTable sortKey="multi" cols={[{ key: "player", label: t("led.player") }, { key: "speed", label: t("mv.speed") }, { key: "still", label: t("mv.still") }, { key: "multi", label: t("mv.multi"), title: t("mv.multi.tip") }, { key: "peak", label: t("mv.peak") }, { key: "acq", label: t("mv.acq"), title: t("mv.acq.tip") }]}
          rows={rows.map((p) => { const v = info.get(p.vid)!; return { id: p.vid, cls: v.isRecorder ? "me" : "", cells: { player: { v: v.name, node: <span title={vehicleLabel(v.vehicleType).label}>{v.name}</span> }, speed: { v: p.mPerMin, node: p.mPerMin ?? "—" }, still: { v: p.stillShare, node: pc(p.stillShare) }, multi: { v: p.multiShare, node: pc(p.multiShare) }, peak: { v: p.peakHostiles, node: p.peakHostiles }, acq: { v: p.acquireS, node: p.acquireS != null ? `${p.acquireS} s` : "—" } } }; })} />
      <p className="muted">{t("mv.median")}: {med.mPerMin ?? "—"} · {pc(med.stillShare)} · {pc(med.multiShare)} · {med.acquireS != null ? `${Math.round(med.acquireS * 10) / 10} s` : "—"}</p>
      <details className="how"><summary>{t("gl.how")} · {t("gl.mean")}</summary><p>{t("gl.movement.how")}</p><p>{t("gl.movement.mean")}</p></details>
    </div>
  );
}
