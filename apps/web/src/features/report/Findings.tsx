import type { Finding } from "@wotrep/coach";
import { t } from "../../i18n";

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const costText = (f: Finding) => [
  f.cost.hp != null && f.cost.hp > 0 ? t("coach.cost.hp", { n: Math.round(f.cost.hp) }) : "",
  f.cost.damageMissed ? t("coach.cost.dmg", { n: Math.round(f.cost.damageMissed) }) : "",
  f.cost.winProbDelta ? t("coach.cost.wp", { n: `${f.cost.winProbDelta > 0 ? "+" : "−"}${Math.abs(f.cost.winProbDelta * 100).toFixed(1)}` }) : "",
].filter(Boolean).join(" · ");

export function FindingCard({ f, onShow, actions }: { f: Finding; onShow?: () => void; actions?: React.ReactNode }) {
  const tag = f.kind === "mistake" ? t("coach.mistake") : f.kind === "good" ? t("coach.good") : t("coach.info");
  return (
    <article className={`finding ${f.kind}`} data-testid="finding">
      <header><span className="ftag">{f.kind === "mistake" ? "! " : f.kind === "good" ? "✓ " : "i "}{tag}</span> <span className="muted">{t("coach.at")} {mmss(f.tStart)}</span>{f.confidence < 0.5 && <span className="muted"> · {t("coach.uncertain")}</span>}</header>
      <h4>{t(`${f.messageKey}.title`, f.params)}</h4>
      <p>{t(`${f.messageKey}.body`, f.params)}</p>
      {costText(f) && <p className="cost">{costText(f)}</p>}
      <p className="fix"><b>{f.kind === "mistake" ? t("coach.fix") : t("coach.note")}:</b> {t(`${f.messageKey}.fix`, f.params)}</p>
      <div className="factions">{onShow && <button type="button" onClick={onShow}>{t("coach.show")}</button>}{actions}</div>
    </article>
  );
}

export function FindingsPanel({ findings, checks, onShow }: { findings: Finding[]; checks: number; onShow: (f: Finding) => void }) {
  return (
    <section className="coach" data-testid="coach">
      {findings.length === 0 ? <p className="muted">{t("coach.none", { n: checks })}</p> : <div className="fgrid">{findings.map((f) => <FindingCard key={f.id} f={f} onShow={() => onShow(f)} />)}</div>}
    </section>
  );
}
