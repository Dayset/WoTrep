import { useMemo, useState } from "react";
import { dangerSpots, type DangerSpot } from "@wotrep/coach";
import { vehicleLabel } from "@wotrep/gamedata";
import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Danger spots: where each player lost the most, why, and what not to do (docs/METRICS.md §3.15). */
export function Danger({ tl }: { tl: BattleTimeline }) {
  const [side, setSide] = useState<"own" | "enemy">("own");
  const rows = useMemo(() => {
    const all = dangerSpots(tl).filter((d) => (d.team === tl.recorder.team) === (side === "own")), best = new Map<number, DangerSpot>();
    for (const d of all) { const b = best.get(d.vid); if (!b || d.got - d.dealt > b.got - b.dealt) best.set(d.vid, d); }
    return [...best.values()].sort((a, b) => b.got - b.dealt - (a.got - a.dealt));
  }, [tl, side]);
  const info = new Map(tl.vehicles.map((v) => [v.vid, v]));
  return (
    <div className="ledger" data-testid="danger">
      <h3>{t("dg.title")}</h3>
      <div className="chips"><button type="button" aria-pressed={side === "own"} onClick={() => setSide("own")}>{t("dg.own")}</button><button type="button" aria-pressed={side === "enemy"} onClick={() => setSide("enemy")}>{t("dg.enemy")}</button></div>
      {rows.length === 0 ? <p>{t("dg.none")}</p> : (
        <div className="tablewrap"><table><thead><tr><th>{t("led.player")}</th><th>{t("dg.when")}</th><th>{t("dg.lost")}</th><th>{t("dg.cause")}</th><th>{t("dg.advice")}</th></tr></thead>
          <tbody>{rows.map((d) => { const v = info.get(d.vid)!; return (
            <tr key={d.vid} className={v.isRecorder ? "me" : ""}><td title={vehicleLabel(v.vehicleType).label}>{v.name}</td><td>{mmss(d.tStart)}</td><td>{d.got} / {d.dealt}{d.died ? " ☠" : ""}</td><td>{t(`dg.cause.${d.cause}`)}{d.cause === "alone" && d.nearestAllyM != null ? ` (${d.nearestAllyM} m)` : ""}{d.cause === "crossfire" ? ` (${d.foes.length})` : ""}</td><td>{t(`dg.do.${d.cause}`)}</td></tr>); })}</tbody></table></div>)}
      <details className="how"><summary>{t("gl.how")} · {t("gl.mean")}</summary><p>{t("gl.danger.how")}</p><p>{t("gl.danger.mean")}</p></details>
    </div>
  );
}
