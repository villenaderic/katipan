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
 *  - Parallel view: `parallelTranslation` is a pack id (parallel view on) or
 *    null (off), and is never the same as `translation`. Choosing the main
 *    translation that is currently the second one SWAPS them, so parallel view
 *    stays on and the person simply reads the other text first. Setting the
 *    second translation to the main one is refused.
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
  // null is a real value here (parallel view off), so only a wrong type is rejected.
  parallelTranslation: (value) => {
    if (value === null) return null;
    return typeof value === 'string' && isValidPackId(value) ? value : undefined;
  },
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

/**
 * Keep the two translations different. `previous` is the settings before the
 * change. Returns the settings to use and whether a request for the second
 * translation had to be refused.
 */
function reconcileParallel(
  previous: Settings,
  next: Record<string, unknown>,
): { settings: Settings; refused: boolean } {
  let refused = false;
  if (next.parallelTranslation !== null && next.parallelTranslation === next.translation) {
    if (next.translation !== previous.translation) {
      // The main translation became the second one: swap.
      next.parallelTranslation = previous.translation;
    } else {
      // The second translation was set to the main one: refuse.
      next.parallelTranslation = previous.parallelTranslation;
      refused = true;
    }
  }
  return { settings: next as unknown as Settings, refused };
}

/** Everything that differs between two settings objects, as [key, value] pairs to save. */
function changedEntries(before: Settings, after: Settings): [keyof Settings, unknown][] {
  const entries: [keyof Settings, unknown][] = [];
  for (const key of SETTING_KEYS) {
    if (before[key] !== after[key]) entries.push([key, after[key]]);
  }
  return entries;
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
  // A stored pair that agrees (an older version, a hand-edited row) means parallel view off.
  if (result.parallelTranslation === result.translation) {
    writable.parallelTranslation = null;
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

    const current = get().settings;
    if (current[key] === clean) return true;

    const { settings, refused } = reconcileParallel(current, { ...current, [key]: clean });
    const entries = changedEntries(current, settings);
    if (entries.length > 0) {
      set({ settings });
      persist(entries);
    }
    return !refused;
  },

  setSettings: (patch) => {
    const current = get().settings;
    const next: Record<string, unknown> = { ...current };

    for (const key of SETTING_KEYS) {
      if (!(key in patch)) continue;
      const clean = sanitize(key, patch[key]);
      if (clean !== undefined) next[key] = clean;
    }

    const { settings } = reconcileParallel(current, next);
    const entries = changedEntries(current, settings);
    if (entries.length === 0) return;
    set({ settings });
    persist(entries);
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
