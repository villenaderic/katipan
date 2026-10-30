import type { SQLiteDatabase } from 'expo-sqlite';

import type { VerseId, VerseRow } from '../../types';

/**
 * Full-text search inside ONE Bible pack, using the verses_fts FTS5 table
 * (external content, tokenizer "unicode61 remove_diacritics 2").
 *
 * The person types plain words, never FTS syntax. This file turns that text
 * into a safe MATCH expression, so a stray quote, dash, colon or asterisk can
 * never raise an SQL error:
 *
 *   love one another      -> every word must appear (AND), last word as prefix
 *   "love one another"    -> exact phrase
 *   "in the beginning" God -> phrase AND word
 *
 * Reference lookups ("John 3:16") are not handled here; utils/reference.ts
 * does that before a search is run. Nothing in this file ever writes.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Where to look. A book number (1..66) limits the search to that book. */
export type SearchScope = 'all' | 'OT' | 'NT' | { book: number };

/** 'relevance' ranks by bm25; 'canon' lists hits in Bible order. */
export type SearchOrder = 'relevance' | 'canon';

export interface SearchOptions {
  scope?: SearchScope;
  order?: SearchOrder;
  /** Max rows to return. Clamped to 1..MAX_LIMIT. Default 50. */
  limit?: number;
  /** Rows to skip, for paging. Default 0. */
  offset?: number;
  /** Treat the last word as a prefix ("beginn" finds "beginning"). Default true. */
  prefixLast?: boolean;
}

/** One match. Same shape as VerseRow, so the UI can reuse verse components. */
export type SearchHit = VerseRow;

