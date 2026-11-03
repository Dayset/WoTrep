import { useState } from "react";
import type { BattleTimeline } from "@wotrep/model";
import { Upload } from "../features/upload/Upload";
import { Report } from "../features/report/Report";
import { getLang, setLang, t, type Lang } from "../i18n";
import "./theme.css";

export function App() {
  const [tl, setTl] = useState<BattleTimeline | null>(null);
  const [, bump] = useState(0);
  const [dark, setDark] = useState(true);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const lang = getLang();
  return (
    <>
      <header className="top">
        <h1>WoTrep</h1><span className="tag">{t("app.tagline")}</span>
        {(["en", "ru"] as Lang[]).map((l) => <button key={l} aria-pressed={lang === l} style={{ fontWeight: lang === l ? 700 : 400 }} onClick={() => { setLang(l); bump((n) => n + 1); }}>{l.toUpperCase()}</button>)}
        <button onClick={() => setDark(!dark)} aria-label="theme">{dark ? "☾" : "☀"}</button>
      </header>
      {tl ? <Report tl={tl} onBack={() => setTl(null)} /> : <Upload onDone={setTl} />}
    </>
  );
}
