import { useEffect, useMemo, useRef, useState } from "react";
import { vehicleLabel } from "@wotrep/gamedata";
import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";

interface Row { t: number; attacker: number | null; target: number; amount: number; hpAfter: number | null; kill: boolean }
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Damage and kill feed, as the replay recorded it (docs/COACHING.md, #54). Click a row to jump there; the row at the playhead is highlighted. */
export function DamageLog({ tl, now, onSeek }: { tl: BattleTimeline; now: number; onSeek: (t: number) => void }) {
  const [mine, setMine] = useState(false), box = useRef<HTMLDivElement>(null), me = tl.recorder.vid;
  const vehicle = useMemo(() => new Map(tl.vehicles.map((v) => [v.vid, v])), [tl]);
  const { rows, coverage } = useMemo(() => {
    const out: Row[] = []; let seen = 0;
    for (const e of tl.events) if (e.k === "damage" && e.amount > 0) { out.push({ t: e.t, attacker: e.attacker, target: e.target, amount: e.amount, hpAfter: e.hpAfter, kill: e.hpAfter <= 0 }); seen += e.amount; }
    for (const e of tl.events) if (e.k === "kill") {
      const hit = out.find((r) => r.target === e.victim && r.kill && Math.abs(r.t - e.t) <= 1.5);
      if (!hit) out.push({ t: e.t, attacker: e.killer || null, target: e.victim, amount: 0, hpAfter: 0, kill: true });
    }
    out.sort((a, b) => a.t - b.t);
    const official = tl.results ? Object.values(tl.results.players).reduce((s, p) => s + (p.damageDealt || 0), 0) : 0;
    return { rows: out, coverage: official > 0 ? Math.min(1, seen / official) : null };
  }, [tl]);
  const shown = mine ? rows.filter((r) => r.attacker === me || r.target === me) : rows;
  const cur = shown.reduce((a, r, i) => (r.t <= now ? i : a), -1);
  useEffect(() => { const el = box.current?.querySelector<HTMLElement>(`[data-i="${cur}"]`); if (el && box.current) box.current.scrollTop = el.offsetTop - box.current.clientHeight / 2; }, [cur]);
  const name = (vid: number | null) => { const v = vid == null ? undefined : vehicle.get(vid); return v ? <span className={v.team === tl.recorder.team ? "ally" : "enemy"} title={vehicleLabel(v.vehicleType).label}>{v.name}</span> : <span className="muted">?</span>; };
  return (
    <div className="dlog" data-testid="dlog" onPointerDown={(e) => e.stopPropagation()}>
      <div className="dlogbar"><b>{t("log.title")}</b><button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>{t("log.all")}</button><button type="button" aria-pressed={mine} onClick={() => setMine(true)}>{t("log.me")}</button></div>
      <div className="dlogrows" ref={box}>
        {shown.length === 0 && <p className="muted">{t("log.empty")}</p>}
        {shown.map((r, i) => (
          <button type="button" key={i} data-i={i} className={`dlogrow${i === cur ? " cur" : ""}${r.t > now ? " future" : ""}${r.attacker === me || r.target === me ? " mine" : ""}`} onClick={() => onSeek(Math.max(0, r.t - 3))}>
            <span className="dt">{mmss(r.t)}</span><span className="dwho">{name(r.attacker)} → {name(r.target)}</span>
            <span className="dn">{r.amount > 0 ? `−${r.amount}` : ""}{r.kill ? " ☠" : r.hpAfter != null ? ` · ${r.hpAfter}` : ""}</span>
          </button>
        ))}
      </div>
      <p className="muted dlognote">{t("log.note")}{coverage != null ? ` ${t("log.coverage", { p: Math.round(coverage * 100) })}` : ""}</p>
    </div>
  );
}
