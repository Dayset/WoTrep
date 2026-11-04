import { SortTable } from "./SortTable";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BattleTimeline, Team } from "@wotrep/model";
import { aimSamples, alignWith, teamCoherence, boldnessAll, percentileRank, playerHeuristics, playerStats, recorderHeuristics, wpSeries } from "@wotrep/analysis";
import { t } from "../../i18n";
import { Vote } from "./Feedback";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const sgn = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.floor(el.clientWidth))));
    ro.observe(el); setW(Math.max(280, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Frame({ id, title, sub, legend, children, table }: { id: string; title: string; sub: string; legend?: [string, string][]; children: React.ReactNode; table: React.ReactNode }) {
  return (
    <figure className="chart">
      <figcaption><b>{title}</b><span className="muted"> · {sub}</span> <Vote id={id} /></figcaption>
      {legend && <div className="legend">{legend.map(([c, l]) => <span key={l}><i style={{ background: `var(${c})` }} />{l}</span>)}</div>}
      {children}
      <details className="tv"><summary>{t("viz.table")}</summary><div className="tablewrap">{table}</div></details>
    </figure>
  );
}

const M = { l: 38, r: 10, t: 10, b: 24 };

/** Chart 1 — win probability over battle time with kill markers and the recorder's hits. */
export function WpChart({ tl }: { tl: BattleTimeline }) {
  const [ref, W] = useWidth(); const [hi, setHi] = useState<number | null>(null);
  const team = tl.recorder.team as Team, H = 230;
  const s = wpSeries(tl, team, 1), end = s.t.at(-1) || 1;
  const x = (v: number) => M.l + (v / end) * (W - M.l - M.r), y = (p: number) => M.t + (1 - p) * (H - M.t - M.b);
  const path = s.t.map((v, i) => `${i ? "L" : "M"}${x(v).toFixed(1)},${y(s.wp[i]!).toFixed(1)}`).join("");
  const vteam = new Map(tl.vehicles.map((v) => [v.vid, v.team]));
  const kills = tl.events.flatMap((e) => (e.k === "kill" && e.t <= end ? [e] : []));
  const hits = tl.events.flatMap((e) => (e.k === "damage" && e.attacker === tl.recorder.vid && e.target !== tl.recorder.vid && e.amount > 0 ? [e] : []));
  const wpAt = (tt: number) => s.wp[Math.min(s.wp.length - 1, Math.max(0, Math.round(tt)))]!;
  const move = (ev: React.PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect(); const v = ((ev.clientX - r.left - M.l) / (W - M.l - M.r)) * end;
    setHi(Math.min(s.t.length - 1, Math.max(0, Math.round(v))));
  };
  const hv = hi == null ? null : hi, near = hv == null ? null : kills.find((k) => Math.abs(k.t - hv) <= 2);
  const nm = (vid: number) => tl.vehicles.find((v) => v.vid === vid)?.name ?? "?";
  const rows = kills.map((k) => ({ t: k.t, text: `${nm(k.killer)} → ${nm(k.victim)}`, wp: wpAt(k.t) }));
  return (
    <Frame id="chart.wp" title={t("viz.wp")} sub={t("viz.wp.sub")} legend={[["--c-you", t("viz.wp.you")], ["--c-foe", t("viz.kill.foe")], ["--c-mine", t("viz.hit")]]}
      table={<SortTable sortKey="t" dir={1} cols={[{ key: "t", label: t("viz.time") }, { key: "e", label: t("viz.event") }, { key: "wp", label: "WP" }]} rows={rows.map((r) => ({ id: r.t, cells: { t: { v: r.t, node: mmss(r.t) }, e: { v: r.text, node: r.text }, wp: { v: r.wp, node: `${(r.wp * 100).toFixed(0)}%` } } }))} />}>
      <div ref={ref} className="plot">
        <svg width={W} height={H} role="img" aria-label={t("viz.wp.aria")} onPointerMove={move} onPointerLeave={() => setHi(null)} style={{ touchAction: "pan-y" }}>
          {[0, 0.5, 1].map((p) => <g key={p}><line x1={M.l} x2={W - M.r} y1={y(p)} y2={y(p)} className={p === 0.5 ? "ref" : "grid"} /><text x={M.l - 6} y={y(p) + 4} className="ax" textAnchor="end">{p * 100}%</text></g>)}
          {Array.from({ length: Math.floor(end / 120) + 1 }, (_, i) => i * 120).map((v) => <text key={v} x={x(v)} y={H - 6} className="ax" textAnchor="middle">{mmss(v)}</text>)}
          <path d={path} className="wpline" />
          {hits.map((h, i) => <line key={i} x1={x(h.t)} x2={x(h.t)} y1={H - M.b - 7} y2={H - M.b} className="hit" />)}
          {kills.map((k, i) => <circle key={i} cx={x(k.t)} cy={y(wpAt(k.t))} r={4.5} className={vteam.get(k.victim) === team ? "kfoe" : "kyou"} />)}
          {hv != null && <g><line x1={x(hv)} x2={x(hv)} y1={M.t} y2={H - M.b} className="cross" /><circle cx={x(hv)} cy={y(s.wp[hv]!)} r={4.5} className="dot" /></g>}
        </svg>
        {hv != null && <div className="tip" style={{ left: Math.min(Math.max(x(hv) - 70, 0), W - 150) }}>
          <b>{mmss(hv)}</b> · {t("viz.wp.you")} {(s.wp[hv]! * 100).toFixed(0)}%
          {near && <div className="muted">{nm(near.killer)} → {nm(near.victim)}</div>}
        </div>}
      </div>
    </Frame>
  );
}

/** Chart 2 — what each of the recorder's hits did to win probability, and the running Impact total. */
type Side = "all" | "ally" | "enemy";
const SIDES: [Side, string][] = [["all", "viz.side.all"], ["ally", "viz.cmp.allies"], ["enemy", "viz.cmp.enemies"]];
function SideSeg({ value, set }: { value: Side; set: (s: Side) => void }) {
  return <div className="seg" role="tablist">{SIDES.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} onClick={() => set(k)}>{t(l)}</button>)}</div>;
}

