import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  Bookmark,
  Highlight,
  HighlightColor,
  Note,
  PlanProgress,
  ReadingProgress,
  VerseId,
} from '../../types';

/**
 * Queries against user.db (highlights, bookmarks, notes, tags, progress,
 * settings). Nothing here stores verse text, only verse_id plus the id of the
 * translation the mark was made in.
 *
 * Marks follow the VERSE, not the translation: a highlight made in WEB still
 * shows when the person reads the same verse in Ang Dating Biblia. The
 * `translation` column only records where it was made. So "is this verse
 * highlighted / bookmarked" is always answered by verse_id alone.
 *
 * Range arguments (fromId, toId) are verse ids; build them with the helpers
 * in utils/reference.ts (a chapter is one range).
 */

/* ------------------------------------------------------------------ */
/* Highlights                                                          */
/* ------------------------------------------------------------------ */

/** Highlight every given verse with `color`, replacing any earlier color. */
export async function setHighlights(
  db: SQLiteDatabase,
  verseIds: readonly VerseId[],
  translation: string,
  color: HighlightColor,
): Promise<void> {
  if (verseIds.length === 0) return;
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const verseId of verseIds) {
      await db.runAsync('DELETE FROM highlights WHERE verse_id = ?', verseId);
      await db.runAsync(
        'INSERT INTO highlights (verse_id, translation, color, created_at) VALUES (?, ?, ?, ?)',
        verseId,
        translation,
        color,
        now,
      );
    }
  });
}

export async function clearHighlights(
  db: SQLiteDatabase,
  verseIds: readonly VerseId[],
): Promise<void> {
  if (verseIds.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const verseId of verseIds) {
      await db.runAsync('DELETE FROM highlights WHERE verse_id = ?', verseId);
    }
  });
}

export function getHighlightsInRange(
  db: SQLiteDatabase,
  fromId: VerseId,
  toId: VerseId,
): Promise<Highlight[]> {
  return db.getAllAsync<Highlight>(
    `SELECT id, verse_id, translation, color, created_at
       FROM highlights
      WHERE verse_id BETWEEN ? AND ?
      ORDER BY verse_id`,
    fromId,
    toId,
  );
}

/** Library list, newest first. Pass a color to filter. */
export function listHighlights(db: SQLiteDatabase, color?: HighlightColor): Promise<Highlight[]> {
  if (color) {
    return db.getAllAsync<Highlight>(
      `SELECT id, verse_id, translation, color, created_at
         FROM highlights WHERE color = ? ORDER BY created_at DESC, id DESC`,
      color,
    );
  }
  return db.getAllAsync<Highlight>(
    `SELECT id, verse_id, translation, color, created_at
       FROM highlights ORDER BY created_at DESC, id DESC`,
  );
}

/* ------------------------------------------------------------------ */
/* Bookmarks                                                           */
/* ------------------------------------------------------------------ */

/** Bookmark every given verse that is not bookmarked yet. */
export async function addBookmarks(
  db: SQLiteDatabase,
  verseIds: readonly VerseId[],
  translation: string,
  label: string | null = null,
): Promise<void> {
  if (verseIds.length === 0) return;
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const verseId of verseIds) {
      await db.runAsync(
        `INSERT INTO bookmarks (verse_id, translation, label, created_at)
         SELECT ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM bookmarks WHERE verse_id = ?)`,
        verseId,
        translation,
        label,
        now,
        verseId,
      );
    }
  });
}

export async function removeBookmarks(
  db: SQLiteDatabase,
  verseIds: readonly VerseId[],
): Promise<void> {
  if (verseIds.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const verseId of verseIds) {
      await db.runAsync('DELETE FROM bookmarks WHERE verse_id = ?', verseId);
    }
  });
}

export async function setBookmarkLabel(
  db: SQLiteDatabase,
  id: number,
  label: string | null,
): Promise<void> {
  const trimmed = label?.trim() ?? '';
  await db.runAsync('UPDATE bookmarks SET label = ? WHERE id = ?', trimmed === '' ? null : trimmed, id);
}

