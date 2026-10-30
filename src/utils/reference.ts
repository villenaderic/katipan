import { BOOKS, chapterCount, getBook } from '../constants/books';
import type { BookDef, LangCode, VerseId, VerseRef } from '../types';

/**
 * Bible references: verse ids, chapter ranges, and the "quick jump" parser
 * that understands both English and Filipino book names ("John 3:16",
 * "Juan 3:16", "1 Cor 13", "Mga Awit 23", "Jude 5").
 *
 * Pure functions only. No database, no React.
 */

/* ------------------------------------------------------------------ */
/* Verse ids                                                           */
/* ------------------------------------------------------------------ */

const BOOK_FACTOR = 1_000_000;
const CHAPTER_FACTOR = 1_000;

/** The largest chapter or verse number a verse id can hold. */
const MAX_PART = 999;

/** book * 1000000 + chapter * 1000 + verse. Same number in every translation. */
export function makeVerseId(book: number, chapter: number, verse: number): VerseId {
  return book * BOOK_FACTOR + chapter * CHAPTER_FACTOR + verse;
}

export function refToVerseId(ref: VerseRef): VerseId {
  return makeVerseId(ref.book, ref.chapter, ref.verse);
}

export function parseVerseId(id: VerseId): VerseRef {
  const book = Math.floor(id / BOOK_FACTOR);
  const chapter = Math.floor((id % BOOK_FACTOR) / CHAPTER_FACTOR);
  const verse = id % CHAPTER_FACTOR;
  return { book, chapter, verse };
}

/** First and last possible verse id of one chapter. Use with getVerseRange or user.db range queries. */
export function chapterRange(book: number, chapter: number): { fromId: VerseId; toId: VerseId } {
  return {
    fromId: makeVerseId(book, chapter, 0),
    toId: makeVerseId(book, chapter, MAX_PART),
  };
}

/** First and last possible verse id of a whole book. */
export function bookIdRange(book: number): { fromId: VerseId; toId: VerseId } {
  return {
    fromId: makeVerseId(book, 0, 0),
    toId: makeVerseId(book, MAX_PART, MAX_PART),
  };
}

/* ------------------------------------------------------------------ */
/* Moving between chapters                                             */
/* ------------------------------------------------------------------ */

export interface ChapterRef {
  book: number;
  chapter: number;
}

/**
 * The chapter before (-1) or after (+1), crossing book boundaries
 * (Genesis 50 -> Exodus 1). Returns null at the start of Genesis 1 and the
 * end of Revelation 22, and for a chapter that does not exist.
 */
