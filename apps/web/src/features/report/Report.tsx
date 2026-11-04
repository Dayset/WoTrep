import { useMemo, useState } from "react";
import type { BattleTimeline, VehicleInfo } from "@wotrep/model";
import { boldnessAll, flankModel, playerCoverage, playerHeuristics, recorderHeuristics, reinforce, teamShape, teamplayAll } from "@wotrep/analysis";
import { vehicleLabel } from "@wotrep/gamedata";
import { t } from "../../i18n";
import { AimChart, CompareChart, DistChart, ImpactChart, TargetChart, WpChart } from "./Charts";
import { Debug, debugOn } from "./Debug";
import { Player } from "../player/Player";
import { MapPage } from "../map/MapPage";
import { Ledger } from "./Ledger";
import { Danger } from "./Danger";
import { Movement } from "./Movement";
import { CoverageBadge } from "./CoverageBadge";
import { FindingsPanel } from "./Findings";
import { Scoreboard } from "./Scoreboard";
import { alignment, detectors, goodPlaysAll, rank, runDetectors } from "@wotrep/coach";
import { Vote, FeedbackExport } from "./Feedback";
import { StyleTable } from "./StyleTable";

const tank = (v: VehicleInfo) => vehicleLabel(v.vehicleType).label;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Segmented control: one row of equal buttons, scrolls sideways on narrow screens instead of wrapping into a wall of buttons. */
export function Seg<T extends string>({ value, set, items, label, testid }: { value: T; set: (v: T) => void; items: readonly (readonly [T, string])[]; label: string; testid?: string }) {
  return (
    <div className="segbar" role="tablist" aria-label={label} data-testid={testid}>
      {items.map(([k, l]) => <button type="button" role="tab" key={k} aria-selected={value === k} onClick={() => set(k)}>{l}</button>)}
    </div>
  );
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
type Card = [label: string, value: string, tip: string, id: string];

/** Stat tile: label + number. "?" opens the explanation in place (the tile widens to the full row) so the grid stays short. */
function Tile({ c: [k, v, tip, id] }: { c: Card }) {
  return (
    <div className="card" data-testid={`card-${id}`}>
      <div className="k">{k} <Vote id={`card.${id}`} /></div><div className="v">{v}</div>
      <details className="how"><summary aria-label={t("ui.more")} title={t("ui.more")}>?</summary>{tip && <p>{tip}</p>}<p><b>{t("gl.how")}.</b> {t(`gl.${id}.how`)}</p><p><b>{t("gl.mean")}.</b> {t(`gl.${id}.mean`)}</p></details>
    </div>
  );
}

function Stats({ tl, vid }: { tl: BattleTimeline; vid: number }) {
  const h = playerHeuristics(tl, vid); if (!h) return <p className="muted">—</p>;
  const subjTeam = tl.vehicles.find((v) => v.vid === vid)?.team ?? tl.recorder.team;
  const plays = goodPlaysAll(tl), al = alignment(plays, subjTeam), mineP = plays.filter((p) => p.vid === vid), carried = mineP.filter((p) => p.enabled === "carried").length;
  const fm = flankModel(tl, subjTeam), rf = fm ? reinforce(tl, fm) : null, mineR = rf?.byPlayer.get(vid) ?? 0, reactions = rf ? rf.episodes.flatMap((e) => (e.reactionS == null ? [] : [e.reactionS])).sort((a, b) => a - b) : [];
  const bd = boldnessAll(tl).get(vid), tp = teamplayAll(tl).get(vid), shape = teamShape(tl, subjTeam);
  const myRes = tl.results?.players[vid];
  const sgn = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;
  const assist = myRes ? myRes.assistRadio + myRes.assistTrack + myRes.assistStun : 0;
  const impact: Card[] = [
    [t("adv.impact"), `${sgn(h.impactPts)} ${t("adv.pts")}`, t("adv.impact.tip"), "impact"],
    [t("adv.threat"), `${h.threatWeighted} (×${h.threatWeightedPerDamage.toFixed(2)})`, t("adv.threat.tip"), "threat"],
    [t("adv.onthreats"), pct(h.shareOnThreats), t("adv.onthreats.tip"), "onthreats"],
    [t("adv.cleanup"), pct(h.cleanupShare), t("adv.cleanup.tip"), "cleanup"],
    [t("adv.dpm"), String(h.dpm), t("adv.dpm.tip"), "dpm"],
    ...(myRes && myRes.lifeTimeS >= 10 ? ([[t("adv.support"), `${Math.round(assist / (myRes.lifeTimeS / 60))} (${Math.round((100 * assist) / Math.max(1, assist + myRes.damageDealt))}%)`, t("adv.support.tip"), "support"]] as Card[]) : []),
  ];
  const risk: Card[] = bd ? [
    [t("adv.bold"), bd.rate == null ? "—" : `${Math.round(bd.rate * 100)}% (${bd.taken}/${bd.episodes})`, t("adv.bold.tip"), "bold"],
    [t("adv.paid"), bd.rewardedShare == null ? "—" : `${Math.round(bd.rewardedShare * 100)}% (${bd.rewarded}/${bd.taken})`, "", "paid"],
    [t("adv.costly"), bd.costlyShare == null ? "—" : `${Math.round(bd.costlyShare * 100)}% (${bd.costly}/${bd.taken})`, "", "costly"],
    [t("adv.style"), bd.style ? t(`adv.style.${bd.style}`) : "—", "", "style"],
  ] : [];
  const team: Card[] = tp ? [
    [t("adv.focus"), tp.focusShare == null ? "—" : pct(tp.focusShare), "", "focus"],
    [t("adv.company"), tp.companyShare == null ? "—" : pct(tp.companyShare), "", "company"],
    [t("adv.hang"), tp.hangS == null ? "—" : `${tp.hangS} s (${pct(tp.hangShare ?? 0)})`, "", "hang"],
    [t("adv.rank"), tp.frontRank == null ? "—" : pct(tp.frontRank), "", "rank"],
    [t("adv.spread"), shape.spreadM == null ? "—" : `${shape.spreadM} m`, "", "spread"],
    [t("adv.align"), al.share == null ? "—" : `${pct(al.share)} (${al.aligned}/${al.plays})`, "", "align"],
    ...(rf ? ([
      [t("adv.reinforce"), rf.episodes.length ? `${rf.answered}/${rf.episodes.length}${reactions.length ? ` · ${reactions[reactions.length >> 1]} s` : ""}` : "—", "", "reinforce"],
      [t("adv.reinforced"), rf.episodes.length ? String(mineR) : "—", "", "reinforced"],
    ] as Card[]) : []),
    [t("adv.enabled"), mineP.length ? `${carried}/${mineP.length}` : "—", "", "enabled"],
  ] : [];
  return (
    <div className="adv" data-testid="advanced">
      {([["ui.grp.impact", impact], ["ui.grp.risk", risk], ["ui.grp.team", team]] as const).map(([g, cs]) => cs.length > 0 && (
        <section key={g}><h3 className="grp">{t(g)}{g === "ui.grp.impact" && <span className="beta">{t("adv.beta")}</span>}</h3><div className="cards">{cs.map((c) => <Tile key={c[3]} c={c} />)}</div></section>
      ))}
    </div>
  );
}

type Tab = "replay" | "stats" | "coach" | "teams" | "charts";

export function Report({ tl, onBack }: { tl: BattleTimeline; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("replay");
  const [tsub, setTsub] = useState<"score" | "ledger" | "danger" | "move">("score"), [side, setSide] = useState<"own" | "enemy">("own");
  const [csub, setCsub] = useState<"wp" | "impact" | "targets" | "compare" | "aim" | "dist" | "heat">("wp");
  const [seekTo, setSeekTo] = useState<{ t: number; n: number }>({ t: 0, n: 0 });
  const [subject, setSubject] = useState(tl.recorder.vid);
  /** The player the Stats and Coach tabs are about. Falls back to the recorder when the stored vid is not in this battle. */
  const subjectVid = tl.vehicles.some((v) => v.vid === subject) ? subject : tl.recorder.vid;
  const findings = useMemo(() => rank(runDetectors(tl, detectors, subjectVid)), [tl, subjectVid]);
  /** Share of each player's alive time the replay has position data for, shown next to the name. */
  const cov = useMemo(() => new Map(tl.vehicles.map((v) => [v.vid, playerCoverage(tl, v.vid)])), [tl]);
  const pc = (vid: number) => { const x = cov.get(vid); return x == null ? "—" : `${Math.round(x * 100)}%`; };
  const h = useMemo(() => recorderHeuristics(tl), [tl]);
  const me = tl.vehicles.find((v) => v.isRecorder)!, w = tl.arena.winnerTeam, mr = tl.results?.players[tl.recorder.vid];
  const res = w == null ? t("report.unfinished") : w === 0 ? t("report.draw") : w === tl.recorder.team ? t("report.win") : t("report.loss");
  const resCls = w == null || w === 0 ? "" : w === tl.recorder.team ? "win" : "loss";
  const go = (x: Tab) => { setTab(x); window.scrollTo({ top: 0 }); };
  const kpis: [string, string][] = [
    ...(h ? ([[t("ui.sum.impact"), `${h.impactPts >= 0 ? "+" : "−"}${Math.abs(h.impactPts).toFixed(1)}`]] as [string, string][]) : []),
    ...(mr ? ([[t("col.dmg"), String(mr.damageDealt)], [t("col.assist"), String(mr.assistRadio + mr.assistTrack + mr.assistStun)], [t("col.kills"), String(mr.kills)], [t("col.blocked"), String(mr.blocked)]] as [string, string][]) : []),
  ];
  const nCoach = findings.length;
  return (
    <div className="report" data-testid="report">
      <div className="rhead">
        <div className="rtitle">
          <h2><span className={resCls}>{res}</span> · {tl.arena.mapDisplayName} · {tank(me)}</h2>
          <div className="sub">{tl.arena.startedAt.slice(0, 16)} · {tl.source.server}{tl.arena.durationS != null && <> · {mmss(tl.arena.durationS)}</>}</div>
        </div>
        <button type="button" className="sm" onClick={onBack} title={t("report.back")}>＋ {t("ui.new")}</button>
        <dl className="kpis">{kpis.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <div className="notes">
          <CoverageBadge tl={tl} />
          {tl.source.manifest.confidence !== "defs" && <details className="covbadge partial"><summary>{t("ui.partial")}</summary><p>{t(tl.source.manifest.confidence === "fingerprint" ? "parser.partialSupport" : "report.partial")}</p></details>}
          {(tl.arena.battleType !== 1 || tl.vehicles.length !== 30) && <details className="covbadge partial" data-testid="modebanner"><summary>{t("ui.mode")}</summary><p>{t("report.mode")}</p></details>}
        </div>
      </div>
      <nav className="tabs" role="tablist" aria-label={t("ui.tabs")}>
        {(["replay", "stats", "coach", "teams", "charts"] as const).map((k) => <button type="button" role="tab" key={k} aria-selected={tab === k} onClick={() => go(k)} data-testid={`tab-${k}`}>{t(`ui.tab.${k}`)}{k === "coach" && nCoach > 0 && <span className="badge">{nCoach}</span>}</button>)}
      </nav>
      {/* the player stays mounted so 3D, map and time survive tab switches */}
      <div hidden={tab !== "replay"}><Player tl={tl} findings={findings} subject={subjectVid} seekTo={seekTo} /></div>
      {(tab === "stats" || tab === "coach") && (
        <div className="pane">
          <label>{t("report.subject")} <select value={subjectVid} onChange={(e) => setSubject(Number(e.target.value))} aria-label={t("report.subject")}>
            <option value={tl.recorder.vid}>👁 {me.name} ({t("pov.me")}) · {pc(tl.recorder.vid)}</option>
            <optgroup label={t("pov.team")}>{tl.vehicles.filter((v) => v.team === tl.recorder.team && !v.isRecorder).sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.vid} value={v.vid}>{v.name} · {pc(v.vid)}</option>)}</optgroup>
            <optgroup label={t("pov.foes")}>{tl.vehicles.filter((v) => v.team !== tl.recorder.team).sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.vid} value={v.vid}>{v.name} · {pc(v.vid)}</option>)}</optgroup>
          </select></label>
          <p className="muted">{t("report.subjectCoverage")}</p>
          {subjectVid !== tl.recorder.vid && <p className="muted">{t("report.subjectPartial")}</p>}
        </div>
      )}
      {tab === "stats" && <><StyleTable tl={tl} /><Stats tl={tl} vid={subjectVid} /><FeedbackExport />{debugOn() && <Debug tl={tl} />}</>}
      {tab === "coach" && <FindingsPanel findings={findings} checks={detectors.length} onShow={(f) => { setSeekTo((s) => ({ t: Math.max(0, f.tStart - f.leadS), n: s.n + 1 })); go("replay"); }} />}
      {tab === "teams" && <div className="pane">
        <Seg value={tsub} set={setTsub} label={t("ui.tab.teams")} items={[["score", t("ui.t.score")], ["ledger", t("ui.t.ledger")], ["danger", t("ui.t.danger")], ["move", t("ui.t.move")]]} />
        {tsub === "score" && <><Seg value={side} set={setSide} label={t("ui.t.score")} items={[["own", t("report.allies")], ["enemy", t("report.enemies")]]} /><Scoreboard key={side} tl={tl} team={side === "own" ? tl.recorder.team : tl.recorder.team === 1 ? 2 : 1} /></>}
        {tsub === "ledger" && <Ledger tl={tl} />}{tsub === "danger" && <Danger tl={tl} />}{tsub === "move" && <Movement tl={tl} />}
      </div>}
      {tab === "charts" && <div className="pane">
        <Seg value={csub} set={setCsub} label={t("ui.tab.charts")} testid="charts" items={[["wp", t("ui.c.wp")], ["impact", t("ui.c.impact")], ["targets", t("ui.c.targets")], ["compare", t("ui.c.compare")], ["aim", t("ui.c.aim")], ["dist", t("ui.c.dist")], ["heat", t("ui.c.heat")]]} />
        <div className="charts">{csub === "wp" && <WpChart tl={tl} />}{csub === "impact" && <ImpactChart tl={tl} />}{csub === "targets" && <TargetChart tl={tl} />}{csub === "compare" && <CompareChart tl={tl} />}{csub === "aim" && <AimChart tl={tl} />}{csub === "dist" && <DistChart tl={tl} />}{csub === "heat" && <MapPage tl={tl} />}</div>
      </div>}
    </div>
  );
}
