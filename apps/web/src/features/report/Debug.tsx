import { useMemo } from "react";
import type { BattleTimeline } from "@wotrep/model";
import { boldnessAll, configs, estimateReload, playerHeuristics, playerMetrics, shotTimes, wpSeries } from "@wotrep/analysis";

/** Developer view (`?debug=1`): the intermediate values behind the public numbers, like PS2 Elite's debug columns.
 *  English only on purpose: it is a tool for us and for testers who ask, not a player-facing screen. */
export const debugOn = () => { try { return new URLSearchParams(location.search).get("debug") === "1"; } catch { return false; } };

export function Debug({ tl }: { tl: BattleTimeline }) {
  const rows = useMemo(() => {
    const bd = boldnessAll(tl), pm = new Map(playerMetrics(tl).map((p) => [p.vid, p]));
    return tl.vehicles.map((v) => {
      const h = playerHeuristics(tl, v.vid), r = estimateReload(shotTimes(tl, v.vid)), b = bd.get(v.vid)!;
      const w = h && h.hits.length ? h.hits.reduce((s, x) => s + x.threat, 0) / h.hits.length : null;
      return { v, h, r, b, p: pm.get(v.vid)!, w, official: tl.results?.players[v.vid]?.damageDealt ?? 0 };
    });
  }, [tl]);
  const wp = useMemo(() => wpSeries(tl, tl.recorder.team, 60), [tl]);
  const f = (x: number | null | undefined, d = 2) => (x == null ? "—" : x.toFixed(d));
  return (
    <details className="debug" data-testid="debug" open>
      <summary>Debug · hidden values behind the public numbers</summary>
      <h4>Config (value · why)</h4>
      <div className="tablewrap"><table><thead><tr><th>config.key</th><th>value</th><th>why</th></tr></thead><tbody>
        {Object.entries(configs).flatMap(([name, c]) => Object.entries(c as Record<string, { value: unknown; why: string; n?: number; date?: string }>).map(([k, p]) => <tr key={`${name}.${k}`}><td>{name}.{k}</td><td>{String(p.value)}</td><td style={{ whiteSpace: "normal", textAlign: "left" }}>{p.why}{p.date ? ` (${p.date})` : ""}</td></tr>))}
      </tbody></table></div>
      <h4>Per player</h4>
      <div className="tablewrap"><table><thead><tr>{["player", "team", "official dmg", "seen dmg", "coverage", "avg threat w", "dpm", "life min", "shots", "clip", "reload ≥ s", "reload conf", "episodes", "taken", "rewarded", "costly", "flat", "style"].map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>
        {rows.map(({ v, h, r, b, p, w, official }) => <tr key={v.vid} className={v.isRecorder ? "me" : ""}>
          <td className="nm">{v.name}</td><td>{v.team}</td><td>{official}</td><td>{h?.damage ?? "—"}</td><td>{f(h?.coverage)}</td><td>{f(w)}</td><td>{p.dpm}</td><td>{f(p.lifeMin, 1)}</td>
          <td>{r.shots}</td><td>{r.clipSize}</td><td>{f(r.reloadS, 1)}</td><td>{f(r.confidence)}</td><td>{b.episodes}</td><td>{b.taken}</td><td>{b.rewarded}</td><td>{b.costly}</td><td>{b.flat}</td><td>{b.style ?? "—"}</td></tr>)}
      </tbody></table></div>
      <h4>Recorder team win probability, every minute</h4>
      <p className="muted">{wp.t.map((t, i) => `${Math.floor(t / 60)}:00 ${(wp.wp[i]! * 100).toFixed(0)}%`).join(" · ")}</p>
    </details>
  );
}
