import { useEffect, useMemo, useRef, useState } from "react";
import type { BattleTimeline, Team, VehicleInfo } from "@wotrep/model";
import { boldnessAll, percentileRank, playerHeuristics, playerStats, recorderHeuristics, wpSeries } from "@wotrep/analysis";
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
      table={<table><thead><tr><th>{t("viz.time")}</th><th>{t("viz.event")}</th><th>WP</th></tr></thead><tbody>{rows.map((r) => <tr key={r.t}><td>{mmss(r.t)}</td><td>{r.text}</td><td>{(r.wp * 100).toFixed(0)}%</td></tr>)}</tbody></table>}>
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
export function ImpactChart({ tl }: { tl: BattleTimeline }) {
  const [ref, W] = useWidth(); const [hi, setHi] = useState<number | null>(null);
  const h = recorderHeuristics(tl); if (!h || !h.hits.length) return null;
  const H = 210, end = tl.arena.durationS ?? h.hits.at(-1)!.t;
  const vals = [0, ...h.hits.flatMap((d) => [d.dWpPts, d.cumPts])];
  const lo = Math.min(...vals), hiV = Math.max(1, ...vals);
  const x = (v: number) => M.l + (v / end) * (W - M.l - M.r), y = (v: number) => M.t + (1 - (v - lo) / (hiV - lo)) * (H - M.t - M.b);
  let path = `M${x(0)},${y(0)}`, last = 0;
  for (const d of h.hits) { path += `L${x(d.t).toFixed(1)},${y(last).toFixed(1)}L${x(d.t).toFixed(1)},${y(d.cumPts).toFixed(1)}`; last = d.cumPts; }
  path += `L${x(end)},${y(last)}`;
  const nm = (vid: number) => tl.vehicles.find((v) => v.vid === vid)?.name ?? "?";
  const hh = hi == null ? null : h.hits[hi]!;
  return (
    <Frame id="chart.impact" title={t("viz.impact")} sub={t("viz.impact.sub")} legend={[["--c-you", t("viz.impact.up")], ["--c-foe", t("viz.impact.down")], ["--c-ink", t("viz.impact.total")]]}
      table={<table><thead><tr><th>{t("viz.time")}</th><th>{t("viz.target")}</th><th>dmg</th><th>×</th><th>Δ WP</th><th>Σ</th></tr></thead><tbody>{h.hits.map((d, i) => <tr key={i}><td>{mmss(d.t)}</td><td>{nm(d.target)}</td><td>{d.amount}</td><td>{d.threat}</td><td>{sgn(d.dWpPts)}</td><td>{sgn(d.cumPts)}</td></tr>)}</tbody></table>}>
      <div ref={ref} className="plot" onPointerLeave={() => setHi(null)}>
        <svg width={W} height={H} role="img" aria-label={t("viz.impact.aria")}>
          {[...new Set([lo, 0, hiV])].map((v) => <g key={v}><line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className={v === 0 ? "ref" : "grid"} /><text x={M.l - 6} y={y(v) + 4} className="ax" textAnchor="end">{v === 0 ? "0" : sgn(v)}</text></g>)}
          {Array.from({ length: Math.floor(end / 120) + 1 }, (_, i) => i * 120).map((v) => <text key={v} x={x(v)} y={H - 6} className="ax" textAnchor="middle">{mmss(v)}</text>)}
          {h.hits.map((d, i) => { const top = Math.min(y(0), y(d.dWpPts)), hgt = Math.max(2, Math.abs(y(d.dWpPts) - y(0)));
            return <rect key={i} x={x(d.t) - 2.5} width={5} y={top} height={hgt} rx={2} className={d.dWpPts >= 0 ? "bup" : "bdn"} opacity={hi == null || hi === i ? 1 : 0.35} />; })}
          <path d={path} className="cumline" />
          {h.hits.map((d, i) => <rect key={i} x={x(d.t) - 9} width={18} y={M.t} height={H - M.t - M.b} fill="transparent" onPointerEnter={() => setHi(i)} onPointerDown={() => setHi(i)} />)}
        </svg>
        {hh && <div className="tip" style={{ left: Math.min(Math.max(x(hh.t) - 80, 0), W - 170) }}>
          <b>{mmss(hh.t)}</b> · {nm(hh.target)}<div>{hh.amount} dmg · ×{hh.threat}</div><div>Δ WP {sgn(hh.dWpPts)} · Σ {sgn(hh.cumPts)}</div>
        </div>}
      </div>
    </Frame>
  );
}

