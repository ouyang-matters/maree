// Gettext-style localisation: the English source string is the key, so untranslated
// strings fall back to English automatically. Add a language by adding a dictionary.

import { fr } from "./fr";
import { zh } from "./zh";

export type Locale = "en" | "fr" | "zh";

export const LOCALES: { id: Locale; label: string; complete: boolean }[] = [
  { id: "en", label: "English", complete: true },
  { id: "fr", label: "Français (partial)", complete: false },
  { id: "zh", label: "中文 (partial)", complete: false },
];

const DICTS: Record<Locale, Record<string, string>> = { en: {}, fr, zh };

let locale: Locale = "en";

export function setLocale(l: Locale): void {
  locale = DICTS[l] ? l : "en";
  document.documentElement.lang = locale === "zh" ? "zh-Hans" : locale;
}

export function getLocale(): Locale {
  return locale;
}

/** Translates `text`, substituting `{name}` placeholders. */
export function t(text: string, vars?: Record<string, string | number>): string {
  let s = DICTS[locale][text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

const DATE_LOCALE: Record<Locale, string> = { en: "en-US", fr: "fr-FR", zh: "zh-CN" };

/** Dates follow the application language, not the operating system's region. */
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" && d.length === 10 ? new Date(`${d}T00:00:00`) : new Date(d);
  return date.toLocaleDateString(DATE_LOCALE[locale], { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleString(DATE_LOCALE[locale], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleTimeString(DATE_LOCALE[locale], { hour: "2-digit", minute: "2-digit" });
}

/** Simple English plural: plural(3, "problem") → "3 problems". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${t(n === 1 ? singular : pluralForm)}`;
}
