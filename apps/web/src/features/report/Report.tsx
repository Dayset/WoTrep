import type { BattleTimeline, VehicleInfo } from "@wotrep/model";
import { playerMetrics, recorderHeuristics } from "@wotrep/analysis";
import { t } from "../../i18n";
import { HeuristicCharts } from "./Charts";

const tank = (v: VehicleInfo) => v.vehicleType.split(":")[1] ?? v.vehicleType;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function Team({ tl, team, title, cls }: { tl: BattleTimeline; team: 1 | 2; title: string; cls: string }) {
  const dpm = new Map(playerMetrics(tl).map((p) => [p.vid, p.dpm]));
  const rows = tl.vehicles.filter((v) => v.team === team).map((v) => ({ v, r: tl.results?.players[v.vid] })).sort((a, b) => (b.r?.damageDealt ?? 0) - (a.r?.damageDealt ?? 0));
  return (
    <details open>
      <summary className={cls}>{title}</summary>
      <div className="tablewrap"><table>
        <thead><tr>{["name", "tank", "dmg", "dpm", "assist", "blocked", "kills", "shots", "received"].map((c) => <th key={c}>{t(`col.${c}`)}</th>)}</tr></thead>
        <tbody>{rows.map(({ v, r }) => (
          <tr key={v.vid} className={v.isRecorder ? "me" : ""}>
            <td className="nm">{v.name}{v.isRecorder ? ` (${t("report.you")})` : ""}</td><td className="tk">{tank(v)}</td>
            <td>{r?.damageDealt ?? "—"}</td><td>{r ? dpm.get(v.vid) : "—"}</td><td>{r ? r.assistRadio + r.assistTrack + r.assistStun : "—"}</td><td>{r?.blocked ?? "—"}</td>
            <td>{r?.kills ?? "—"}</td><td>{r ? `${r.shots} / ${r.hits} / ${r.pens}` : "—"}</td><td>{r?.damageReceived ?? "—"}</td>
          </tr>))}</tbody>
      </table></div>
    </details>
  );
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
function Advanced({ tl }: { tl: BattleTimeline }) {
  const h = recorderHeuristics(tl); if (!h) return null;
  const sgn = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;
  const cards: [string, string, string][] = [
    [t("adv.impact"), `${sgn(h.impactPts)} ${t("adv.pts")}`, t("adv.impact.tip")],
    [t("adv.threat"), `${h.threatWeighted} (×${h.threatWeightedPerDamage.toFixed(2)})`, t("adv.threat.tip")],
    [t("adv.onthreats"), pct(h.shareOnThreats), t("adv.onthreats.tip")],
    [t("adv.cleanup"), pct(h.cleanupShare), t("adv.cleanup.tip")],
    [t("adv.dpm"), String(h.dpm), t("adv.dpm.tip")],
  ];
  return (
    <details open className="adv" data-testid="advanced">
      <summary>{t("adv.title")}<span className="beta">{t("adv.beta")}</span> <span className="muted">· {t("adv.sub")}</span></summary>
      <div className="cards">{cards.map(([k, v, tip]) => <div className="card" key={k} title={tip}><div className="k">{k}</div><div className="v">{v}</div><div className="tip">{tip}</div></div>)}</div>
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
      <Team tl={tl} team={tl.recorder.team} title={t("report.allies")} cls="ally-h" />
      <Team tl={tl} team={tl.recorder.team === 1 ? 2 : 1} title={t("report.enemies")} cls="enemy-h" />
    </div>
  );
}
