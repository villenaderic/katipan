import { File, Paths } from 'expo-file-system';

import { chapterCount } from '../constants/books';
import { BUNDLED_PACK_IDS, DAILY_VERSE_COUNT, DEFAULT_TRANSLATION } from '../constants/config';
import type { LangCode, VerseId } from '../types';
import { addDays, dailyVerseIndex, startOfDay, toDateKey } from '../utils/date';
import { cleanVerseText } from '../utils/format';
import { formatVerseId, parseVerseId } from '../utils/reference';
import { isPackInstalled, loadVerses } from './bibleService';

/**
 * The verse of the day. Works fully offline and gives the same verse to
 * everyone on the same calendar date:
 *
 *   verse id = list[dailyVerseIndex(date)]      (a fixed 366-day calendar)
 *   text     = read from the person's chosen translation
 *
 * The list holds references only (verse ids), never text, so it works for
 * every translation and language.
 *
 * File format (assets/data/daily-verses.json, and the downloaded update):
 *   { "version": 1, "verses": [43003016, 19023001, ... 366 numbers ...] }
 * Each number is book*1000000 + chapter*1000 + verse. tools/generate-daily-verses.js
 * must write exactly this shape.
 *
 * A downloaded list (manifest "dailyVerses") is saved next to the packs and
 * used only if it is valid and newer than the bundled one.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface DailyVerse {
  /** Local calendar date, "2026-10-30". */
  date: string;
  verseId: VerseId;
  /** "John 3:16" or "Juan 3:16", in the interface language. */
  reference: string;
  text: string;
  /** Pack id the text came from. May differ from the one asked for if that pack lacks the verse. */
  translation: string;
}

interface DailyVerseList {
  version: number;
  verses: readonly VerseId[];
}

/* ------------------------------------------------------------------ */
/* Loading the list                                                    */
/* ------------------------------------------------------------------ */

/**
 * The list shipped inside the app. Metro reads the .json file as source, so
 * it is parsed once at startup. It is typed as unknown on purpose: it is
 * validated like any other input.
 */
const BUNDLED_LIST: unknown = require('../../assets/data/daily-verses.json');

const INSTALLED_FILE_NAME = 'daily-verses.json';

function installedFile(): File {
  return new File(Paths.document, INSTALLED_FILE_NAME);
}

/** True when `id` is a real verse reference: book 1..66, chapter that exists, verse 1 or more. */
function isPlausibleVerseId(id: unknown): id is VerseId {
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return false;
  const ref = parseVerseId(id);
  return ref.verse >= 1 && ref.chapter >= 1 && ref.chapter <= chapterCount(ref.book);
}

/** Accepts only the exact shape above, with 366 valid references. Anything else returns null. */
function validateList(data: unknown): DailyVerseList | null {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as { version?: unknown; verses?: unknown };

  const version = candidate.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;

  const verses = candidate.verses;
  if (!Array.isArray(verses) || verses.length !== DAILY_VERSE_COUNT) return null;
  const ids: VerseId[] = [];
  for (const item of verses as unknown[]) {
    if (!isPlausibleVerseId(item)) return null;
    ids.push(item);
  }
  return { version, verses: ids };
}

let listPromise: Promise<DailyVerseList> | null = null;

async function readInstalledList(): Promise<DailyVerseList | null> {
  try {
    const file = installedFile();
    if (!file.exists) return null;
    return validateList(JSON.parse(await file.text()) as unknown);
  } catch {
    return null;
  }
}

async function loadList(): Promise<DailyVerseList> {
  const bundled = validateList(BUNDLED_LIST);
  const installed = await readInstalledList();

  if (installed && (!bundled || installed.version > bundled.version)) return installed;
  if (bundled) return bundled;

  // Only reachable if the file shipped in the app is broken. Fail loudly in
  // development instead of showing a wrong verse.
  throw new Error('assets/data/daily-verses.json is missing or invalid');
}

function getList(): Promise<DailyVerseList> {
  if (!listPromise) {
    listPromise = loadList().catch((error: unknown) => {
      listPromise = null;
      throw error;
    });
  }
  return listPromise;
}

/** Version number of the list in use (shown on the Updates screen). */
export async function getDailyVersesVersion(): Promise<number> {
  return (await getList()).version;
}

