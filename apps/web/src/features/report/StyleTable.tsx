import { useMemo } from "react";
import type { BattleTimeline } from "@wotrep/model";
import { styleAll, type StyleKey } from "@wotrep/analysis";
import { t } from "../../i18n";
import { SortTable } from "./SortTable";

/** Team-relative style of every player (analysis style-v0): score and pressure, plus each input as a share of the team average. */
const COLS: StyleKey[] = ["dpm", "kpm", "exchange", "hitRate", "mPerMin", "stillShare", "survival", "spottedPerMin", "assistsPerMin", "boldRate", "focusShare"];
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export function StyleTable({ tl }: { tl: BattleTimeline }) {
  const rows = useMemo(() => {
    const s = styleAll(tl);
    return tl.vehicles.map((v) => ({ v, st: s.get(v.vid)! }));
  }, [tl]);
  return (
    <section className="stylewrap" aria-label={t("style.title")}>
      <h3>{t("style.title")}</h3>
      <p className="muted">{t("style.sub")}</p>
      <SortTable sortKey="score" wrapClass="stylet" cols={[{ key: "player", label: t("style.player"), name: true }, { key: "score", label: t("style.score"), title: t("style.score.tip") }, { key: "pressure", label: t("style.pressure"), title: t("style.pressure.tip") }, ...COLS.map((k) => ({ key: k, label: t(`style.col.${k}`), title: t(`style.col.${k}.tip`) }))]}
          rows={rows.map(({ v, st }) => ({ id: v.vid, side: v.team === tl.recorder.team ? "ally" : "foe", cells: { player: { v: v.name, node: <>{v.name}{v.isRecorder ? " ★" : ""}</> }, score: { v: st.score, node: <b>{st.score == null ? "—" : Math.round(st.score)}</b> }, pressure: { v: st.pressure, node: st.pressure == null ? "—" : st.pressure.toFixed(2) }, ...Object.fromEntries(COLS.map((k) => [k, { v: st.rel[k], node: pct(st.rel[k]) }])) } }))} />
      <p className="muted">{t("style.note")}</p>
    </section>
  );
}

