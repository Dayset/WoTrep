import { useState } from "react";
import type { BattleTimeline } from "@wotrep/model";
import { Upload } from "../features/upload/Upload";
import { Report } from "../features/report/Report";
import { getLang, setLang, t } from "../i18n";
import "./theme.css";

export function App() {
  const [tl, setTl] = useState<BattleTimeline | null>(null);
  const [, bump] = useState(0);
  const [dark, setDark] = useState(true);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const lang = getLang();
  return (
    <div className={tl ? "app wide" : "app"}>
      <header className="top">
        <h1>WoTrep</h1><span className="tag">{t("app.tagline")}</span>
        <button type="button" className="sm" onClick={() => { setLang(lang === "en" ? "ru" : "en"); bump((n) => n + 1); }} aria-label={lang === "en" ? "Русский" : "English"} title={lang === "en" ? "Русский" : "English"}>{lang === "en" ? "RU" : "EN"}</button>
        <button type="button" className="sm" onClick={() => setDark(!dark)} aria-label="theme">{dark ? "☾" : "☀"}</button>
      </header>
      {tl ? <Report tl={tl} onBack={() => setTl(null)} /> : <Upload onDone={setTl} />}
    </div>
  );
}
