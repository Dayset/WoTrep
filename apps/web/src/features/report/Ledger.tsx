import { useMemo } from "react";
import { goodPlaysAll, ledger } from "@wotrep/coach";
import { vehicleLabel } from "@wotrep/gamedata";
import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";

/** Sacrifice ledger for the recorder's team: who made space for teammates' good plays, and who cashed in (docs/METRICS.md §3.12). */
export function Ledger({ tl }: { tl: BattleTimeline }) {
  const rows = useMemo(() => ledger(tl, goodPlaysAll(tl)).filter((r) => r.team === tl.recorder.team).sort((a, b) => b.madeFor - a.madeFor || b.absorbedHp - a.absorbedHp || b.carried - a.carried), [tl]);
  const info = new Map(tl.vehicles.map((v) => [v.vid, v]));
  return (
    <div className="ledger" data-testid="ledger">
      <h3>{t("led.title")}</h3>
      <div className="tablewrap"><table><thead><tr><th>{t("led.player")}</th><th title={t("led.made.tip")}>{t("led.made")}</th><th>{t("led.hp")}</th><th>{t("led.died")}</th><th title={t("led.cashed.tip")}>{t("led.cashed")}</th></tr></thead>
        <tbody>{rows.map((r) => { const v = info.get(r.vid)!; return (
          <tr key={r.vid} className={v.isRecorder ? "me" : ""}><td title={vehicleLabel(v.vehicleType).label}>{v.name}</td><td>{r.madeFor}</td><td>{r.absorbedHp || "—"}</td><td>{r.diedFor || "—"}</td><td>{r.plays ? `${r.carried}/${r.plays}` : "—"}</td></tr>); })}</tbody></table></div>
      <details className="how"><summary>{t("gl.how")} · {t("gl.mean")}</summary><p>{t("gl.ledger.how")}</p><p>{t("gl.ledger.mean")}</p></details>
    </div>
  );
}