export function adjacentChapter(book: number, chapter: number, direction: 1 | -1): ChapterRef | null {
  const total = chapterCount(book);
  if (total === 0 || chapter < 1 || chapter > total) return null;

  const next = chapter + direction;
  if (next >= 1 && next <= total) return { book, chapter: next };

  const neighbour = book + direction;
  const neighbourChapters = chapterCount(neighbour);
  if (neighbourChapters === 0) return null;
  return { book: neighbour, chapter: direction === 1 ? 1 : neighbourChapters };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * "John 3:16", "John 3:16-18", "John 3", or "John" depending on what is given.
 * `short` uses the abbreviated book name.
 */
export function formatReference(
  ref: { book: number; chapter?: number | null; verse?: number | null; verseEnd?: number | null },
  lang: LangCode,
  short = false,
): string {
  const book = getBook(ref.book);
  if (!book) return '';
  const names = book.names[lang];
  const label = short ? names.short : names.name;

  if (!ref.chapter) return label;
  if (!ref.verse) return `${label} ${ref.chapter}`;

  const end = ref.verseEnd && ref.verseEnd > ref.verse ? `-${ref.verseEnd}` : '';
  return `${label} ${ref.chapter}:${ref.verse}${end}`;
}

/** Format straight from a verse id: formatVerseId(43003016, 'en') -> "John 3:16". */
export function formatVerseId(id: VerseId, lang: LangCode, short = false): string {
  return formatReference(parseVerseId(id), lang, short);
}

/* ------------------------------------------------------------------ */
/* Book name lookup                                                    */
/* ------------------------------------------------------------------ */

/**
 * Lowercase, remove accents, then keep only letters and digits, so
 * "1 Mga Taga-Corinto", "1mgatagacorinto" and "1 Mga Taga Corinto" all match.
 * Matches how the aliases in constants/books.ts are written.
 */
export function normalizeBookKey(text: string): string {
  let value = text.toLowerCase().trim();

  // Number words and ordinals at the very start become digits:
  // "first john", "1st john", "unang juan" -> "1 john", "1 juan".
  value = value
    .replace(/^(1st|first|unang)\b/, '1')
    .replace(/^(2nd|second|ikalawang|ikalawa)\b/, '2')
    .replace(/^(3rd|third|ikatlong|ikatlo)\b/, '3');

  if (typeof value.normalize === 'function') {
    value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return value.replace(/[^a-z0-9]/g, '');
}

/** Shortest accepted prefix when no exact name matches ("genes" -> Genesis). */
const MIN_PREFIX_LENGTH = 3;

interface BookIndex {
  exact: Map<string, number>;
  /** Every key with its book, for unique-prefix lookup. */
  keys: { key: string; book: number }[];
}

let bookIndex: BookIndex | null = null;

function addKey(index: BookIndex, raw: string, book: BookDef): void {
  const key = normalizeBookKey(raw);
  if (key.length === 0) return;
  // First writer wins, so full names (added first) beat shared abbreviations.
  if (!index.exact.has(key)) index.exact.set(key, book.id);
  index.keys.push({ key, book: book.id });
}

function getBookIndex(): BookIndex {
  if (bookIndex) return bookIndex;
  const index: BookIndex = { exact: new Map(), keys: [] };
  const languages: LangCode[] = ['en', 'fil'];

  // Pass 1: names, short names and OSIS ids. These must never lose to an alias.
  for (const book of BOOKS) {
    addKey(index, book.osis, book);
    for (const lang of languages) {
      addKey(index, book.names[lang].name, book);
      addKey(index, book.names[lang].short, book);
    }
  }
  // Pass 2: aliases (already normalized, normalizing again is harmless).
  for (const book of BOOKS) {
    for (const lang of languages) {
      for (const alias of book.names[lang].aliases) addKey(index, alias, book);
    }
  }

  bookIndex = index;
  return index;
}

/**
 * Find a book from what someone typed: full name, abbreviation, either
 * language, any spacing or punctuation. Falls back to a unique prefix of at
 * least 3 letters. Returns undefined when nothing, or more than one book, fits.
 */
export function findBook(text: string): BookDef | undefined {
  const key = normalizeBookKey(text);
  if (key.length === 0) return undefined;

  const index = getBookIndex();
  const exact = index.exact.get(key);
  if (exact !== undefined) return getBook(exact);

  if (key.length < MIN_PREFIX_LENGTH) return undefined;
  const matches = new Set<number>();
  for (const entry of index.keys) {
    if (entry.key.startsWith(key)) matches.add(entry.book);
    if (matches.size > 1) return undefined;
  }
  const only = matches.values().next();
  return only.done ? undefined : getBook(only.value);
}

/* ------------------------------------------------------------------ */
/* Quick-jump parser                                                   */
/* ------------------------------------------------------------------ */

export interface ParsedReference {
  book: number;
  /** null when only a book was typed ("John"). */
  chapter: number | null;
  /** null when no verse was typed ("John 3"). */
  verse: number | null;
  /** Last verse of a range ("John 3:16-18" gives 18), otherwise null. */
  verseEnd: number | null;
}

/**
 * Book part, then an optional chapter, then an optional ":verse" and an
 * optional "-endVerse". The book part is matched lazily so that "1 John 3"
 * splits into book "1 John" and chapter 3.
 */
const REFERENCE_PATTERN = /^(.*?)(?:\s*(\d+)(?:\s*[:.,]\s*(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?)?)?$/;

/**
 * Parse text like "John 3:16", "Juan 3:16-18", "1 Cor 13", "Mga Awit 23",
 * "Jude 5" or just "Genesis". Returns null when the text is not a valid
 * reference (unknown book, chapter past the end of the book, verse 0), so the
 * caller can fall back to a normal text search.
 *
 * Books with one chapter (Obadiah, Philemon, 2 John, 3 John, Jude) read a
 * single number as a verse: "Jude 5" is Jude 1:5.
 */
export function parseReference(input: string): ParsedReference | null {
  const text = input.trim();
  if (text.length === 0 || text.length > 60) return null;

  const match = REFERENCE_PATTERN.exec(text);
  if (!match) return null;

  const bookText = match[1] ?? '';
  const first = match[2];
  const second = match[3];
  const third = match[4];

  const book = findBook(bookText);
  if (!book) return null;

  const total = book.chapters;
  let chapter: number | null = null;
  let verse: number | null = null;
  let verseEnd: number | null = null;

  if (first !== undefined && second === undefined && total === 1) {
    // "Jude 5": the only number is a verse in chapter 1.
    chapter = 1;
    verse = Number(first);
  } else {
    if (first !== undefined) chapter = Number(first);
    if (second !== undefined) verse = Number(second);
    if (third !== undefined) verseEnd = Number(third);
  }

  if (chapter !== null && (chapter < 1 || chapter > total)) return null;
  if (verse !== null && (verse < 1 || verse > MAX_PART)) return null;
  if (verseEnd !== null) {
    // A reversed or oversized range is ignored rather than rejected.
    if (verse === null || verseEnd <= verse || verseEnd > MAX_PART) verseEnd = null;
  }

  return { book: book.id, chapter, verse, verseEnd };
}

/**
 * True when the text names a book AND a chapter ("John 3"). A lone word such
 * as "mark" or "job" is far more likely to be a search, so the Search screen
 * should use this to decide whether to jump or to search.
 */
export function isChapterReference(input: string): boolean {
  const parsed = parseReference(input);
  return parsed !== null && parsed.chapter !== null;
}

/** Verse ids a parsed reference covers, as a range. Book-only gives the whole book. */
export function referenceToRange(ref: ParsedReference): { fromId: VerseId; toId: VerseId } {
  if (ref.chapter === null) return bookIdRange(ref.book);
  if (ref.verse === null) return chapterRange(ref.book, ref.chapter);
  const last = ref.verseEnd ?? ref.verse;
  return {
    fromId: makeVerseId(ref.book, ref.chapter, ref.verse),
    toId: makeVerseId(ref.book, ref.chapter, last),
  };
}