/** Chart 3 — damage by target; bar length is raw damage, the notch is threat-weighted damage. */
export function TargetChart({ tl }: { tl: BattleTimeline }) {
  const [ref, W] = useWidth(); const [hi, setHi] = useState<number | null>(null);
  const h = recorderHeuristics(tl); if (!h || !h.hits.length) return null;
  const by = new Map<number, { dmg: number; w: number }>();
  for (const d of h.hits) { const c = by.get(d.target) ?? { dmg: 0, w: d.threat }; c.dmg += d.amount; by.set(d.target, c); }
  const rows = [...by].map(([vid, c]) => ({ vid, ...c, tw: Math.round(c.dmg * c.w), name: tl.vehicles.find((v) => v.vid === vid)?.name ?? "?" })).sort((a, b) => b.tw - a.tw);
  const mx = Math.max(...rows.map((r) => Math.max(r.dmg, r.tw))), lab = Math.min(120, Math.floor(W * 0.32)), bh = 14, gap = 12, H = rows.length * (bh + gap) + 6;
  const bx = (v: number) => (v / mx) * (W - lab - 110);
  return (
    <Frame id="chart.targets" title={t("viz.targets")} sub={t("viz.targets.sub")} legend={[["--c-you", t("viz.targets.raw")], ["--c-ink", t("viz.targets.weighted")]]}
      table={<table><thead><tr><th>{t("viz.target")}</th><th>dmg</th><th>×</th><th>{t("viz.targets.weighted")}</th></tr></thead><tbody>{rows.map((r) => <tr key={r.vid}><td className="nm">{r.name}</td><td>{r.dmg}</td><td>{r.w}</td><td>{r.tw}</td></tr>)}</tbody></table>}>
      <div ref={ref} className="plot" onPointerLeave={() => setHi(null)}>
        <svg width={W} height={H} role="img" aria-label={t("viz.targets.aria")}>
          {rows.map((r, i) => { const yy = 3 + i * (bh + gap);
            return <g key={r.vid} opacity={hi == null || hi === i ? 1 : 0.4} onPointerEnter={() => setHi(i)} onPointerDown={() => setHi(i)}>
              <rect x={0} y={yy - gap / 2} width={W} height={bh + gap} fill="transparent" />
              <text x={lab - 8} y={yy + bh - 3} className="ax lbl" textAnchor="end">{r.name.length > 14 ? r.name.slice(0, 13) + "…" : r.name}</text>
              <rect x={lab} y={yy} width={Math.max(2, bx(r.dmg))} height={bh} rx={4} className="bup" />
              <line x1={lab + bx(r.tw)} x2={lab + bx(r.tw)} y1={yy - 3} y2={yy + bh + 3} className="notch" />
              <text x={lab + Math.max(bx(r.dmg), bx(r.tw)) + 8} y={yy + bh - 3} className="ax lbl">{r.dmg} · ×{r.w}</text>
            </g>; })}
        </svg>
        {hi != null && <div className="tip" style={{ right: 0, top: 0 }}><b>{rows[hi]!.name}</b><div>{rows[hi]!.dmg} dmg × {rows[hi]!.w} = {rows[hi]!.tw}</div></div>}
      </div>
    </Frame>
  );
}


