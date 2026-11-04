import { useMemo } from "react";
import type { BattleTimeline } from "@wotrep/model";
import { impactSwings } from "@wotrep/analysis";
import { t } from "../../i18n";
import { SortTable } from "./SortTable";

/** Biggest win-probability swings, per team and per player (analysis spikes.ts). Sorted by the largest swing for either team. */
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
export function Swings({ tl }: { tl: BattleTimeline }) {
  const rows = useMemo(() => {
    const name = new Map(tl.vehicles.map((v) => [v.vid, v.name]));
    const me = tl.recorder.team;
    return impactSwings(tl).filter((s) => Math.abs(s.team[1]) >= 1 || Math.abs(s.team[2]) >= 1).slice(0, 25).map((s) => {
      const ally = s.team[me], foe = s.team[me === 1 ? 2 : 1];
      const top = s.players[0];
      return {
        id: s.t0, cls: "", side: "ally" as const,
        cells: {
          time: { v: s.t0, node: `${mmss(s.t0)}–${mmss(s.t1)}` },
          ally: { v: ally, node: `${ally > 0 ? "+" : ""}${ally}` },
          foe: { v: foe, node: `${foe > 0 ? "+" : ""}${foe}` },
          top: { v: top ? name.get(top.vid) ?? "?" : null, node: top ? <span className={top.team === me ? "nm-ally" : "nm-foe"}>{name.get(top.vid) ?? "?"} {top.pts > 0 ? "+" : ""}{top.pts}</span> : "—" },
        },
      };
    });
  }, [tl]);
  return (
    <section className="swings" aria-label={t("swing.title")}>
      <h3>{t("swing.title")}</h3>
      <p className="muted">{t("swing.sub")}</p>
      <SortTable sortKey="ally" cols={[{ key: "time", label: t("swing.time") }, { key: "ally", label: t("swing.ally") }, { key: "foe", label: t("swing.foe") }, { key: "top", label: t("swing.top"), name: true }]} rows={rows} />
    </section>
  );
}
