import { useMemo } from "react";
import { coverage } from "@wotrep/analysis";
import type { BattleTimeline } from "@wotrep/model";
import { t } from "../../i18n";

const pc = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
/** How complete this replay's data is, so every number below can be read with the right trust (docs/METRICS.md §3.14). */
export function CoverageBadge({ tl }: { tl: BattleTimeline }) {
  const c = useMemo(() => coverage(tl), [tl]);
  return (
    <details className={`covbadge ${c.level}`} data-testid="coverage">
      <summary><b>{t("cov.title")}</b> · {t(`cov.${c.level}`)}</summary>
      <ul>
        <li>{t("cov.damage")}: {pc(c.damage)}</li><li>{t("cov.shots")}: {pc(c.shots)}</li>
        <li>{t("cov.own")}: {pc(c.ownSeen)}</li><li>{t("cov.enemy")}: {pc(c.enemySeen)}</li>
        <li>{t("cov.kills")}: {c.killsDerived ? t("cov.kills.derived") : t("cov.kills.decoded")}</li>
      </ul>
      <p>{t("cov.how")}</p><p>{t("cov.mean")}</p>
    </details>
  );
}
