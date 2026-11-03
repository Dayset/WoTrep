import type { BattleTimeline, VehicleInfo } from "@wotrep/model";
import { t } from "../../i18n";

const tank = (v: VehicleInfo) => v.vehicleType.split(":")[1] ?? v.vehicleType;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function Team({ tl, team, title, cls }: { tl: BattleTimeline; team: 1 | 2; title: string; cls: string }) {
  const rows = tl.vehicles.filter((v) => v.team === team).map((v) => ({ v, r: tl.results?.players[v.vid] })).sort((a, b) => (b.r?.damageDealt ?? 0) - (a.r?.damageDealt ?? 0));
  return (
    <details open>
      <summary className={cls}>{title}</summary>
      <div className="tablewrap"><table>
        <thead><tr>{["tank", "name", "dmg", "assist", "blocked", "kills", "shots", "received"].map((c) => <th key={c}>{t(`col.${c}`)}</th>)}</tr></thead>
        <tbody>{rows.map(({ v, r }) => (
          <tr key={v.vid} className={v.isRecorder ? "me" : ""}>
            <td>{tank(v)}</td><td>{v.name}{v.isRecorder ? ` (${t("report.you")})` : ""}</td>
            <td>{r?.damageDealt ?? "—"}</td><td>{r ? r.assistRadio + r.assistTrack + r.assistStun : "—"}</td><td>{r?.blocked ?? "—"}</td>
            <td>{r?.kills ?? "—"}</td><td>{r ? `${r.shots} / ${r.hits} / ${r.pens}` : "—"}</td><td>{r?.damageReceived ?? "—"}</td>
          </tr>))}</tbody>
      </table></div>
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
      <Team tl={tl} team={tl.recorder.team} title={t("report.allies")} cls="ally-h" />
      <Team tl={tl} team={tl.recorder.team === 1 ? 2 : 1} title={t("report.enemies")} cls="enemy-h" />
    </div>
  );
}
