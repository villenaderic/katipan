import { useCallback, useMemo } from 'react';

import { useSettingsStore } from '../store/settingsStore';
import type { LangCode } from '../types';
import { en } from './en';
import { fil } from './fil';

/**
 * Interface text for Katipan, in English and Filipino. No library: two flat
 * dictionaries and a small function, which keeps the app small and fast.
 *
 *  - Keys are plain dotted strings such as "more.reminder". They are built in
 *    a few places (for example `appearance.theme.${name}`), so the key type is
 *    a string and not a closed list.
 *  - Values may contain {name} placeholders. t('read.goTo', { reference }) fills
 *    them in. A placeholder with no value is left as it is, so a mistake is
 *    visible on screen rather than blank.
 *  - A key missing from the Filipino file falls back to English. A key missing
 *    from both shows the key itself, so a gap is easy to spot while testing.
 *
 * Bible book names and verse references are not here: they come from
 * constants/books.ts and utils/reference.ts.
 */

export type TranslateParams = Readonly<Record<string, string | number>>;
export type Translate = (key: string, params?: TranslateParams) => string;

const DICTIONARIES: Readonly<Record<LangCode, Readonly<Record<string, string>>>> = {
  en,
  fil,
};

const PLACEHOLDER = /\{(\w+)\}/g;

/** Look up one string and fill in its placeholders. Safe to call outside React. */
export function translate(lang: LangCode, key: string, params?: TranslateParams): string {
  const text = DICTIONARIES[lang][key] ?? en[key] ?? key;
  if (!params) return text;

  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** A translate function fixed to one language, for services and background tasks. */
export function getTranslator(lang: LangCode): Translate {
  return (key, params) => translate(lang, key, params);
}

export interface UseI18n {
  /** The language of the interface right now. */
  lang: LangCode;
  t: Translate;
}

/**
 * The translate function for the current interface language. It changes
 * identity only when the language changes, so screens that list `t` in a hook
 * dependency list do not redo work on every render.
 */
export function useI18n(): UseI18n {
  const lang = useSettingsStore((state) => state.settings.uiLanguage);
  const t = useCallback<Translate>((key, params) => translate(lang, key, params), [lang]);
  return useMemo(() => ({ lang, t }), [lang, t]);
}
