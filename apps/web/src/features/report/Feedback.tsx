import { useState } from "react";
import { t } from "../../i18n";

const KEY = "wotrep.feedback.v1";
type Votes = Record<string, 1 | -1>;
const load = (): Votes => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Votes; } catch { return {}; } };
const save = (v: Votes) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable: vote lives in memory only */ } };

/** 👍/👎 per heuristic. Stored only in this browser; "Copy" exports votes (metric ids only, no replay data or names). */
export function Vote({ id }: { id: string }) {
  const [votes, setVotes] = useState<Votes>(load);
  const cast = (x: 1 | -1) => { const n = { ...load() }; if (n[id] === x) delete n[id]; else n[id] = x; setVotes(n); save(n); };
  const cur = votes[id];
  return (
    <span className="vote" role="group" aria-label={t("fb.q")}>
      <button type="button" aria-pressed={cur === 1} aria-label={t("fb.up")} title={t("fb.up")} onClick={() => cast(1)}>👍</button>
      <button type="button" aria-pressed={cur === -1} aria-label={t("fb.down")} title={t("fb.down")} onClick={() => cast(-1)}>👎</button>
    </span>
  );
}

export function FeedbackExport() {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const payload = JSON.stringify({ app: "wotrep", v: 1, votes: load() }, null, 2);
    try { await navigator.clipboard.writeText(payload); setDone(true); setTimeout(() => setDone(false), 2000); } catch { window.prompt(t("fb.copy"), payload); }
  };
  return <p className="fbnote muted">{t("fb.note")} <button type="button" onClick={copy}>{done ? t("fb.copied") : t("fb.copy")}</button></p>;
}