/** Who the impact view follows: the recorder, a whole side, or one named player. */
type ImpactMode = "you" | "ally" | "enemy" | "both" | number;
type ImpactHit = { t: number; who: string; side: "you" | "ally" | "enemy"; target: number; amount: number; threat: number; dWpPts: number; cumPts: number };
/** Hits for the chosen mode, time-ordered. For a group the running total is the sum of each member's win-probability change. */
function impactHits(tl: BattleTimeline, mode: ImpactMode): ImpactHit[] {
  const nameOf = (vid: number) => tl.vehicles.find((v) => v.vid === vid)?.name ?? "?";
  if (mode === "you") {
    return (recorderHeuristics(tl)?.hits ?? []).map((d) => ({ ...d, who: nameOf(tl.recorder.vid), side: "you" as const }));
  }
  // "both": allies count as they are; an enemy hit that helped their team hurt ours, so its change is negated.
  const members = tl.vehicles.filter((v) => typeof mode === "number" ? v.vid === mode : mode === "both" || (mode === "ally" ? v.team === tl.recorder.team : v.team !== tl.recorder.team));
  const evs = members.flatMap((v) => { const ally = v.team === tl.recorder.team, sg = mode === "both" && !ally ? -1 : 1;
    return (playerHeuristics(tl, v.vid)?.hits ?? []).map((d) => ({ ...d, who: v.name, side: (ally ? "ally" : "enemy") as "ally" | "enemy", dWpPts: Math.round(sg * d.dWpPts * 100) / 100 })); }).sort((a, b) => a.t - b.t);
  let cum = 0;
  return evs.map((d) => { cum += d.dWpPts; return { ...d, cumPts: Math.round(cum * 100) / 100 }; });
}