/** What a parsed query looks like. `match` is null when there is nothing to search. */
export interface ParsedQuery {
  /** Safe FTS5 MATCH expression, or null for an empty or symbol-only query. */
  match: string | null;
  /**
   * Lowercase words and phrase words to mark in the results. The tokenizer
   * ignores diacritics, so the UI should compare with diacritics removed.
   */
  terms: string[];
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Longest query we will process; anything past this is cut off. */
const MAX_QUERY_LENGTH = 200;

/** Most terms we pass to FTS5. More than this is never a real search. */
const MAX_TERMS = 12;

/** Old Testament is books 1..39, New Testament is 40..66 (see constants/books.ts). */
const LAST_OT_BOOK = 39;
const LAST_BOOK = 66;

/** A letter or digit in any script, so Filipino and accented words survive. */
const WORD_PATTERN = /[\p{L}\p{N}]+/gu;

/* ------------------------------------------------------------------ */
/* Query parsing                                                       */
/* ------------------------------------------------------------------ */

/** Pull the words out of a piece of text. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(WORD_PATTERN) ?? [];
}

/** An FTS5 string literal. Words are letters and digits only, but quote safely anyway. */
function quote(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

/**
 * Turn what the person typed into a safe MATCH expression plus the list of
 * words to highlight. Pure function, no database needed.
 */
export function parseSearchQuery(input: string, prefixLast = true): ParsedQuery {
  const text = input.slice(0, MAX_QUERY_LENGTH);

  // Pieces in typed order. A piece is either a quoted phrase or a single word.
  const pieces: { words: string[]; phrase: boolean }[] = [];

  // Quoted text first ("..."), everything between quotes is one phrase.
  // An unclosed quote is treated as if it closed at the end of the text.
  const segments = text.split('"');
  segments.forEach((segment, index) => {
    const words = wordsOf(segment);
    if (words.length === 0) return;
    const insideQuotes = index % 2 === 1;
    if (insideQuotes && words.length > 1) {
      pieces.push({ words, phrase: true });
    } else {
      // Outside quotes, or a one-word "phrase": plain separate words.
      for (const word of words) pieces.push({ words: [word], phrase: false });
    }
  });

  const limited = pieces.slice(0, MAX_TERMS);
  if (limited.length === 0) return { match: null, terms: [] };

  const lastIndex = limited.length - 1;
  const expressions = limited.map((piece, index) => {
    if (piece.phrase) {
      return `"${piece.words.map((word) => word.replace(/"/g, '""')).join(' ')}"`;
    }
    const word = piece.words[0] ?? '';
    // Prefix matching only for the final loose word, and only from 2 letters up,
    // so a single typed letter does not scan the whole Bible.
    const isPrefix = prefixLast && index === lastIndex && word.length >= 2;
    return isPrefix ? `${quote(word)} *` : quote(word);
  });

  const terms = Array.from(new Set(limited.flatMap((piece) => piece.words)));

  // Space between expressions means AND in FTS5.
  return { match: expressions.join(' '), terms };
}

/* ------------------------------------------------------------------ */
/* Scope                                                               */
/* ------------------------------------------------------------------ */

/** Inclusive book range for a scope. */
function bookRange(scope: SearchScope): { from: number; to: number } {
  if (scope === 'OT') return { from: 1, to: LAST_OT_BOOK };
  if (scope === 'NT') return { from: LAST_OT_BOOK + 1, to: LAST_BOOK };
  if (scope === 'all') return { from: 1, to: LAST_BOOK };
  const book = Math.trunc(scope.book);
  if (!Number.isFinite(book) || book < 1 || book > LAST_BOOK) return { from: 1, to: LAST_BOOK };
  return { from: book, to: book };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/**
 * Search one pack. Returns [] for an empty query or when FTS5 rejects the
 * expression, so the Search screen can simply show "No results".
 */
export async function searchVerses(
  db: SQLiteDatabase,
  input: string,
  options: SearchOptions = {},
): Promise<SearchHit[]> {
  const { match } = parseSearchQuery(input, options.prefixLast ?? true);
  if (match === null) return [];

  const { from, to } = bookRange(options.scope ?? 'all');
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const orderBy = options.order === 'canon' ? 'v.id' : 'bm25(verses_fts), v.id';

  try {
    return await db.getAllAsync<SearchHit>(
      `SELECT v.id, v.book, v.chapter, v.verse, v.text
         FROM verses_fts
         JOIN verses v ON v.id = verses_fts.rowid
        WHERE verses_fts MATCH ?
          AND v.book BETWEEN ? AND ?
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
      match,
      from,
      to,
      limit,
      offset,
    );
  } catch {
    // A malformed expression is a "no results" case for the person, not a crash.
    return [];
  }
}

/** How many verses match in total (for "212 results"). 0 on an empty query or error. */
export async function countSearchMatches(
  db: SQLiteDatabase,
  input: string,
  options: Pick<SearchOptions, 'scope' | 'prefixLast'> = {},
): Promise<number> {
  const { match } = parseSearchQuery(input, options.prefixLast ?? true);
  if (match === null) return 0;

  const { from, to } = bookRange(options.scope ?? 'all');

  try {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM verses_fts
         JOIN verses v ON v.id = verses_fts.rowid
        WHERE verses_fts MATCH ?
          AND v.book BETWEEN ? AND ?`,
      match,
      from,
      to,
    );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * How many hits fall in each book, as a map of book number to count. Lets the
 * Search screen offer "Only in John (14)" without running 66 searches.
 */
export async function countMatchesByBook(
  db: SQLiteDatabase,
  input: string,
  options: Pick<SearchOptions, 'scope' | 'prefixLast'> = {},
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  const { match } = parseSearchQuery(input, options.prefixLast ?? true);
  if (match === null) return counts;

  const { from, to } = bookRange(options.scope ?? 'all');

  try {
    const rows = await db.getAllAsync<{ book: number; n: number }>(
      `SELECT v.book AS book, COUNT(*) AS n
         FROM verses_fts
         JOIN verses v ON v.id = verses_fts.rowid
        WHERE verses_fts MATCH ?
          AND v.book BETWEEN ? AND ?
        GROUP BY v.book
        ORDER BY v.book`,
      match,
      from,
      to,
    );
    for (const row of rows) counts.set(row.book, row.n);
  } catch {
    // Leave the map empty.
  }
  return counts;
}

/** Ids only, in Bible order. Cheap way to mark which verses of a chapter match a search. */
export async function searchVerseIds(
  db: SQLiteDatabase,
  input: string,
  options: SearchOptions = {},
): Promise<VerseId[]> {
  const hits = await searchVerses(db, input, { ...options, order: 'canon' });
  return hits.map((hit) => hit.id);
}
