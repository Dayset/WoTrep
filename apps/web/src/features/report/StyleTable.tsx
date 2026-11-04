import { useMemo } from "react";
import type { BattleTimeline } from "@wotrep/model";
import { styleAll, type StyleKey } from "@wotrep/analysis";
import { t } from "../../i18n";

/** Team-relative style of every player (analysis style-v0): score and pressure, plus each input as a share of the team average. */
const COLS: StyleKey[] = ["dpm", "kpm", "exchange", "hitRate", "mPerMin", "stillShare", "survival", "spottedPerMin", "assistsPerMin", "boldRate", "focusShare"];
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export function StyleTable({ tl }: { tl: BattleTimeline }) {
  const rows = useMemo(() => {
    const s = styleAll(tl);
    return tl.vehicles.map((v) => ({ v, st: s.get(v.vid)! })).sort((a, b) => (b.st.score ?? -1) - (a.st.score ?? -1));
  }, [tl]);
  return (
    <section className="stylewrap" aria-label={t("style.title")}>
      <h3>{t("style.title")}</h3>
      <p className="muted">{t("style.sub")}</p>
      <div className="tablewrap">
        <table className="stylet">
          <thead>
            <tr>
              <th>{t("style.player")}</th>
              <th title={t("style.score.tip")}>{t("style.score")}</th>
              <th title={t("style.pressure.tip")}>{t("style.pressure")}</th>
              {COLS.map((k) => <th key={k} title={t(`style.col.${k}.tip`)}>{t(`style.col.${k}`)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, st }) => (
              <tr key={v.vid} className={v.team === tl.recorder.team ? "ally" : "enemy"}>
                <td>{v.name}{v.isRecorder ? " ★" : ""}</td>
                <td><b>{st.score == null ? "—" : Math.round(st.score)}</b></td>
                <td>{st.pressure == null ? "—" : st.pressure.toFixed(2)}</td>
                {COLS.map((k) => <td key={k}>{pct(st.rel[k])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">{t("style.note")}</p>
    </section>
  );
}