export function ImpactChart({ tl }: { tl: BattleTimeline }) {
  const [ref, W] = useWidth(); const [hi, setHi] = useState<number | null>(null); const [mode, setMode] = useState<ImpactMode>("both");
  const hits = useMemo(() => impactHits(tl, mode), [tl, mode]);
  if (!hits.length) return null;
  const both = mode === "both", H = 210, end = tl.arena.durationS ?? hits.at(-1)!.t;
  // per-side running totals for the both view (allies and enemies, in our win-chance terms)
  let sa = 0, se = 0; const allyRun = hits.map((d) => (d.side === "ally" ? (sa += d.dWpPts) : sa)), enemyRun = hits.map((d) => (d.side === "enemy" ? (se += d.dWpPts) : se));
  const vals = [0, ...hits.flatMap((d) => [d.dWpPts, d.cumPts]), ...(both ? [...allyRun, ...enemyRun] : [])];
  const lo = Math.min(...vals), hiV = Math.max(1, ...vals);
  const x = (v: number) => M.l + (v / end) * (W - M.l - M.r), y = (v: number) => M.t + (1 - (v - lo) / (hiV - lo)) * (H - M.t - M.b);
  const stepPath = (run: number[]) => { let p = `M${x(0)},${y(0)}`, last = 0; hits.forEach((d, i) => { p += `L${x(d.t).toFixed(1)},${y(last).toFixed(1)}L${x(d.t).toFixed(1)},${y(run[i]!).toFixed(1)}`; last = run[i]!; }); return p + `L${x(end)},${y(last)}`; };
  const path = stepPath(hits.map((d) => d.cumPts));
  const nm = (vid: number) => tl.vehicles.find((v) => v.vid === vid)?.name ?? "?";
  const hh = hi == null ? null : hits[hi]!;
  return (
    <Frame id="chart.impact" title={t("viz.impact")} sub={t("viz.impact.sub")} legend={both ? [["--c-you", t("viz.cmp.allies")], ["--c-foe", t("viz.cmp.enemies")], ["--c-ink", t("viz.impact.total")]] : [["--c-you", t("viz.impact.up")], ["--c-foe", t("viz.impact.down")], ["--c-ink", t("viz.impact.total")]]}
      table={<SortTable sortKey="t" dir={1} cols={[{ key: "t", label: t("viz.time") }, { key: "who", label: t("viz.player") }, { key: "target", label: t("viz.target") }, { key: "dmg", label: "dmg" }, { key: "x", label: "×" }, { key: "dwp", label: "Δ WP" }, { key: "sum", label: "Σ" }]} rows={hits.map((d, i) => ({ id: i, cells: { t: { v: d.t, node: mmss(d.t) }, who: { v: d.who, node: d.who }, target: { v: nm(d.target), node: nm(d.target) }, dmg: { v: d.amount, node: d.amount }, x: { v: d.threat, node: d.threat }, dwp: { v: d.dWpPts, node: sgn(d.dWpPts) }, sum: { v: d.cumPts, node: sgn(d.cumPts) } } }))} />}>
      <label><select className="pick" value={String(mode)} onChange={(e) => { const v = e.target.value; setMode(v === "you" || v === "ally" || v === "enemy" || v === "both" ? v : Number(v)); setHi(null); }}>
        <option value="both">{t("viz.side.both")}</option>
        <option value="you">{t("report.you")}</option>
        <option value="ally">{t("viz.cmp.allies")}</option>
        <option value="enemy">{t("viz.cmp.enemies")}</option>
        {tl.vehicles.map((v) => <option key={v.vid} value={v.vid}>{v.name}</option>)}
      </select></label>
      <div ref={ref} className="plot" onPointerLeave={() => setHi(null)}>
        <svg width={W} height={H} role="img" aria-label={t("viz.impact.aria")}>
          {[...new Set([lo, 0, hiV])].map((v) => <g key={v}><line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className={v === 0 ? "ref" : "grid"} /><text x={M.l - 6} y={y(v) + 4} className="ax" textAnchor="end">{v === 0 ? "0" : sgn(v)}</text></g>)}
          {Array.from({ length: Math.floor(end / 120) + 1 }, (_, i) => i * 120).map((v) => <text key={v} x={x(v)} y={H - 6} className="ax" textAnchor="middle">{mmss(v)}</text>)}
          {hits.map((d, i) => { const top = Math.min(y(0), y(d.dWpPts)), hgt = Math.max(2, Math.abs(y(d.dWpPts) - y(0)));
            const cls = both ? undefined : d.dWpPts >= 0 ? "bup" : "bdn", fill = both ? (d.side === "ally" ? "var(--c-you)" : "var(--c-foe)") : undefined;
            return <rect key={i} x={x(d.t) - 2.5} width={5} y={top} height={hgt} rx={2} className={cls} fill={fill} opacity={hi == null || hi === i ? 1 : 0.35} />; })}
          {both && <><path d={stepPath(allyRun)} fill="none" stroke="var(--c-you)" strokeWidth={2} /><path d={stepPath(enemyRun)} fill="none" stroke="var(--c-foe)" strokeWidth={2} /></>}
          <path d={path} className="cumline" />
          {hits.map((d, i) => <rect key={i} x={x(d.t) - 9} width={18} y={M.t} height={H - M.t - M.b} fill="transparent" onPointerEnter={() => setHi(i)} onPointerDown={() => setHi(i)} />)}
        </svg>
        {hh && <div className="tip" style={{ left: Math.min(Math.max(x(hh.t) - 80, 0), W - 170) }}>
          <b>{mmss(hh.t)}</b> · {hh.who} → {nm(hh.target)}<div>{hh.amount} dmg · ×{hh.threat}</div><div>Δ WP {sgn(hh.dWpPts)} · Σ {sgn(hh.cumPts)}</div>
        </div>}
      </div>
    </Frame>
  );
}

