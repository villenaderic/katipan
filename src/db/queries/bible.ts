import type { SQLiteDatabase } from 'expo-sqlite';

import type { BookRow, PackMeta, VerseId, VerseRow } from '../../types';

/**
 * Read-only queries against ONE Bible pack. Every function takes the open
 * pack database (from getPackDb), so the same code serves every translation.
 * Nothing here ever writes.
 */

/** SQLite allows at least 999 bound variables; stay well under it. */
const MAX_IDS_PER_QUERY = 500;

/* ---------- pack info ---------- */

/** Pack metadata, or null when a required key is missing. */
export async function getPackMeta(db: SQLiteDatabase): Promise<PackMeta | null> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM meta');
  const meta = new Map(rows.map((row) => [row.key, row.value]));

  const id = meta.get('id');
  const name = meta.get('name');
  const language = meta.get('language');
  const version = Number(meta.get('version'));
  const canon = meta.get('canon');
  const license = meta.get('license');
  const sourceUrl = meta.get('source_url');

  if (
    id === undefined ||
    name === undefined ||
    language === undefined ||
    !Number.isFinite(version) ||
    canon === undefined ||
    license === undefined ||
    sourceUrl === undefined
  ) {
    return null;
  }

  return { id, name, language, version, canon, license, source_url: sourceUrl };
}

/* ---------- books ---------- */

export function getBooks(db: SQLiteDatabase): Promise<BookRow[]> {
  return db.getAllAsync<BookRow>(
    'SELECT id, osis, name, short, chapters, testament FROM books ORDER BY id',
  );
}

/* ---------- verses ---------- */

/** All verses of one chapter, in order. Uses idx_verses_ref. */
export function getChapter(
  db: SQLiteDatabase,
  book: number,
  chapter: number,
): Promise<VerseRow[]> {
  return db.getAllAsync<VerseRow>(
    `SELECT id, book, chapter, verse, text
       FROM verses
      WHERE book = ? AND chapter = ?
      ORDER BY verse`,
    book,
    chapter,
  );
}

/** One verse by id, or null if this pack does not contain it. */
export async function getVerse(db: SQLiteDatabase, id: VerseId): Promise<VerseRow | null> {
  const row = await db.getFirstAsync<VerseRow>(
    'SELECT id, book, chapter, verse, text FROM verses WHERE id = ?',
    id,
  );
  return row ?? null;
}

/**
 * Several verses by id (highlights, bookmarks, notes, search results).
 * Returned in the same order as `ids`; ids this pack lacks are skipped.
 */
export async function getVerses(db: SQLiteDatabase, ids: readonly VerseId[]): Promise<VerseRow[]> {
  if (ids.length === 0) return [];

  const found = new Map<VerseId, VerseRow>();
  for (let start = 0; start < ids.length; start += MAX_IDS_PER_QUERY) {
    const chunk = ids.slice(start, start + MAX_IDS_PER_QUERY);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db.getAllAsync<VerseRow>(
      `SELECT id, book, chapter, verse, text FROM verses WHERE id IN (${placeholders})`,
      ...chunk,
    );
    for (const row of rows) found.set(row.id, row);
  }

  const ordered: VerseRow[] = [];
  for (const id of ids) {
    const row = found.get(id);
    if (row) ordered.push(row);
  }
  return ordered;
}

/**
 * Every verse from `fromId` to `toId` inclusive. Verse ids grow in reading
 * order, so a plain range works across chapters and books (search context,
 * "John 3:16-18", the daily verse with its neighbours).
 */
export function getVerseRange(
  db: SQLiteDatabase,
  fromId: VerseId,
  toId: VerseId,
): Promise<VerseRow[]> {
  return db.getAllAsync<VerseRow>(
    `SELECT id, book, chapter, verse, text
       FROM verses
      WHERE id BETWEEN ? AND ?
      ORDER BY id`,
    fromId,
    toId,
  );
}

/** Highest verse number in a chapter, or 0 if the chapter does not exist in this pack. */
export async function getVerseCount(
  db: SQLiteDatabase,
  book: number,
  chapter: number,
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number | null }>(
    'SELECT MAX(verse) AS n FROM verses WHERE book = ? AND chapter = ?',
    book,
    chapter,
  );
  return row?.n ?? 0;
}
