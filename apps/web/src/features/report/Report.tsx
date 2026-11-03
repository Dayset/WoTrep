import { useState } from "react";
import type { BattleTimeline, VehicleInfo } from "@wotrep/model";
import { playerMetrics, playerStats, recorderHeuristics } from "@wotrep/analysis";
import { vehicleLabel } from "@wotrep/gamedata";
import { t } from "../../i18n";
import { HeuristicCharts } from "./Charts";
import { Vote, FeedbackExport } from "./Feedback";

const tank = (v: VehicleInfo) => vehicleLabel(v.vehicleType).label;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function Team({ tl, team, title, cls }: { tl: BattleTimeline; team: 1 | 2; title: string; cls: string }) {
  const dpm = new Map(playerMetrics(tl).map((p) => [p.vid, p.dpm]));
  const st = new Map(playerStats(tl).map((p) => [p.vid, p]));
  const pc = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: "dmg", dir: -1 });
  const val: Record<string, (v: VehicleInfo, r?: PlayerResultLike) => number | string> = {
    name: (v) => v.name.toLowerCase(), tank: (v) => tank(v), dmg: (_, r) => r?.damageDealt ?? -1, dpm: (v, r) => (r ? dpm.get(v.vid) ?? -1 : -1),
    assist: (_, r) => (r ? r.assistRadio + r.assistTrack + r.assistStun : -1), blocked: (_, r) => r?.blocked ?? -1, kills: (_, r) => r?.kills ?? -1,
    shots: (_, r) => r?.shots ?? -1, acc: (v) => st.get(v.vid)?.accuracy ?? -1, pen: (v) => st.get(v.vid)?.penRate ?? -1, life: (_, r) => r?.lifeTimeS ?? -1, received: (_, r) => r?.damageReceived ?? -1,
  };
  const rows = tl.vehicles.filter((v) => v.team === team).map((v) => ({ v, r: tl.results?.players[v.vid] })).sort((a, b) => {
    const x = val[sort.k]!(a.v, a.r), y = val[sort.k]!(b.v, b.r); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
  return (
    <details open>
      <summary className={cls}>{title}</summary>
      <div className="tablewrap"><table>
        <thead><tr>{["name", "tank", "dmg", "dpm", "assist", "blocked", "kills", "shots", "acc", "pen", "life", "received"].map((c) => <th key={c} aria-sort={sort.k === c ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button type="button" className="sortbtn" onClick={() => setSort({ k: c, dir: sort.k === c ? (sort.dir === 1 ? -1 : 1) : c === "name" || c === "tank" ? 1 : -1 })}>{t(`col.${c}`)}{sort.k === c ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</button></th>)}</tr></thead>
        <tbody>{rows.map(({ v, r }) => (
          <tr key={v.vid} className={v.isRecorder ? "me" : ""}>
            <td className="nm">{v.name}{v.isRecorder ? ` (${t("report.you")})` : ""}</td><td className="tk">{tank(v)}</td>
            <td>{r?.damageDealt ?? "—"}</td><td>{r ? dpm.get(v.vid) : "—"}</td><td>{r ? r.assistRadio + r.assistTrack + r.assistStun : "—"}</td><td>{r?.blocked ?? "—"}</td>
            <td>{r?.kills ?? "—"}</td><td>{r ? `${r.shots} / ${r.hits} / ${r.pens}` : "—"}</td><td>{pc(st.get(v.vid)?.accuracy)}</td><td>{pc(st.get(v.vid)?.penRate)}</td><td title={pc(st.get(v.vid)?.lifeShare)}>{r ? mmss(r.lifeTimeS) : "—"}</td><td>{r?.damageReceived ?? "—"}</td>
          </tr>))}</tbody>
      </table></div>
    </details>
  );
}

type PlayerResultLike = NonNullable<BattleTimeline["results"]>["players"][number];
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
function Advanced({ tl }: { tl: BattleTimeline }) {
  const h = recorderHeuristics(tl); if (!h) return null;
  const sgn = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;
  const cards: [string, string, string, string][] = [
    [t("adv.impact"), `${sgn(h.impactPts)} ${t("adv.pts")}`, t("adv.impact.tip"), "impact"],
    [t("adv.threat"), `${h.threatWeighted} (×${h.threatWeightedPerDamage.toFixed(2)})`, t("adv.threat.tip"), "threat"],
    [t("adv.onthreats"), pct(h.shareOnThreats), t("adv.onthreats.tip"), "onthreats"],
    [t("adv.cleanup"), pct(h.cleanupShare), t("adv.cleanup.tip"), "cleanup"],
    [t("adv.dpm"), String(h.dpm), t("adv.dpm.tip"), "dpm"],
  ];
  return (
    <details open className="adv" data-testid="advanced">
      <summary>{t("adv.title")}<span className="beta">{t("adv.beta")}</span> <span className="muted">· {t("adv.sub")}</span></summary>
      <div className="cards">{cards.map(([k, v, tip, id]) => <div className="card" key={k} title={tip}><div className="k">{k} <Vote id={`card.${id}`} /></div><div className="v">{v}</div><div className="tip">{tip}</div></div>)}</div>
    </details>
  );
}

export function Report({ tl, onBack }: { tl: BattleTimeline; onBack: () => void }) {
  const me = tl.vehicles.find((v) => v.isRecorder)!, w = tl.arena.winnerTeam;
  const res = w == null ? t("report.unfinished") : w === 0 ? t("report.draw") : w === tl.recorder.team ? t("report.win") : t("report.loss");
  const resCls = w == null || w === 0 ? "" : w === tl.recorder.team ? "win" : "loss";
  return (
    <div className="report" data-testid="report">
      <button onClick={onBack}>← {t("report.back")}</button>
      <h2><span className={resCls}>{res}</span> · {tl.arena.mapDisplayName} · {tank(me)}</h2>
      <div className="sub">{tl.arena.startedAt} · {tl.source.server} · v{tl.source.clientVersion}
        {tl.arena.durationS != null && <> · {t("report.duration")} {mmss(tl.arena.durationS)}</>}</div>
      {tl.source.manifest.confidence !== "defs" && <div className="banner">{t("report.partial")}</div>}
      <Advanced tl={tl} />
      <HeuristicCharts tl={tl} />
      <FeedbackExport />
      <Team tl={tl} team={tl.recorder.team} title={t("report.allies")} cls="ally-h" />
      <Team tl={tl} team={tl.recorder.team === 1 ? 2 : 1} title={t("report.enemies")} cls="enemy-h" />
    </div>
  );
}