export function TargetChart({ tl }: { tl: BattleTimeline }) {
  const [ref, W] = useWidth(); const [hi, setHi] = useState<number | null>(null);
  const [sel, setSel] = useState<number | "all">("all");
  const [side, setSide] = useState<Side>("all");
  const all = useMemo(() => tl.vehicles.map((v) => ({ v, h: playerHeuristics(tl, v.vid) })).filter((r) => r.h && r.h.hits.length), [tl]);
  if (!all.length) return null;
  const nm = (vid: number) => tl.vehicles.find((v) => v.vid === vid)?.name ?? "?";
  const short = (n: string) => (n.length > 14 ? n.slice(0, 13) + "…" : n);
  const rows: { key: number; name: string; dmg: number; w: number; tw: number; mine: boolean; ally: boolean; cov: number }[] =
    sel === "all"
      ? all.filter(({ v }) => side === "all" || (side === "ally") === (v.team === tl.recorder.team)).map(({ v, h }) => ({ key: v.vid, name: v.name, dmg: h!.damage, w: Math.round(h!.threatWeightedPerDamage * 100) / 100, tw: h!.threatWeighted, mine: v.isRecorder, ally: v.team === tl.recorder.team, cov: h!.coverage }))
      : (() => { const h = all.find((r) => r.v.vid === sel)?.h; if (!h) return []; const by = new Map<number, { dmg: number; w: number }>();
          for (const d of h.hits) { const c = by.get(d.target) ?? { dmg: 0, w: d.threat }; c.dmg += d.amount; by.set(d.target, c); }
          const me = tl.vehicles.find((v) => v.vid === sel)!;
          return [...by].map(([vid, c]) => ({ key: vid, name: nm(vid), dmg: c.dmg, w: c.w, tw: Math.round(c.dmg * c.w), mine: false, ally: tl.vehicles.find((v) => v.vid === vid)?.team === me.team, cov: 1 })); })();
  rows.sort((a, b) => b.tw - a.tw);
  if (!rows.length) return null;
  const mx = Math.max(1, ...rows.map((r) => Math.max(r.dmg, r.tw))), lab = Math.min(120, Math.floor(W * 0.32)), bh = 14, gap = 12, H = rows.length * (bh + gap) + 6;
  const bx = (v: number) => (v / mx) * (W - lab - 110);
  const hiRow = hi == null ? null : rows[hi] ?? null;
  const caption = sel === "all" ? t("viz.targets.sub") : `${nm(sel)} → ${t("viz.target")}`;
  return (
    <figure className="chart">
      <figcaption><b>{t("viz.targets")}</b><span className="muted"> · {caption}</span> <Vote id="chart.targets" /></figcaption>
      <div className="legend"><span><i style={{ background: "var(--c-you)" }} />{t("viz.targets.raw")}</span><span><i style={{ background: "var(--c-ink)" }} />{t("viz.targets.weighted")}</span></div>
      {sel === "all" && <SideSeg value={side} set={setSide} />}
      <label><select className="pick" value={sel} onChange={(e) => { setSel(e.target.value === "all" ? "all" : Number(e.target.value)); setHi(null); }}>
        <option value="all">{t("viz.cmp.allies")} + {t("viz.cmp.enemies")}</option>
        {all.map(({ v }) => <option key={v.vid} value={v.vid}>{v.name}</option>)}
      </select></label>
      <div ref={ref} className="plot" onPointerLeave={() => setHi(null)}>
        <svg width={W} height={H} role="img" aria-label={t("viz.targets.aria")}>
          {rows.map((r, i) => { const yy = 3 + i * (bh + gap);
            return <g key={r.key} opacity={hi == null || hi === i ? 1 : 0.4} onPointerEnter={() => setHi(i)} onPointerDown={() => setHi(i)}>
              <rect x={0} y={yy - gap / 2} width={W} height={bh + gap} fill="transparent" />
              <text x={lab - 8} y={yy + bh - 3} className={`ax lbl${r.mine ? " mine" : ""}`} textAnchor="end">{short(r.name)}</text>
              <rect x={lab} y={yy} width={Math.max(2, bx(r.dmg))} height={bh} rx={4} className={r.ally ? "bup" : "bdn"} />
              <line x1={lab + bx(r.tw)} x2={lab + bx(r.tw)} y1={yy - 3} y2={yy + bh + 3} className="notch" />
              <text x={lab + Math.max(bx(r.dmg), bx(r.tw)) + 8} y={yy + bh - 3} className="ax lbl">{r.dmg} · ×{r.w}</text>
            </g>; })}
        </svg>
        {hiRow && <div className="tip" style={{ right: 0, top: 0 }}><b>{hiRow.name}</b><div>{hiRow.dmg} dmg × {hiRow.w} = {hiRow.tw}</div>{hiRow.cov < 1 && <div className="muted">{t("viz.cmp.seen")}: {Math.round(hiRow.cov * 100)}%</div>}</div>}
      </div>
      <SortTable sortKey="tw" cols={[{ key: "n", label: sel === "all" ? t("viz.player") : t("viz.target"), name: true }, { key: "dmg", label: "dmg" }, { key: "w", label: "×" }, { key: "tw", label: t("viz.targets.weighted") }, ...(sel === "all" ? [{ key: "cov", label: t("viz.cmp.seen") }] : [])]} rows={rows.map((r) => ({ id: r.key, cls: r.mine ? "me" : "", side: r.ally ? "ally" : "foe", cells: { n: { v: r.name, node: <span className="nm">{r.name}</span> }, dmg: { v: r.dmg, node: r.dmg }, w: { v: r.w, node: r.w }, tw: { v: r.tw, node: r.tw }, cov: { v: r.cov, node: `${Math.round(r.cov * 100)}%` } } }))} />
    </figure>
  );
}

