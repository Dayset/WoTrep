import { useMemo } from "react";
import { movement } from "@wotrep/analysis";
import { vehicleLabel } from "@wotrep/gamedata";
import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";

const pc = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

/** Movement, exposure to several shooters, and time to first shot after a contact (docs/METRICS.md §3.16). Compare only within a team. */
export function Movement({ tl }: { tl: BattleTimeline }) {
  const m = useMemo(() => movement(tl), [tl]), info = new Map(tl.vehicles.map((v) => [v.vid, v]));
  const rows = m.players.filter((p) => p.team === tl.recorder.team).sort((a, b) => (b.multiShare ?? -1) - (a.multiShare ?? -1)), med = m.medians[tl.recorder.team as 1 | 2];
  return (
    <div className="ledger" data-testid="movement">
      <h3>{t("mv.title")}</h3>
      <div className="tablewrap"><table><thead><tr><th>{t("led.player")}</th><th>{t("mv.speed")}</th><th>{t("mv.still")}</th><th title={t("mv.multi.tip")}>{t("mv.multi")}</th><th>{t("mv.peak")}</th><th title={t("mv.acq.tip")}>{t("mv.acq")}</th></tr></thead>
        <tbody>{rows.map((p) => { const v = info.get(p.vid)!; return (
          <tr key={p.vid} className={v.isRecorder ? "me" : ""}><td title={vehicleLabel(v.vehicleType).label}>{v.name}</td><td>{p.mPerMin ?? "—"}</td><td>{pc(p.stillShare)}</td><td>{pc(p.multiShare)}</td><td>{p.peakHostiles}</td><td>{p.acquireS != null ? `${p.acquireS} s` : "—"}</td></tr>); })}
          <tr className="muted"><td>{t("mv.median")}</td><td>{med.mPerMin ?? "—"}</td><td>{pc(med.stillShare)}</td><td>{pc(med.multiShare)}</td><td>—</td><td>{med.acquireS != null ? `${Math.round(med.acquireS * 10) / 10} s` : "—"}</td></tr></tbody></table></div>
      <details className="how"><summary>{t("gl.how")} · {t("gl.mean")}</summary><p>{t("gl.movement.how")}</p><p>{t("gl.movement.mean")}</p></details>
    </div>
  );
}
