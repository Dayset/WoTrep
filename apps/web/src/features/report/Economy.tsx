import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";

const n = (x: number) => x.toLocaleString();
const minus = (x: number) => `−${n(x)}`;

/** The recorder's battle economy, straight from block 1 `personal` — the
 *  end-screen numbers. Renders nothing when the replay carries no economy
 *  (older timelines, or a results block without `personal`). Totals are the
 *  post-multiplier figures; bases are the pre-multiplier ones. Profit is
 *  derived, not stored: total credits − repair − ammo. Only the recorder has
 *  economy data, so this is not a per-player table. */
export function Economy({ tl }: { tl: BattleTimeline }) {
  const p = tl.results?.personal;
  if (!p || (p.xp == null && p.credits == null)) return null;
  const profit = p.credits != null && p.repairCost != null && p.ammoCost != null
    ? p.credits - p.repairCost - p.ammoCost : null;
  const baseTotal = (base: number | undefined, total: number | undefined) =>
    total == null ? null : base != null ? `${n(base)} → ${n(total)}` : n(total);
  const xpLine = baseTotal(p.xpBase, p.xp), crLine = baseTotal(p.creditsBase, p.credits);
  return (
    <section className="econ" data-testid="economy">
      <b>{t("econ.title")}</b>
      {xpLine && <div>{t("econ.xp")}: {xpLine}</div>}
      {crLine && <div>{t("econ.credits")}: {crLine}
        {p.repairCost != null && <> · {t("econ.repair")} {minus(p.repairCost)}</>}
        {p.ammoCost != null && <> · {t("econ.ammo")} {minus(p.ammoCost)}</>}
        {profit != null && <> · <b>{t("econ.profit")} {profit >= 0 ? n(profit) : minus(-profit)}</b></>}
      </div>}
      <p className="muted">{t("econ.note")}</p>
    </section>
  );
}