type MetricKey = "bold" | "paid" | "costly" | "impact" | "threat" | "onthreats" | "cleanup" | "acc" | "pen" | "life";
type Row = { h: ReturnType<typeof playerHeuristics>; s: ReturnType<typeof playerStats>[number]; b?: ReturnType<typeof boldnessAll> extends Map<number, infer B> ? B : never };
const pct0 = (v: number) => `${v.toFixed(0)}%`;
/** exact = from battle results (all players, no coverage caveat); otherwise from per-hit events (coverage applies). */
const METRICS: { key: MetricKey; label: string; exact: boolean; low?: boolean; get: (r: Row) => number | null; fmt: (v: number) => string }[] = [
  { key: "bold", label: "adv.bold", exact: true, get: (r) => (r.b?.rate == null ? null : r.b.rate * 100), fmt: pct0 },
  { key: "paid", label: "adv.paid", exact: true, get: (r) => (r.b?.rewardedShare == null ? null : r.b.rewardedShare * 100), fmt: pct0 },
  { key: "costly", label: "adv.costly", exact: true, low: true, get: (r) => (r.b?.costlyShare == null ? null : r.b.costlyShare * 100), fmt: pct0 },
  { key: "impact", label: "adv.impact", exact: false, get: (r) => (r.h && r.h.damage > 0 ? r.h.impactPts : null), fmt: (v) => `${sgn(v)} pts` },
  { key: "threat", label: "adv.threat", exact: false, get: (r) => (r.h && r.h.damage > 0 ? r.h.threatWeighted : null), fmt: (v) => String(Math.round(v)) },
  { key: "onthreats", label: "adv.onthreats", exact: false, get: (r) => (r.h && r.h.damage > 0 ? r.h.shareOnThreats * 100 : null), fmt: pct0 },
  { key: "cleanup", label: "adv.cleanup", exact: false, get: (r) => (r.h && r.h.damage > 0 ? r.h.cleanupShare * 100 : null), fmt: pct0 },
  { key: "acc", label: "col.acc", exact: true, get: (r) => (r.s.accuracy == null ? null : r.s.accuracy * 100), fmt: pct0 },
  { key: "pen", label: "col.pen", exact: true, get: (r) => (r.s.penRate == null ? null : r.s.penRate * 100), fmt: pct0 },
  { key: "life", label: "col.life", exact: true, get: (r) => (r.s.lifeShare == null ? null : r.s.lifeShare * 100), fmt: pct0 },
];
const PARTIAL = 0.75;