type MetricKey = "bold" | "paid" | "costly" | "impact" | "threat" | "onthreats" | "cleanup" | "acc" | "pen" | "life";
type Row = { h: ReturnType<typeof playerHeuristics>; s: ReturnType<typeof playerStats>[number]; b?: ReturnType<typeof boldnessAll> extends Map<number, infer B> ? B : never };
const pct0 = (v: number) => `${v.toFixed(0)}%`;
/** exact = from battle results (all players, no coverage caveat); otherwise from per-hit events (coverage applies). */
const METRICS: { key: MetricKey; label: string; exact: boolean; get: (r: Row) => number | null; fmt: (v: number) => string }[] = [
  { key: "bold", label: "adv.bold", exact: true, get: (r) => (r.b?.rate == null ? null : r.b.rate * 100), fmt: pct0 },
  { key: "paid", label: "adv.paid", exact: true, get: (r) => (r.b?.rewardedShare == null ? null : r.b.rewardedShare * 100), fmt: pct0 },
  { key: "costly", label: "adv.costly", exact: true, get: (r) => (r.b?.costlyShare == null ? null : r.b.costlyShare * 100), fmt: pct0 },
  { key: "impact", label: "adv.impact", exact: false, get: (r) => (r.h && r.h.damage > 0 ? r.h.impactPts : null), fmt: (v) => `${sgn(v)} pts` },
  { key: "threat", label: "adv.threat", exact: false, get: (r) => (r.h && r.h.damage > 0 ? r.h.threatWeighted : null), fmt: (v) => String(Math.round(v)) },
  { key: "onthreats", label: "adv.onthreats", exact: false, get: (r) => (r.h && r.h.damage > 0 ? r.h.shareOnThreats * 100 : null), fmt: pct0 },
  { key: "cleanup", label: "adv.cleanup", exact: false, get: (r) => (r.h && r.h.damage > 0 ? r.h.cleanupShare * 100 : null), fmt: pct0 },
  { key: "acc", label: "col.acc", exact: true, get: (r) => (r.s.accuracy == null ? null : r.s.accuracy * 100), fmt: pct0 },
  { key: "pen", label: "col.pen", exact: true, get: (r) => (r.s.penRate == null ? null : r.s.penRate * 100), fmt: pct0 },
  { key: "life", label: "col.life", exact: true, get: (r) => (r.s.lifeShare == null ? null : r.s.lifeShare * 100), fmt: pct0 },
];
const PARTIAL = 0.75;

/** Chart 4 — the same numbers for all players, so your result has something to be relative to. */
export function CompareChart({ tl }: { tl: BattleTimeline }) {
  const [ref, W] = useWidth(); const [hi, setHi] = useState<number | null>(null); const [mk, setMk] = useState<MetricKey>("bold");
  const all = useMemo(() => { const st = new Map(playerStats(tl).map((x) => [x.vid, x])); const bd = boldnessAll(tl); return tl.vehicles.map((v) => ({ v, h: playerHeuristics(tl, v.vid), s: st.get(v.vid)!, b: bd.get(v.vid) })); }, [tl]);
  const m = METRICS.find((x) => x.key === mk)!;
  const rows = all.flatMap((r) => { const val = m.get(r); return val == null ? [] : [{ ...r, val, cov: m.exact ? 1 : r.h?.coverage ?? 0, mine: r.v.isRecorder, ally: r.v.team === tl.recorder.team }]; }).sort((a, b) => b.val - a.val);
  if (rows.length < 2) return null;
  const lo = Math.min(0, ...rows.map((r) => r.val)), hiV = Math.max(1, ...rows.map((r) => r.val));
  const lab = Math.min(120, Math.floor(W * 0.32)), bh = 13, gap = 7, H = rows.length * (bh + gap) + 4, aw = W - lab - 78;
  const bx = (v: number) => ((v - lo) / (hiV - lo)) * aw, zero = bx(0);
  const rank = rows.findIndex((r) => r.mine) + 1, nAlly = rows.filter((r) => r.ally).length, myAllyRank = rows.filter((r) => r.ally).findIndex((r) => r.mine) + 1;
  const sub = rank ? `${t("viz.cmp.you")} #${rank}/${rows.length} · ${t("viz.cmp.allies")} #${myAllyRank}/${nAlly}` : "";
  return (
    <Frame id="chart.compare" title={t("viz.cmp")} sub={sub || t("viz.cmp.sub")}
      legend={[["--c-you", t("viz.cmp.allies")], ["--c-foe", t("viz.cmp.enemies")]]}
      table={<table><thead><tr><th>{t("viz.player")}</th><th>{t(m.label)}</th><th>{t("viz.cmp.seen")}</th></tr></thead><tbody>{rows.map((r) => <tr key={r.v.vid} className={r.mine ? "me" : ""}><td className="nm">{r.v.name}</td><td>{m.fmt(r.val)}</td><td>{Math.round(r.cov * 100)}%</td></tr>)}</tbody></table>}>
      <div className="seg" role="tablist">{METRICS.map((x) => <button key={x.key} role="tab" aria-selected={mk === x.key} onClick={() => setMk(x.key)}>{t(x.label)}</button>)}</div>
      <div ref={ref} className="plot" onPointerLeave={() => setHi(null)}>
        <svg width={W} height={H} role="img" aria-label={t("viz.cmp.aria")}>
          <line x1={lab + zero} x2={lab + zero} y1={0} y2={H} className="ref" />
          {rows.map((r, i) => { const yy = 2 + i * (bh + gap), partial = r.cov < PARTIAL, x0 = Math.min(zero, bx(r.val)), wd = Math.max(2, Math.abs(bx(r.val) - zero));
            const nm = r.v.name.length > 14 ? r.v.name.slice(0, 13) + "…" : r.v.name;
            return <g key={r.v.vid} opacity={hi == null || hi === i ? 1 : 0.4} onPointerEnter={() => setHi(i)} onPointerDown={() => setHi(i)}>
              <rect x={0} y={yy - gap / 2} width={W} height={bh + gap} fill="transparent" />
              <text x={lab - 8} y={yy + bh - 3} className={`ax lbl${r.mine ? " mine" : ""}`} textAnchor="end">{nm}</text>
              <rect x={lab + x0} y={yy} width={wd} height={bh} rx={4} className={r.ally ? "bup" : "bdn"} opacity={partial ? 0.5 : 1} strokeDasharray={partial ? "3 2" : undefined} stroke={r.mine ? "var(--c-ink)" : partial ? (r.ally ? "var(--c-you)" : "var(--c-foe)") : "none"} strokeWidth={r.mine ? 2 : 1} />
              <text x={lab + Math.max(bx(r.val), zero) + 6} y={yy + bh - 3} className="ax lbl">{partial ? "~" : ""}{m.fmt(r.val)}</text>
            </g>; })}
        </svg>
        {hi != null && <div className="tip" style={{ right: 0, top: 0 }}><b>{rows[hi]!.v.name}</b>{rows[hi]!.mine ? ` (${t("report.you")})` : ""}<div>{m.fmt(rows[hi]!.val)}</div>{!m.exact && <div className="muted">{t("viz.cmp.seen")}: {Math.round(rows[hi]!.cov * 100)}%</div>}</div>}
      </div>
      <div className="how-inline"><p><b>{t("gl.how")}.</b> {t(`gl.${mk}.how`)}</p><p><b>{t("gl.mean")}.</b> {t(`gl.${mk}.mean`)}</p></div>
      <p className="fbnote muted" style={{ marginTop: 10 }}>{t("viz.cmp.note")}</p>
    </Frame>
  );
}

