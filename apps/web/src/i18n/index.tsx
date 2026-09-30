import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { en } from './en.js';
import * as exchange from './extra-exchange.js';
import * as login from './extra-login.js';
import * as notifications from './extra-notifications.js';
import * as security from './extra-security.js';
import { extraEn, extraTh } from './extra.js';
import { th } from './th.js';

export type Lang = 'en' | 'th';

const dictionaries: Record<Lang, Record<string, string>> = {
  en: { ...en, ...extraEn, ...login.en, ...exchange.en, ...notifications.en, ...security.en },
  th: { ...th, ...extraTh, ...login.th, ...exchange.th, ...notifications.th, ...security.th },
};

/** Fills `{name}` placeholders; a missing value leaves the placeholder as is. */
export function format(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

/** English is the fallback; a key that is in neither dictionary shows as the key itself. */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  return format(dictionaries[lang][key] ?? dictionaries.en[key] ?? key, vars);
}

interface I18n {
  lang: Lang;
  setLang(lang: Lang): void;
  t(key: string, vars?: Record<string, string | number>): string;
}

const Ctx = createContext<I18n | null>(null);
const STORAGE_KEY = 'cane.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'th') return saved;
  } catch {
    /* storage blocked: fall through */
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('th') ? 'th' : 'en';
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initial ?? initialLang());
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked: the choice lasts until reload */
    }
    document.documentElement.lang = next;
  }, []);
  const value = useMemo<I18n>(() => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n needs an I18nProvider');
  return v;
}