export function CompareChart({ tl }: { tl: BattleTimeline }) {
  const [ref, W] = useWidth();
  const [mk, setMk] = useState<MetricKey>("bold");
  const [side, setSide] = useState<Side>("all");
  const [z, setZ] = useState(1);
  const all = useMemo(() => { const st = new Map(playerStats(tl).map((x) => [x.vid, x])); const bd = boldnessAll(tl); return tl.vehicles.map((v) => ({ v, h: playerHeuristics(tl, v.vid), s: st.get(v.vid)!, b: bd.get(v.vid) })); }, [tl]);
  const m = METRICS.find((x) => x.key === mk)!;
  const base = all.flatMap((r) => { const val = m.get(r); return val == null ? [] : [{ ...r, val, cov: m.exact ? 1 : r.h?.coverage ?? 0, mine: r.v.isRecorder, ally: r.v.team === tl.recorder.team }]; });
  if (base.length < 2) return null;
  const vals = base.map((r) => r.val);
  const rows = base.map((r) => ({ ...r, pct: percentileRank(vals, r.val) ?? 0 })).sort((a, b) => (m.low ? a.val - b.val : b.val - a.val)); // rank 1 = best for this metric
  const lo = Math.min(0, ...vals), hiV = Math.max(1, ...vals);
  const barW = (v: number) => `${Math.max(0, ((v - lo) / (hiV - lo)) * 100)}%`;
  const teamPos = new Map<number, string>();
  for (const sd of [true, false]) { const grp = rows.filter((r) => r.ally === sd); grp.forEach((r, i) => teamPos.set(r.v.vid, `#${i + 1}/${grp.length}`)); }
  const rank = rows.findIndex((r) => r.mine) + 1, nAlly = rows.filter((r) => r.ally).length, myAllyRank = rows.filter((r) => r.ally).findIndex((r) => r.mine) + 1;
  const sub = rank ? `${t("viz.cmp.you")} #${rank}/${rows.length} · ${t("viz.cmp.allies")} #${myAllyRank}/${nAlly}` : t("viz.cmp.sub");
  const shown = rows.filter((r) => side === "all" || (side === "ally") === r.ally);
  // Strip: x-axis is the same for every zoom level; zoom stretches it and the container scrolls sideways on phones.
  const Wz = Math.max(W, Math.round(W * z)), HS = 100, AX = 84;
  const sx = (v: number) => 10 + ((v - lo) / (hiV - lo || 1)) * (Wz - 20);
  const placed = [...shown].sort((a, b) => sx(a.val) - sx(b.val)).map((r, i) => ({ r, x: sx(r.val), lane: i % 4 }));
  return (
    <figure className="chart">
      <figcaption><b>{t("viz.cmp")}</b><span className="muted"> · {sub}</span> <Vote id="chart.compare" /></figcaption>
      <div className="seg" role="tablist">{METRICS.map((x) => <button key={x.key} role="tab" aria-selected={mk === x.key} onClick={() => setMk(x.key)}>{t(x.label)}</button>)}</div>
      <SideSeg value={side} set={setSide} />
      <SortTable sortKey="val" cols={[{ key: "player", label: t("viz.player"), name: true }, { key: "val", label: t(m.label) }, { key: "pct", label: t("viz.dist.pct") }, { key: "place", label: t("viz.place") }, { key: "seen", label: t("viz.cmp.seen") }]} rows={shown.map((r) => ({ id: r.v.vid, cls: r.mine ? "me" : "", side: r.ally ? "ally" : "foe", cells: { player: { v: r.v.name, node: <>{r.v.name}{r.mine ? ` (${t("report.you")})` : ""}</> }, val: { v: r.val, node: <><span className={`bar ${r.ally ? "bup" : "bdn"}`} style={{ width: barW(r.val), display: "inline-block", height: 8, borderRadius: 4, verticalAlign: "middle", marginRight: 6 }} />{(r.cov < PARTIAL ? "~" : "") + m.fmt(r.val)}</> }, pct: { v: r.pct, node: `${r.pct}%` }, place: { v: teamPos.get(r.v.vid) ?? null, node: teamPos.get(r.v.vid) }, seen: { v: r.cov, node: `${Math.round(r.cov * 100)}%` } } }))} />
      <div className="seg" role="tablist" aria-label={t("viz.zoom")}>{[1, 2, 4, 8].map((k) => <button key={k} role="tab" aria-selected={z === k} onClick={() => setZ(k)}>×{k}</button>)}</div>
      <div ref={ref} className="plot" style={{ overflowX: "auto" }} aria-hidden="true">
        <svg width={Wz} height={HS} role="img" aria-label={t("viz.dist.aria")}>
          <line x1={10} x2={Wz - 10} y1={AX} y2={AX} className="ref" />
          {placed.map(({ r, x, lane }) => { const ly = 12 + lane * 14, col = r.mine ? "var(--c-ink)" : r.ally ? "var(--c-you)" : "var(--c-foe)";
            const lx = Math.min(Math.max(x, 40), Wz - 40), nm = r.v.name.length > 12 ? r.v.name.slice(0, 11) + "…" : r.v.name;
            return <g key={r.v.vid}>
              <line x1={x} x2={x} y1={ly + 3} y2={AX} stroke={col} strokeWidth={1} opacity={0.6} />
              <circle cx={x} cy={AX} r={r.mine ? 5 : 3.5} fill={col} />
              <text x={lx} y={ly} className="ax lbl" textAnchor="middle" style={{ fill: col }}>{nm} {r.pct}%</text>
            </g>; })}
          <text x={10} y={HS - 2} className="ax">{m.fmt(lo)}</text>
          <text x={Wz - 10} y={HS - 2} className="ax" textAnchor="end">{m.fmt(hiV)}</text>
        </svg>
      </div>
      <div className="how-inline"><p><b>{t("gl.how")}.</b> {t(`gl.${mk}.how`)}</p><p><b>{t("gl.mean")}.</b> {t(`gl.${mk}.mean`)}</p></div>
      <p className="fbnote muted" style={{ marginTop: 10 }}>{t("viz.cmp.note")}</p>
    </figure>
  );
}