const PALETTE = ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4", "#42d4f4", "#f032e6"];

/** Chart 5 — one metric's distribution across all players: every player is a dot on the value axis, each picked player
 *  gets a coloured line at their value, labelled with name and percentile (share of players at or below). Percentiles are
 *  within this battle's players only — there is no global baseline yet (see E11-04). */
export function DistChart({ tl }: { tl: BattleTimeline }) {
  const [ref, W] = useWidth(); const [mk, setMk] = useState<MetricKey>("bold"); const [hi, setHi] = useState<number | null>(null);
  const [sel, setSel] = useState<number[]>([tl.recorder.vid]);
  const all = useMemo(() => { const st = new Map(playerStats(tl).map((x) => [x.vid, x])); const bd = boldnessAll(tl); return tl.vehicles.map((v) => ({ v, h: playerHeuristics(tl, v.vid), s: st.get(v.vid)!, b: bd.get(v.vid) })); }, [tl]);
  const m = METRICS.find((x) => x.key === mk)!;
  const rows = all.flatMap((r) => { const val = m.get(r); return val == null ? [] : [{ ...r, val, cov: m.exact ? 1 : r.h?.coverage ?? 0 }]; });
  if (rows.length < 2) return null;
  const vals = rows.map((r) => r.val), lo = Math.min(...vals), hiV = Math.max(...vals);
  const x = (v: number) => 10 + (hiV === lo ? 0.5 : (v - lo) / (hiV - lo)) * (W - 20);
  const picked = sel.flatMap((vid, i) => { const r = rows.find((y) => y.v.vid === vid); return r ? [{ ...r, color: PALETTE[i % PALETTE.length]!, pct: percentileRank(vals, r.val)! }] : []; });
  const H = 116, axisY = 84;
  const toggle = (vid: number) => setSel((s) => s.includes(vid) ? s.filter((v) => v !== vid) : s.length >= PALETTE.length ? s : [...s, vid]);
  const nm = (v: { name: string }) => v.name.length > 14 ? v.name.slice(0, 13) + "…" : v.name;
  const hov = hi == null ? null : picked.find((p) => p.v.vid === hi) ?? null;
  const box = (label: string, vs: VehicleInfo[]) => (
    <div><b>{label}</b> {[...vs].sort((a, b) => a.name.localeCompare(b.name)).map((v) => {
      const i = sel.indexOf(v.vid);
      return <label key={v.vid} style={{ whiteSpace: "nowrap" }}><input type="checkbox" checked={i >= 0} disabled={i < 0 && sel.length >= PALETTE.length} onChange={() => toggle(v.vid)} />{i >= 0 && <i style={{ display: "inline-block", width: 10, height: 10, background: PALETTE[i % PALETTE.length]! }} />} {v.name}</label>;
    })}</div>
  );
  return (
    <Frame id="chart.dist" title={t("viz.dist")} sub={t("viz.dist.sub")}
      table={<table><thead><tr><th>{t("viz.player")}</th><th>{t(m.label)}</th><th>{t("viz.dist.pct")}</th><th>{t("viz.cmp.seen")}</th></tr></thead><tbody>{picked.map((r) => <tr key={r.v.vid}><td className="nm">{r.v.name}</td><td>{m.fmt(r.val)}</td><td>{r.pct}%</td><td>{Math.round(r.cov * 100)}%</td></tr>)}</tbody></table>}>
      <div className="seg" role="tablist">{METRICS.map((y) => <button key={y.key} role="tab" aria-selected={mk === y.key} onClick={() => setMk(y.key)}>{t(y.label)}</button>)}</div>
      <div><b>{t("viz.dist.pick")}</b> {box(t("viz.cmp.allies"), tl.vehicles.filter((v) => v.team === tl.recorder.team))} {box(t("viz.cmp.enemies"), tl.vehicles.filter((v) => v.team !== tl.recorder.team))}</div>
      <div ref={ref} className="plot" onPointerLeave={() => setHi(null)}>
        <svg width={W} height={H} role="img" aria-label={t("viz.dist.aria")}>
          <line x1={10} x2={W - 10} y1={axisY} y2={axisY} className="ref" />
          {rows.map((r) => <circle key={r.v.vid} cx={x(r.val)} cy={axisY} r={3} fill="#888" opacity={0.7} />)}
          {picked.map((p, i) => { const lx = Math.min(Math.max(x(p.val), 46), W - 46), ly = 12 + (i % 3) * 16;
            return <g key={p.v.vid} opacity={hi == null || hi === p.v.vid ? 1 : 0.35} onPointerEnter={() => setHi(p.v.vid)} onPointerDown={() => setHi(p.v.vid)}>
              <line x1={x(p.val)} x2={x(p.val)} y1={axisY} y2={ly + 10} stroke={p.color} strokeWidth={2} />
              <circle cx={x(p.val)} cy={axisY} r={5} fill={p.color} />
              <text x={lx} y={ly} className="ax lbl" textAnchor="middle" style={{ fill: p.color }}>{nm(p.v)} {p.pct}%</text>
            </g>; })}
          <text x={10} y={axisY + 18} className="ax">{m.fmt(lo)}</text>
          <text x={W - 10} y={axisY + 18} className="ax" textAnchor="end">{m.fmt(hiV)}</text>
        </svg>
        {hov && <div className="tip" style={{ left: Math.min(Math.max(x(hov.val) - 80, 0), W - 170) }}>
          <b>{hov.v.name}</b><div>{m.fmt(hov.val)} · {hov.pct}%</div>{!m.exact && <div className="muted">{t("viz.cmp.seen")}: {Math.round(hov.cov * 100)}%</div>}
        </div>}
      </div>
    </Frame>
  );
}

export function HeuristicCharts({ tl }: { tl: BattleTimeline }) {
  return <section className="charts" data-testid="charts"><WpChart tl={tl} /><ImpactChart tl={tl} /><TargetChart tl={tl} /><CompareChart tl={tl} /></section>;
}
