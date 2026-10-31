/**
 * Shared types for Katipan Bible app.
 */

/* ------------------------------------------------------------------ */
/* Language and books                                                 */
/* ------------------------------------------------------------------ */

export type LangCode = 'en' | 'fil';

export type Testament = 'OT' | 'NT';

export interface BookNames {
  readonly name: string;
  readonly short: string;
  readonly aliases: readonly string[];
}

export interface BookDef {
  readonly id: number;
  readonly osis: string;
  readonly chapters: number;
  readonly testament: Testament;
  readonly names: Readonly<Record<LangCode, BookNames>>;
}

/* ------------------------------------------------------------------ */
/* Bible text and references                                          */
/* ------------------------------------------------------------------ */

/**
 * Computed as book * 1_000_000 + chapter * 1_000 + verse so the same
 * reference lines up across all translations.
 */
export type VerseId = number;

export interface VerseRef {
  readonly book: number;
  readonly chapter: number;
  readonly verse: number;
}

export interface VerseRow {
  readonly id: VerseId;
  readonly book: number;
  readonly chapter: number;
  readonly verse: number;
  readonly text: string;
}

export interface BookRow {
  readonly id: number;
  readonly osis: string;
  readonly name: string;
  readonly short: string;
  readonly chapters: number;
  readonly testament: string;
}

export interface PackMeta {
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly version: number;
  readonly canon: string;
  readonly license: string;
  readonly source_url: string;
}

export interface InstalledPack {
  readonly id: string;
  readonly version: number;
  readonly bytes: number;
  readonly bundled: boolean;
}

/* ------------------------------------------------------------------ */
/* Themes and appearance                                              */
/* ------------------------------------------------------------------ */

export type ThemeName = 'light' | 'sepia' | 'dark' | 'black';

export type FontFamilyChoice = 'serif' | 'sans';

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';

export type UpdateMode = 'auto' | 'manual' | 'off';

export interface Settings {
  readonly uiLanguage: LangCode;
  readonly translation: string;
  /**
   * Parallel view (v1.5): the pack id of the second translation shown beside
   * or under the main one, or null when parallel view is off. Never the same
   * as `translation` (the settings store keeps it so).
   */
  readonly parallelTranslation: string | null;
  readonly theme: ThemeName;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontFamily: FontFamilyChoice;
  readonly showVerseNumbers: boolean;
  readonly redLetters: boolean;
  readonly liteMode: boolean;
  readonly focusMode: boolean;
  readonly highContrast: boolean;
  readonly notificationsEnabled: boolean;
  readonly notificationTime: string;
  readonly updateMode: UpdateMode;
  readonly wifiOnly: boolean;
  readonly lowStorageMode: boolean;
  readonly lastUpdateCheck: number;
}

/* ------------------------------------------------------------------ */
/* User database entities                                             */
/* ------------------------------------------------------------------ */

export interface Highlight {
  readonly id: number;
  readonly verse_id: VerseId;
  readonly translation: string;
  readonly color: HighlightColor;
  readonly created_at: number;
}

export interface Bookmark {
  readonly id: number;
  readonly verse_id: VerseId;
  readonly translation: string;
  readonly label: string | null;
  readonly created_at: number;
}

export interface Note {
  readonly id: number;
  readonly verse_id: VerseId;
  readonly translation: string;
  readonly body: string;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface Tag {
  readonly id: number;
  readonly name: string;
}

export interface ReadingProgress {
  readonly book: number;
  readonly chapter: number;
  readonly translation: string;
  readonly updated_at: number;
}

export interface PlanProgress {
  readonly plan_id: string;
  readonly day: number;
  readonly done_at: number;
}

/* ------------------------------------------------------------------ */
/* Updates and manifest                                               */
/* ------------------------------------------------------------------ */

export interface ManifestPack {
  readonly id: string;
  readonly lang: string;
  readonly version: number;
  readonly size: number;
  readonly url: string;
  readonly sha256: string;
  readonly bundled?: boolean;
}

export interface ManifestDailyVerses {
  readonly version: number;
  readonly url: string;
  readonly sha256: string;
}

export interface ManifestApp {
  readonly latest: string;
  readonly apkUrl: string;
  readonly sha256: string;
  readonly notes: {
    readonly en: string;
    readonly fil: string;
  };
}

export interface Manifest {
  readonly schema: number;
  readonly generated: string;
  readonly minAppVersion: string;
  readonly packs: readonly ManifestPack[];
  readonly dailyVerses?: ManifestDailyVerses | null;
  readonly app?: ManifestApp | null;
}