/** Same aim: for one player, how often each other player's turret pointed within sameDirDeg of theirs while both were alive.
 *  Picking a side shows how coherent that whole side is: each member's mean share with the rest of the side. */
export function AimChart({ tl }: { tl: BattleTimeline }) {
  const [ref, W] = useWidth(); const [who, setWho] = useState<number | "ally" | "enemy">(tl.recorder.vid);
  const samples = useMemo(() => aimSamples(tl, 2), [tl]);
  const allyIds = useMemo(() => tl.vehicles.filter((v) => v.team === tl.recorder.team).map((v) => v.vid), [tl]);
  const foeIds = useMemo(() => tl.vehicles.filter((v) => v.team !== tl.recorder.team).map((v) => v.vid), [tl]);
  const name = (vid: number) => tl.vehicles.find((v) => v.vid === vid)?.name ?? "?";
  const teamMode = who === "ally" || who === "enemy";
  const ids = who === "ally" ? allyIds : who === "enemy" ? foeIds : null;
  const rows = useMemo(() => {
    if (ids) { const c = teamCoherence(samples, ids); return c.members.filter((m) => m.share != null).map((m) => ({ vid: m.vid, share: m.share!, n: 0, gap: null as number | null })).sort((a, b) => b.share - a.share); }
    return tl.vehicles.filter((v) => v.vid !== who).map((v) => ({ v, ...alignWith(samples, who as number, v.vid) })).filter((r) => r.share != null && r.n >= 5)
      .map((r) => ({ vid: r.v.vid, share: r.share!, n: r.n, gap: r.meanGapDeg })).sort((a, b) => b.share - a.share);
  }, [tl, samples, who]); // eslint-disable-line react-hooks/exhaustive-deps
  const teamAvg = { ally: teamCoherence(samples, allyIds).avg, enemy: teamCoherence(samples, foeIds).avg };
  const ally = (vid: number) => tl.vehicles.find((v) => v.vid === vid)?.team === tl.recorder.team;
  const short = (n: string) => (n.length > 14 ? n.slice(0, 13) + "…" : n);
  const lab = Math.min(120, Math.floor(W * 0.32)), bh = 13, gap = 7, H = Math.max(1, rows.length) * (bh + gap) + 4, aw = Math.max(40, W - lab - 60);
  const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);
  return (
    <figure className="chart">
      <figcaption><b>{t("viz.aim")}</b><span className="muted"> · {t("viz.aim.sub")}</span> <Vote id="chart.aim" /></figcaption>
      <p className="muted" style={{ margin: "4px 0" }}>{t("viz.aim.team")}: <b>{t("viz.cmp.allies")} {pct(teamAvg.ally)}</b> · <b>{t("viz.cmp.enemies")} {pct(teamAvg.enemy)}</b></p>
      <label><select className="pick" value={String(who)} onChange={(e) => { const v = e.target.value; setWho(v === "ally" || v === "enemy" ? v : Number(v)); }} aria-label={t("viz.aim.pick")}>
        <option value="ally">{t("viz.cmp.allies")} · {t("viz.aim.team")}</option>
        <option value="enemy">{t("viz.cmp.enemies")} · {t("viz.aim.team")}</option>
        {tl.vehicles.map((v) => <option key={v.vid} value={v.vid}>{v.name}</option>)}
      </select></label>
      {rows.length === 0 ? <p className="muted">{t("viz.aim.none")}</p> : <>
      <div ref={ref} className="plot">
        <svg width={W} height={H} role="img" aria-label={t("viz.aim.aria")}>
          {rows.map((r, i) => { const yy = 2 + i * (bh + gap), wd = Math.max(2, r.share * aw), isAlly = teamMode ? who === "ally" : ally(r.vid);
            return <g key={r.vid}>
              <text x={lab - 8} y={yy + bh - 3} className="ax lbl" textAnchor="end">{short(name(r.vid))}</text>
              <rect x={lab} y={yy} width={wd} height={bh} rx={4} style={{ fill: isAlly ? "var(--c-you)" : "var(--c-foe)" }} />
              <text x={lab + wd + 6} y={yy + bh - 3} className="ax lbl">{Math.round(r.share * 100)}%</text>
            </g>; })}
        </svg>
      </div>
      <SortTable sortKey="share" cols={[{ key: "player", label: t("viz.player"), name: true }, { key: "share", label: t("viz.aim.share") }, ...(teamMode ? [] : [{ key: "gap", label: t("viz.aim.gap") }]), { key: "seen", label: t("viz.cmp.seen") }]} rows={rows.map((r) => ({ id: r.vid, cls: !teamMode && !ally(r.vid) ? "foe" : "", side: ally(r.vid) ? "ally" : "foe", cells: { player: { v: name(r.vid), node: <span className="nm">{name(r.vid)}</span> }, share: { v: r.share, node: `${Math.round(r.share * 100)}%` }, gap: { v: r.gap ?? 0, node: `${Math.round(r.gap ?? 0)}°` }, seen: { v: teamMode ? null : r.n, node: teamMode ? "" : r.n } } }))} /></>}
      <div className="how-inline"><p><b>{t("gl.how")}.</b> {t(teamMode ? "gl.aimteam.how" : "gl.aimsame.how")}</p><p><b>{t("gl.mean")}.</b> {t(teamMode ? "gl.aimteam.mean" : "gl.aimsame.mean")}</p></div>
    </figure>
  );
}

export function HeuristicCharts({ tl }: { tl: BattleTimeline }) {
  return <section className="charts" data-testid="charts"><WpChart tl={tl} /><ImpactChart tl={tl} /><TargetChart tl={tl} /><CompareChart tl={tl} /></section>;
}
