import en from "./en.json";
import ru from "./ru.json";

export type Lang = "en" | "ru";
const dict: Record<Lang, Record<string, string>> = { en, ru };
let lang: Lang = "en";
try { const s = localStorage.getItem("lang"); lang = s === "ru" || s === "en" ? s : navigator.language.startsWith("ru") ? "ru" : "en"; } catch { /* storage unavailable */ }

export const getLang = () => lang;
export function setLang(l: Lang) { lang = l; try { localStorage.setItem("lang", l); } catch { /* ignore */ } }
export function t(key: string, params?: Record<string, string | number>): string {
  const s = dict[lang][key] ?? dict.en[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? "")) : s;
}
