/**
 * Database schema definitions. Plain strings only, no runtime logic, so the
 * same text can be read by migrations.ts, client.ts and the tests.
 *
 * Two kinds of database:
 *   1. user.db, one file, created and migrated by the app. Never overwritten
 *      by an update (Section 7 and 8).
 *   2. One Bible pack per translation, built by tools/build-bible-db.js and
 *      shipped as an asset or downloaded. The app only READS these.
 */

/* ------------------------------------------------------------------ */
/* user.db                                                             */
/* ------------------------------------------------------------------ */

/**
 * Bump this when you add a migration in migrations.ts. The app stores the
 * applied number in SQLite's PRAGMA user_version.
 */
export const USER_SCHEMA_VERSION = 1;

/**
 * Version 1 of user.db. User data stores verse_id plus translation id, never
 * translated text, so switching translation or updating a pack can never break
 * a note, highlight or bookmark.
 *
 * Foreign keys need PRAGMA foreign_keys = ON (client.ts sets it on every open).
 */
export const USER_SCHEMA_V1: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS highlights (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    verse_id    INTEGER NOT NULL,
    translation TEXT    NOT NULL,
    color       TEXT    NOT NULL CHECK (color IN ('yellow','green','blue','pink','orange')),
    created_at  INTEGER NOT NULL,
    UNIQUE (verse_id, translation)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_highlights_color ON highlights (color, created_at)`,

  `CREATE TABLE IF NOT EXISTS bookmarks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    verse_id    INTEGER NOT NULL,
    translation TEXT    NOT NULL,
    label       TEXT,
    created_at  INTEGER NOT NULL,
    UNIQUE (verse_id, translation)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bookmarks_created ON bookmarks (created_at)`,

  `CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    verse_id    INTEGER NOT NULL,
    translation TEXT    NOT NULL,
    body        TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notes_verse ON notes (verse_id, translation)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes (updated_at)`,

  `CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  )`,

  `CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags (id)  ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags (tag_id)`,

  // One row per chapter ever opened. "Resume" is the row with the newest updated_at.
  `CREATE TABLE IF NOT EXISTS reading_progress (
    book        INTEGER NOT NULL,
    chapter     INTEGER NOT NULL,
    translation TEXT    NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (book, chapter, translation)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reading_progress_recent ON reading_progress (updated_at DESC)`,

  `CREATE TABLE IF NOT EXISTS plan_progress (
    plan_id TEXT    NOT NULL,
    day     INTEGER NOT NULL,
    done_at INTEGER NOT NULL,
    PRIMARY KEY (plan_id, day)
  )`,

  // Key/value store for the Settings object (values are JSON-encoded strings).
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

/** Tables that exist in user.db at the current version (used by backup and tests). */
export const USER_TABLES = [
  'highlights',
  'bookmarks',
  'notes',
  'tags',
  'note_tags',
  'reading_progress',
  'plan_progress',
  'settings',
] as const;

export type UserTable = (typeof USER_TABLES)[number];

/* ------------------------------------------------------------------ */
/* Bible packs                                                         */
/* ------------------------------------------------------------------ */

/** Tables every Bible pack must contain. bibleService refuses a pack without them. */
export const BIBLE_REQUIRED_TABLES = ['meta', 'books', 'verses', 'verses_fts'] as const;

/** Keys every pack must have in its meta table (license and source are mandatory). */
export const BIBLE_REQUIRED_META_KEYS = [
  'id',
  'name',
  'language',
  'version',
  'canon',
  'license',
  'source_url',
] as const;

export type BibleMetaKey = (typeof BIBLE_REQUIRED_META_KEYS)[number];

/**
 * The exact layout tools/build-bible-db.js must produce. It lives here as
 * documentation and as a test fixture; the app never runs it on a real pack.
 *
 * verse id = book * 1000000 + chapter * 1000 + verse (see utils/reference.ts).
 * verses_fts is an external-content FTS5 table, so the text is stored once.
 * remove_diacritics 2 lets "Diyos" and accented Spanish words match unaccented input.
 */
export const BIBLE_PACK_DDL: readonly string[] = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE books (
    id        INTEGER PRIMARY KEY,
    osis      TEXT    NOT NULL,
    name      TEXT    NOT NULL,
    short     TEXT    NOT NULL,
    chapters  INTEGER NOT NULL,
    testament TEXT    NOT NULL CHECK (testament IN ('OT','NT'))
  )`,
  `CREATE TABLE verses (
    id      INTEGER PRIMARY KEY,
    book    INTEGER NOT NULL,
    chapter INTEGER NOT NULL,
    verse   INTEGER NOT NULL,
    text    TEXT    NOT NULL
  )`,
  `CREATE INDEX idx_verses_ref ON verses (book, chapter, verse)`,
  `CREATE VIRTUAL TABLE verses_fts USING fts5(
    text,
    content='verses',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
  )`,
  `INSERT INTO verses_fts (rowid, text) SELECT id, text FROM verses`,
  `INSERT INTO verses_fts (verses_fts) VALUES ('optimize')`,
];