export function getBookmarksInRange(
  db: SQLiteDatabase,
  fromId: VerseId,
  toId: VerseId,
): Promise<Bookmark[]> {
  return db.getAllAsync<Bookmark>(
    `SELECT id, verse_id, translation, label, created_at
       FROM bookmarks
      WHERE verse_id BETWEEN ? AND ?
      ORDER BY verse_id`,
    fromId,
    toId,
  );
}

/** Library list, newest first. */
export function listBookmarks(db: SQLiteDatabase): Promise<Bookmark[]> {
  return db.getAllAsync<Bookmark>(
    `SELECT id, verse_id, translation, label, created_at
       FROM bookmarks ORDER BY created_at DESC, id DESC`,
  );
}

/* ------------------------------------------------------------------ */
/* Tags and notes                                                      */
/* ------------------------------------------------------------------ */

export interface TagWithCount {
  id: number;
  name: string;
  count: number;
}

const MAX_TAG_LENGTH = 40;

/** Trim, collapse spaces, cut to length, drop empties and case-insensitive duplicates. */
export function normalizeTagNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
    if (name === '') continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/**
 * Replace the tags of a note. Must run inside a transaction or on its own;
 * it does not open one (SQLite transactions cannot nest here).
 */
async function applyNoteTags(
  db: SQLiteDatabase,
  noteId: number,
  tagNames: readonly string[],
): Promise<void> {
  await db.runAsync('DELETE FROM note_tags WHERE note_id = ?', noteId);
  for (const name of normalizeTagNames(tagNames)) {
    await db.runAsync('INSERT OR IGNORE INTO tags (name) VALUES (?)', name);
    const tag = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM tags WHERE name = ? COLLATE NOCASE',
      name,
    );
    if (tag) {
      await db.runAsync(
        'INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)',
        noteId,
        tag.id,
      );
    }
  }
  // Tags nobody uses any more disappear from the filter list.
  await db.runAsync('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)');
}

/** Create a note on a verse and return its id. */
export async function createNote(
  db: SQLiteDatabase,
  verseId: VerseId,
  translation: string,
  body: string,
  tagNames: readonly string[] = [],
): Promise<number> {
  const now = Date.now();
  let noteId = 0;
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      'INSERT INTO notes (verse_id, translation, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      verseId,
      translation,
      body,
      now,
      now,
    );
    noteId = result.lastInsertRowId;
    await applyNoteTags(db, noteId, tagNames);
  });
  return noteId;
}

export async function updateNote(
  db: SQLiteDatabase,
  id: number,
  body: string,
  tagNames: readonly string[],
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?', body, Date.now(), id);
    await applyNoteTags(db, id, tagNames);
  });
}

export async function deleteNote(db: SQLiteDatabase, id: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    // note_tags rows go with it (ON DELETE CASCADE).
    await db.runAsync('DELETE FROM notes WHERE id = ?', id);
    await db.runAsync('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)');
  });
}

export async function getNote(db: SQLiteDatabase, id: number): Promise<Note | null> {
  const row = await db.getFirstAsync<Note>(
    'SELECT id, verse_id, translation, body, created_at, updated_at FROM notes WHERE id = ?',
    id,
  );
  return row ?? null;
}

/** Notes on the verses in a range, for the note marker in the reader. */
export function getNotesInRange(
  db: SQLiteDatabase,
  fromId: VerseId,
  toId: VerseId,
): Promise<Note[]> {
  return db.getAllAsync<Note>(
    `SELECT id, verse_id, translation, body, created_at, updated_at
       FROM notes
      WHERE verse_id BETWEEN ? AND ?
      ORDER BY verse_id, created_at`,
    fromId,
    toId,
  );
}

/** Library list, most recently edited first. Pass a tag id to filter. */
export function listNotes(db: SQLiteDatabase, tagId?: number): Promise<Note[]> {
  if (tagId !== undefined) {
    return db.getAllAsync<Note>(
      `SELECT n.id, n.verse_id, n.translation, n.body, n.created_at, n.updated_at
         FROM notes n
         JOIN note_tags nt ON nt.note_id = n.id
        WHERE nt.tag_id = ?
        ORDER BY n.updated_at DESC, n.id DESC`,
      tagId,
    );
  }
  return db.getAllAsync<Note>(
    `SELECT id, verse_id, translation, body, created_at, updated_at
       FROM notes ORDER BY updated_at DESC, id DESC`,
  );
}

