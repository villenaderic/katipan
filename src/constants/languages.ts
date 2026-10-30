import type { LangCode } from '../types';

export interface UiLanguage {
  code: LangCode;
  /** Name in its own language. */
  nativeName: string;
}

export const UI_LANGUAGES: readonly UiLanguage[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'fil', nativeName: 'Filipino' },
];

export interface PackLanguage {
  /** ISO 639 code used in pack meta and manifest. */
  code: string;
  nativeName: string;
  /** True when the pack ships inside the APK. */
  atLaunch: boolean;
}

/** Bible text languages. Only en and fil ship at launch; the rest are downloadable later. */
export const PACK_LANGUAGES: readonly PackLanguage[] = [
  { code: 'en', nativeName: 'English', atLaunch: true },
  { code: 'fil', nativeName: 'Filipino', atLaunch: true },
  { code: 'ilo', nativeName: 'Ilokano', atLaunch: false },
  { code: 'ceb', nativeName: 'Cebuano', atLaunch: false },
  { code: 'ibg', nativeName: 'Ibanag', atLaunch: false },
  { code: 'es', nativeName: 'Español', atLaunch: false },
];

export function isUiLanguage(value: string): value is LangCode {
  return value === 'en' || value === 'fil';
}