/**
 * Install a downloaded list. The file must already have passed its SHA-256
 * check. It is validated again here; an invalid file is left alone and an
 * Error is thrown. On success the file is moved into place and consumed.
 */
export async function installDailyVerses(downloadedUri: string): Promise<number> {
  const source = new File(downloadedUri);
  if (!source.exists) throw new Error('Daily verse list not found');

  const parsed = validateList(JSON.parse(await source.text()) as unknown);
  if (!parsed) throw new Error('Daily verse list failed verification');

  const live = installedFile();
  if (live.exists) live.delete();
  source.move(live);

  listPromise = null;
  return parsed.version;
}

/* ------------------------------------------------------------------ */
/* Which verse                                                         */
/* ------------------------------------------------------------------ */

/** The verse id for a date. Needs no translation and no database. */
export async function getDailyVerseId(date: Date = new Date()): Promise<VerseId> {
  const list = await getList();
  const id = list.verses[dailyVerseIndex(date)];
  if (id === undefined) throw new Error('Daily verse index out of range');
  return id;
}

/* ------------------------------------------------------------------ */
/* Which text                                                          */
/* ------------------------------------------------------------------ */

/** Preferred pack first, then the language default, then the bundled packs, no repeats. */
async function packCandidates(preferred: string, lang: LangCode): Promise<string[]> {
  const wanted = [preferred, DEFAULT_TRANSLATION[lang], ...BUNDLED_PACK_IDS];
  const result: string[] = [];
  for (const id of wanted) {
    if (result.includes(id)) continue;
    if (await isPackInstalled(id)) result.push(id);
  }
  return result;
}

/**
 * Text for several verse ids. Asks the preferred pack first and only asks the
 * next pack for what is still missing.
 */
async function readTexts(
  ids: readonly VerseId[],
  preferred: string,
  lang: LangCode,
): Promise<Map<VerseId, { text: string; pack: string }>> {
  const found = new Map<VerseId, { text: string; pack: string }>();
  const unique = Array.from(new Set(ids));

  for (const pack of await packCandidates(preferred, lang)) {
    const missing = unique.filter((id) => !found.has(id));
    if (missing.length === 0) break;

    const rows = await loadVerses(pack, missing);
    for (const row of rows) {
      const text = cleanVerseText(row.text);
      if (text.length > 0) found.set(row.id, { text, pack });
    }
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

/**
 * Today's verse (or the verse for any date) with its text. Returns null only
 * if no installed pack contains the verse, which should not happen with the
 * bundled packs.
 */
export async function getDailyVerse(
  translationId: string,
  lang: LangCode,
  date: Date = new Date(),
): Promise<DailyVerse | null> {
  const verseId = await getDailyVerseId(date);
  const texts = await readTexts([verseId], translationId, lang);
  const hit = texts.get(verseId);
  if (!hit) return null;

  return {
    date: toDateKey(date),
    verseId,
    reference: formatVerseId(verseId, lang),
    text: hit.text,
    translation: hit.pack,
  };
}

/**
 * The verses for `count` days in a row starting on `from` (today by default),
 * for scheduling notifications. Uses one database read per pack, not one per
 * day. A day whose verse cannot be found is left out.
 */
export async function getDailyVersesAhead(
  translationId: string,
  lang: LangCode,
  count: number,
  from: Date = new Date(),
): Promise<DailyVerse[]> {
  if (count <= 0) return [];

  const list = await getList();
  const first = startOfDay(from);

  const days: { date: Date; verseId: VerseId }[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = addDays(first, i);
    const verseId = list.verses[dailyVerseIndex(date)];
    if (verseId !== undefined) days.push({ date, verseId });
  }

  const texts = await readTexts(
    days.map((day) => day.verseId),
    translationId,
    lang,
  );

  const result: DailyVerse[] = [];
  for (const day of days) {
    const hit = texts.get(day.verseId);
    if (!hit) continue;
    result.push({
      date: toDateKey(day.date),
      verseId: day.verseId,
      reference: formatVerseId(day.verseId, lang),
      text: hit.text,
      translation: hit.pack,
    });
  }
  return result;
}
