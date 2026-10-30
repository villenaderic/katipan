import Constants from 'expo-constants';

import type { Settings } from '../types';

/** App version as declared in app.json (single source of truth). */
export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

/**
 * The ONLY network address the app ever contacts (besides the pack and APK
 * URLs listed inside the verified manifest). Set in app.json -> extra.manifestUrl.
 */
export const MANIFEST_URL: string =
  (Constants.expoConfig?.extra?.manifestUrl as string | undefined) ?? '';

/**
 * Ed25519 public key (64 hex characters) used to verify manifest.json.
 * Generate the key pair with tools/build-manifest.js and paste the PUBLIC half
 * here. While empty, every update is refused.
 */
export const MANIFEST_PUBLIC_KEY_HEX = '';

export const IS_SIGNING_KEY_CONFIGURED: boolean =
  /^[0-9a-f]{64}$/i.test(MANIFEST_PUBLIC_KEY_HEX);

/** Where the About screen links for donations and the website. */
export const WEBSITE_URL = 'https://example.com/katipan';

export const DB_NAMES = {
  user: 'user.db',
} as const;

export const FOLDERS = {
  packs: 'packs/',
  temp: 'tmp/',
  apk: 'apk/',
} as const;

export const BUNDLED_PACK_IDS = ['web', 'adb1905'] as const;

export const DEFAULT_TRANSLATION: Record<'en' | 'fil', string> = {
  en: 'web',
  fil: 'adb1905',
};

export const READER = {
  minFont: 14,
  maxFont: 30,
  fontStep: 2,
  defaultFont: 18,
  minLineHeight: 1.3,
  maxLineHeight: 1.9,
  defaultLineHeight: 1.5,
  maxColumnWidth: 640,
  focusHideDelayMs: 2000,
} as const;

export const A11Y = {
  minTouchTarget: 48,
} as const;

export const UPDATES = {
  minIntervalMs: 24 * 60 * 60 * 1000,
  /** Packs bigger than this need an explicit tap. */
  confirmBytes: 10 * 1024 * 1024,
  backgroundTaskName: 'katipan-update-check',
  notificationDaysAhead: 14,
} as const;

export const DAILY_VERSE_COUNT = 366;

export const SPACING = [4, 8, 12, 16, 24, 32, 48] as const;

export const DEFAULT_SETTINGS: Settings = {
  uiLanguage: 'en',
  translation: 'web',
  theme: 'light',
  fontSize: READER.defaultFont,
  lineHeight: READER.defaultLineHeight,
  fontFamily: 'serif',
  showVerseNumbers: true,
  redLetters: false,
  liteMode: false,
  focusMode: false,
  highContrast: false,
  notificationsEnabled: false,
  notificationTime: '07:00',
  updateMode: 'manual',
  wifiOnly: true,
  lowStorageMode: false,
  lastUpdateCheck: 0,
};