/** Every tag with the number of notes using it, A to Z. */
export function listTags(db: SQLiteDatabase): Promise<TagWithCount[]> {
  return db.getAllAsync<TagWithCount>(
    `SELECT t.id AS id, t.name AS name, COUNT(nt.note_id) AS count
       FROM tags t
       LEFT JOIN note_tags nt ON nt.tag_id = t.id
      GROUP BY t.id
      ORDER BY t.name COLLATE NOCASE`,
  );
}

/** note id -> tag names, for every note at once (Library list and export). */
export async function getNoteTagMap(db: SQLiteDatabase): Promise<Map<number, string[]>> {
  const rows = await db.getAllAsync<{ note_id: number; name: string }>(
    `SELECT nt.note_id AS note_id, t.name AS name
       FROM note_tags nt
       JOIN tags t ON t.id = nt.tag_id
      ORDER BY t.name COLLATE NOCASE`,
  );
  const map = new Map<number, string[]>();
  for (const row of rows) {
    const list = map.get(row.note_id);
    if (list) list.push(row.name);
    else map.set(row.note_id, [row.name]);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Everything, for backup and export                                   */
/* ------------------------------------------------------------------ */

export function getAllHighlights(db: SQLiteDatabase): Promise<Highlight[]> {
  return db.getAllAsync<Highlight>(
    'SELECT id, verse_id, translation, color, created_at FROM highlights ORDER BY verse_id',
  );
}

export function getAllBookmarks(db: SQLiteDatabase): Promise<Bookmark[]> {
  return db.getAllAsync<Bookmark>(
    'SELECT id, verse_id, translation, label, created_at FROM bookmarks ORDER BY verse_id',
  );
}

export function getAllNotes(db: SQLiteDatabase): Promise<Note[]> {
  return db.getAllAsync<Note>(
    'SELECT id, verse_id, translation, body, created_at, updated_at FROM notes ORDER BY verse_id, created_at',
  );
}

/* ------------------------------------------------------------------ */
/* Reading progress and plans                                          */
/* ------------------------------------------------------------------ */

export async function saveReadingProgress(
  db: SQLiteDatabase,
  book: number,
  chapter: number,
  translation: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO reading_progress (book, chapter, translation, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (book, chapter, translation) DO UPDATE SET updated_at = excluded.updated_at`,
    book,
    chapter,
    translation,
    Date.now(),
  );
}

/** Where to resume: the chapter opened most recently, or null on a fresh install. */
export async function getLastReadingProgress(db: SQLiteDatabase): Promise<ReadingProgress | null> {
  const row = await db.getFirstAsync<ReadingProgress>(
    `SELECT book, chapter, translation, updated_at
       FROM reading_progress ORDER BY updated_at DESC LIMIT 1`,
  );
  return row ?? null;
}

export async function setPlanDayDone(
  db: SQLiteDatabase,
  planId: string,
  day: number,
  done: boolean,
): Promise<void> {
  if (done) {
    await db.runAsync(
      `INSERT INTO plan_progress (plan_id, day, done_at) VALUES (?, ?, ?)
       ON CONFLICT (plan_id, day) DO NOTHING`,
      planId,
      day,
      Date.now(),
    );
  } else {
    await db.runAsync('DELETE FROM plan_progress WHERE plan_id = ? AND day = ?', planId, day);
  }
}

export function getPlanProgress(db: SQLiteDatabase, planId: string): Promise<PlanProgress[]> {
  return db.getAllAsync<PlanProgress>(
    'SELECT plan_id, day, done_at FROM plan_progress WHERE plan_id = ? ORDER BY day',
    planId,
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/**
 * Every stored setting, decoded. Rows that are not valid JSON are skipped, so
 * a damaged row falls back to the default instead of crashing the app.
 * The settings store validates each value against DEFAULT_SETTINGS.
 */
export async function loadStoredSettings(db: SQLiteDatabase): Promise<Record<string, unknown>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM settings',
  );
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value) as unknown;
    } catch {
      // Skip a damaged row; the default applies.
    }
  }
  return result;
}

export async function saveSetting(db: SQLiteDatabase, key: string, value: unknown): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    key,
    JSON.stringify(value),
  );
}
