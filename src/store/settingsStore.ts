import { getLocales } from 'expo-localization';
import { create } from 'zustand';

import { DEFAULT_SETTINGS, DEFAULT_TRANSLATION } from '../constants/config';
import { getUserDb, isValidPackId } from '../db/client';
import { loadStoredSettings, saveSetting } from '../db/queries/user';
import { THEME_NAMES } from '../theme/themes';
import type {
  FontFamilyChoice,
  LangCode,
  Settings,
  ThemeName,
  UpdateMode,
} from '../types';
import { formatTimeOfDay, parseTimeOfDay } from '../utils/date';
import { snapFontSize, snapLineHeight } from '../utils/format';

/**
 * Every setting the person can change, kept in memory for instant reads and
 * saved to the settings table of user.db.
 *
 *  - Start: ensureSettingsLoaded() reads user.db once and fills the store.
 *    Anything missing or damaged falls back to the default, so a bad row can
 *    never stop the app from opening.
 *  - First launch: the interface language follows the phone (Filipino or
 *    Tagalog phone -> Filipino, anything else -> English), and the starting
 *    translation follows the language. This is saved, so it stays put.
 *  - Change: setSetting() validates, updates the screen at once, then saves
 *    in the background. A failed save never undoes what the person sees.
 *  - Every value is validated on the way in AND on the way out of the
 *    database, so the rest of the app can trust the types.
 */

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

type Validators = { [K in keyof Settings]: (value: unknown) => Settings[K] | undefined };

function oneOf<T extends string>(allowed: readonly T[]) {
  return (value: unknown): T | undefined =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : undefined;
}

function isBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

const VALIDATORS: Validators = {
  uiLanguage: oneOf<LangCode>(['en', 'fil']),
  translation: (value) =>
    typeof value === 'string' && isValidPackId(value) ? value : undefined,
  theme: oneOf<ThemeName>(THEME_NAMES),
  fontSize: (value) =>
    typeof value === 'number' && Number.isFinite(value) ? snapFontSize(value) : undefined,
  lineHeight: (value) =>
    typeof value === 'number' && Number.isFinite(value) ? snapLineHeight(value) : undefined,
  fontFamily: oneOf<FontFamilyChoice>(['serif', 'sans']),
  showVerseNumbers: isBoolean,
  redLetters: isBoolean,
  liteMode: isBoolean,
  focusMode: isBoolean,
  highContrast: isBoolean,
  notificationsEnabled: isBoolean,
  notificationTime: (value) => {
    if (typeof value !== 'string') return undefined;
    const time = parseTimeOfDay(value);
    return time ? formatTimeOfDay(time) : undefined;
  },
  updateMode: oneOf<UpdateMode>(['auto', 'manual', 'off']),
  wifiOnly: isBoolean,
  lowStorageMode: isBoolean,
  lastUpdateCheck: (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/** Validate one value; returns it (normalized) or undefined if it is not acceptable. */
function sanitize<K extends keyof Settings>(key: K, value: unknown): Settings[K] | undefined {
  const validate = VALIDATORS[key] as (input: unknown) => Settings[K] | undefined;
  return validate(value);
}

/* ------------------------------------------------------------------ */
/* First launch                                                        */
/* ------------------------------------------------------------------ */

/** "fil" and "tl" (Tagalog) both mean Filipino. Everything else is English. */
function detectLanguage(): LangCode {
  try {
    const code = getLocales()[0]?.languageCode?.toLowerCase();
    return code === 'fil' || code === 'tl' ? 'fil' : 'en';
  } catch {
    return 'en';
  }
}

/** Build the full settings from stored rows, using defaults for anything unusable. */
function buildSettings(stored: Record<string, unknown>): { settings: Settings; fresh: boolean } {
  const hasLanguage = sanitize('uiLanguage', stored.uiLanguage) !== undefined;
  const language = hasLanguage ? (stored.uiLanguage as LangCode) : detectLanguage();

  // Start from the defaults, with the first-launch language choices applied.
  const result: Settings = {
    ...DEFAULT_SETTINGS,
    uiLanguage: language,
    translation: DEFAULT_TRANSLATION[language],
  };

  const writable = result as unknown as Record<string, unknown>;
  for (const key of SETTING_KEYS) {
    const value = sanitize(key, stored[key]);
    if (value !== undefined) writable[key] = value;
  }
  return { settings: result, fresh: !hasLanguage };
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

interface SettingsState {
  settings: Settings;
  /** False until ensureSettingsLoaded() has finished. Screens show nothing until then. */
  loaded: boolean;

  /** Change one setting. Invalid values are ignored. Returns false if ignored. */
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => boolean;
  /** Change several at once, saved together. Invalid entries are skipped. */
  setSettings: (patch: Partial<Settings>) => void;
}

/** Save without blocking the screen. A failed save is dropped on purpose (see top note). */
function persist(entries: readonly [keyof Settings, unknown][]): void {
  void (async () => {
    try {
      const db = await getUserDb();
      for (const [key, value] of entries) {
        await saveSetting(db, key, value);
      }
    } catch {
      // The new value stays active this session; it will simply not survive a restart.
    }
  })();
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  setSetting: (key, value) => {
    const clean = sanitize(key, value);
    if (clean === undefined) return false;
    if (get().settings[key] === clean) return true;

    set((state) => ({ settings: { ...state.settings, [key]: clean } }));
    persist([[key, clean]]);
    return true;
  },

  setSettings: (patch) => {
    const accepted: [keyof Settings, unknown][] = [];
    const next: Record<string, unknown> = { ...get().settings };

    for (const key of SETTING_KEYS) {
      if (!(key in patch)) continue;
      const clean = sanitize(key, patch[key]);
      if (clean === undefined || next[key] === clean) continue;
      next[key] = clean;
      accepted.push([key, clean]);
    }

    if (accepted.length === 0) return;
    set({ settings: next as unknown as Settings });
    persist(accepted);
  },
}));

let loadPromise: Promise<Settings> | null = null;

/**
 * Load the settings once and return them. Safe to call from anywhere, any
 * number of times; every call gets the same result. If user.db cannot be read
 * the defaults are used and the app still opens.
 */
export function ensureSettingsLoaded(): Promise<Settings> {
  if (!loadPromise) {
    loadPromise = (async () => {
      let stored: Record<string, unknown> = {};
      try {
        stored = await loadStoredSettings(await getUserDb());
      } catch {
        // Fall through with no stored values.
      }

      const { settings, fresh } = buildSettings(stored);
      useSettingsStore.setState({ settings, loaded: true });

      // Remember the first-launch choices so they never change on their own.
      if (fresh) {
        persist([
          ['uiLanguage', settings.uiLanguage],
          ['translation', settings.translation],
        ]);
      }
      return settings;
    })();
  }
  return loadPromise;
}

/** Current settings without subscribing (for services and tasks that are not components). */
export function getSettings(): Settings {
  return useSettingsStore.getState().settings;
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export const selectSettings = (state: SettingsState): Settings => state.settings;
export const selectLoaded = (state: SettingsState): boolean => state.loaded;
