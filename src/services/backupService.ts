import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { chapterCount, getBook } from '../constants/books';
import { APP_VERSION } from '../constants/config';
import { getUserDb, isValidPackId } from '../db/client';
import { getAllBookmarks, getAllHighlights, getAllNotes, getNoteTagMap, normalizeTagNames } from '../db/queries/user';
import type { HighlightColor, LangCode, VerseId } from '../types';
import { toDateKey, formatDateTimeStamp, formatFileStamp } from '../utils/date';
import { cleanVerseText } from '../utils/format';
import { formatVerseId, makeVerseId, parseVerseId } from '../utils/reference';
import type { Translate } from '../i18n';
import { getPackInfo, loadVerses, resolveTranslation } from './bibleService';

/**
 * Backup: take your highlights, bookmarks and notes OUT of the app, and bring
 * them back IN. Everything you made belongs to you (Section 5).
 *
 * TWO FILE KINDS
 *   JSON      The backup. Exactly what is needed to restore, and nothing else.
 *             Verse ids and translation ids only, never verse text, the same
 *             rule as user.db. This is the only kind the app can import.
 *   Markdown  A readable copy for people: references, verse text, your notes.
 *             Read it, print it, paste it into another app. Not importable.
 *
 * WHAT IS LEFT OUT ON PURPOSE
 *   Settings (they describe this phone), reading progress and plan progress.
 *   A backup is about what you wrote, not how the app is set up.
 *
 * IMPORT NEVER CHANGES WHAT IS ALREADY ON THIS PHONE
 *   It only adds. A verse that is already highlighted keeps its color, a verse
 *   already bookmarked keeps its label, and a note with the same verse and the
 *   same text is not added twice. So importing the same file twice, or an old
 *   backup over newer work, can never overwrite or delete anything.
 *   All of an import runs in ONE transaction: it finishes completely or not at all.
 *
 * NO STRINGS EXCEPT THE MARKDOWN FILE
 *   Failures throw BackupError with a `code`; the screen shows its own
 *   translated message for each code (the same rule as shareService). The
 *   Markdown file is text the person reads, so its words come from i18n
 *   through the `t` function the caller passes in.
 *
 * NO NETWORK. The only way a file leaves the phone is the system share sheet,
 * which the person controls.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Raise this only when the JSON layout changes in a way old apps cannot read. */
export const BACKUP_FORMAT = 1;

const BACKUP_APP_ID = 'katipan';

/** Refuse files bigger than this before reading them (a big library is only a few MB). */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Refuse lists longer than this: no real library comes close, a hostile file might. */
const MAX_ITEMS_PER_LIST = 200_000;

const MAX_NOTE_LENGTH = 100_000;
const MAX_LABEL_LENGTH = 200;
const MAX_TAGS_PER_NOTE = 20;

/** The longest chapter in the Bible (Psalm 119) has 176 verses. */
const MAX_VERSE_NUMBER = 176;

const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'orange'];

const EXPORT_FOLDER = 'exports';

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type BackupErrorCode =
  /** There is nothing to export yet. */
  | 'empty'
  /** The file could not be found or read. */
  | 'unreadable'
  /** The file is not a Katipan backup (not JSON, or the wrong kind of JSON). */
  | 'notBackup'
  /** The backup was made by a newer version of Katipan than this one. */
  | 'tooNew'
  /** The file is far bigger than any real backup. */
  | 'tooLarge'
  /** Writing the export file or the database failed. Nothing was changed. */
  | 'writeFailed'
  /** This phone cannot open the share sheet for files. */
  | 'shareUnavailable';

export class BackupError extends Error {
  readonly code: BackupErrorCode;

  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* File format                                                         */
/* ------------------------------------------------------------------ */

interface BackupHighlight {
  verseId: VerseId;
  translation: string;
  color: HighlightColor;
  createdAt: number;
}

interface BackupBookmark {
  verseId: VerseId;
  translation: string;
  label: string | null;
  createdAt: number;
}

interface BackupNote {
  verseId: VerseId;
  translation: string;
  body: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface BackupCounts {
  highlights: number;
  bookmarks: number;
  notes: number;
}

/**
 * What the JSON file looks like. `ref` is only there so a person who opens the
 * file can see which verse a number means; the app ignores it on import.
 */
interface BackupFileJson {
  app: typeof BACKUP_APP_ID;
  format: number;
  exportedAt: string;
  appVersion: string;
  highlights: (BackupHighlight & { ref: string })[];
  bookmarks: (BackupBookmark & { ref: string })[];
  notes: (BackupNote & { ref: string })[];
}

/** A backup that has been read and checked. Nothing is written until applyBackup. */
export interface ParsedBackup {
  readonly highlights: readonly BackupHighlight[];
  readonly bookmarks: readonly BackupBookmark[];
  readonly notes: readonly BackupNote[];
  /** Entries that were skipped because they were damaged or did not make sense. */
  readonly invalid: number;
  /** When the backup was made (ISO text), or null if the file does not say. */
  readonly exportedAt: string | null;
}

export interface ImportCount {
  added: number;
  /** Already on this phone, so left as they were. */
  skipped: number;
}

export interface ImportResult {
  highlights: ImportCount;
  bookmarks: ImportCount;
  notes: ImportCount;
  /** Damaged entries in the file that were ignored. */
  invalid: number;
}

export interface ExportResult {
  /** file:// URI of the file, ready for the share sheet. */
  uri: string;
  fileName: string;
  mimeType: string;
  uti: string;
  counts: BackupCounts;
}

/* ------------------------------------------------------------------ */
/* Reading everything from user.db                                     */
/* ------------------------------------------------------------------ */

interface LibraryData {
  highlights: BackupHighlight[];
  bookmarks: BackupBookmark[];
  notes: BackupNote[];
}

async function readLibrary(db: SQLiteDatabase): Promise<LibraryData> {
  const [highlights, bookmarks, notes, tagMap] = await Promise.all([
    getAllHighlights(db),
    getAllBookmarks(db),
    getAllNotes(db),
    getNoteTagMap(db),
  ]);

  return {
    highlights: highlights.map((row) => ({
      verseId: row.verse_id,
      translation: row.translation,
      color: row.color,
      createdAt: row.created_at,
    })),
    bookmarks: bookmarks.map((row) => ({
      verseId: row.verse_id,
      translation: row.translation,
      label: row.label,
      createdAt: row.created_at,
    })),
    notes: notes.map((row) => ({
      verseId: row.verse_id,
      translation: row.translation,
      body: row.body,
      tags: tagMap.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

function countsOf(data: LibraryData): BackupCounts {
  return {
    highlights: data.highlights.length,
    bookmarks: data.bookmarks.length,
    notes: data.notes.length,
  };
}

function isEmpty(counts: BackupCounts): boolean {
  return counts.highlights + counts.bookmarks + counts.notes === 0;
}

/** How many things are in the library right now (for "Export (12 items)" on the Backup screen). */
export async function getLibraryCounts(): Promise<BackupCounts> {
  return countsOf(await readLibrary(await getUserDb()));
}

/* ------------------------------------------------------------------ */
/* Writing the export file                                             */
/* ------------------------------------------------------------------ */

function exportsDirectory(): Directory {
  return new Directory(Paths.cache, EXPORT_FOLDER);
}

/**
 * Delete earlier export files. They hold the person's notes, so they are
 * removed as soon as the share sheet is done (the Backup screen calls this)
 * and again before every new export. Never throws.
 */
export function clearExports(): void {
  try {
    const directory = exportsDirectory();
    if (directory.exists) directory.delete();
  } catch {
    // Nothing useful to do. The cache folder is also emptied by Android when space runs low.
  }
}

function writeExportFile(fileName: string, text: string): string {
  try {
    clearExports();
    const directory = exportsDirectory();
    directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, fileName);
    file.create();
    file.write(text);
    return file.uri;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new BackupError('writeFailed', `Could not write the export file: ${reason}`);
  }
}

/* ------------------------------------------------------------------ */
/* Export: JSON                                                        */
/* ------------------------------------------------------------------ */

/**
 * Write a backup file (JSON) to the cache and return it. Call shareExport()
 * to hand it to the share sheet. Throws BackupError('empty') when there is
 * nothing to export.
 */
export async function createJsonExport(): Promise<ExportResult> {
  const data = await readLibrary(await getUserDb());
  const counts = countsOf(data);
  if (isEmpty(counts)) throw new BackupError('empty', 'There is nothing to export yet.');

  const now = new Date();
  const ref = (id: VerseId): string => formatVerseId(id, 'en');

  const file: BackupFileJson = {
    app: BACKUP_APP_ID,
    format: BACKUP_FORMAT,
    exportedAt: now.toISOString(),
    appVersion: APP_VERSION,
    highlights: data.highlights.map((item) => ({ ref: ref(item.verseId), ...item })),
    bookmarks: data.bookmarks.map((item) => ({ ref: ref(item.verseId), ...item })),
    notes: data.notes.map((item) => ({ ref: ref(item.verseId), ...item })),
  };

  const fileName = `katipan-backup-${formatFileStamp(now)}.json`;
  const uri = writeExportFile(fileName, JSON.stringify(file, null, 2));
  return { uri, fileName, mimeType: 'application/json', uti: 'public.json', counts };
}

/* ------------------------------------------------------------------ */
/* Export: Markdown                                                    */
/* ------------------------------------------------------------------ */

/** Turn text into a block quote, one "> " per line. */
function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function formatDay(timestampMs: number): string {
  return toDateKey(new Date(timestampMs));
}

/** Verse text for every verse in the library, from one translation. Missing verses are simply absent. */
async function loadVerseTexts(packId: string | null, ids: readonly VerseId[]): Promise<Map<VerseId, string>> {
  const texts = new Map<VerseId, string>();
  if (packId === null || ids.length === 0) return texts;
  try {
    const rows = await loadVerses(packId, ids);
    for (const row of rows) texts.set(row.id, cleanVerseText(row.text));
  } catch {
    // The pack could not be read. The export still works, with references only.
  }
  return texts;
}

/**
 * Write a readable Markdown copy to the cache and return it.
 *
 * `translationId` is the translation whose wording is shown (normally the one
 * the person is reading). If it is not installed, the language's default
 * translation is used, and if no pack opens, the file has references only.
 * `lang` is the language of the headings and of the book names.
 */
export async function createMarkdownExport(
  lang: LangCode,
  translationId: string,
  t: Translate,
): Promise<ExportResult> {
  const data = await readLibrary(await getUserDb());
  const counts = countsOf(data);
  if (isEmpty(counts)) throw new BackupError('empty', 'There is nothing to export yet.');

  const packId = await resolveTranslation(translationId, lang);
  const packInfo = packId === null ? null : await getPackInfo(packId);
  const translationName = packInfo?.name ?? (packId === null ? '' : packId.toUpperCase());

  const wanted = new Set<VerseId>();
  for (const item of data.highlights) wanted.add(item.verseId);
  for (const item of data.bookmarks) wanted.add(item.verseId);
  for (const item of data.notes) wanted.add(item.verseId);
  const texts = await loadVerseTexts(packId, Array.from(wanted));

  const ref = (id: VerseId): string => formatVerseId(id, lang);
  const verseBlock = (id: VerseId): string => {
    const text = texts.get(id);
    return text === undefined ? `> ${t('backup.md.verseMissing')}` : quote(text);
  };

  const now = new Date();
  const out: string[] = [];

  out.push(`# ${t('backup.md.title')}`);
  out.push('');
  out.push(t('backup.md.exported', { date: formatDateTimeStamp(now) }));
  if (translationName !== '') {
    out.push('');
    out.push(t('backup.md.translation', { translation: translationName }));
  }

  // Highlights, grouped by color in a fixed order, each group in Bible order.
  if (data.highlights.length > 0) {
    out.push('', `## ${t('backup.md.highlights', { count: data.highlights.length })}`);
    for (const color of HIGHLIGHT_COLORS) {
      const group = data.highlights.filter((item) => item.color === color);
      if (group.length === 0) continue;
      out.push('', `### ${t(`color.${color}`)}`);
      for (const item of group) {
        out.push('', `**${ref(item.verseId)}**`, '', verseBlock(item.verseId));
      }
    }
  }

  if (data.bookmarks.length > 0) {
    out.push('', `## ${t('backup.md.bookmarks', { count: data.bookmarks.length })}`);
    for (const item of data.bookmarks) {
      const label = item.label !== null && item.label.trim() !== '' ? ` (${item.label.trim()})` : '';
      out.push('', `**${ref(item.verseId)}**${label}`, '', verseBlock(item.verseId));
    }
  }

  if (data.notes.length > 0) {
    out.push('', `## ${t('backup.md.notes', { count: data.notes.length })}`);
    for (const item of data.notes) {
      out.push('', `### ${ref(item.verseId)}`, '', verseBlock(item.verseId), '', item.body.trim());
      const details: string[] = [];
      if (item.tags.length > 0) details.push(t('backup.md.tags', { tags: item.tags.join(', ') }));
      details.push(t('backup.md.edited', { date: formatDay(item.updatedAt) }));
      out.push('', `*${details.join(' · ')}*`);
    }
  }

  out.push('', '---', '', t('backup.md.footer'), '');

  const fileName = `katipan-notes-${formatFileStamp(now)}.md`;
  const uri = writeExportFile(fileName, out.join('\n'));
  return { uri, fileName, mimeType: 'text/markdown', uti: 'net.daringfireball.markdown', counts };
}

/* ------------------------------------------------------------------ */
/* Sharing the export                                                  */
/* ------------------------------------------------------------------ */

/**
 * Open the system share sheet with the export file. The person chooses where
 * it goes: their own cloud drive, email, a file manager. Katipan never sends
 * it anywhere. Resolves when the sheet closes, whether or not an app was chosen.
 * `title` is the label some share sheets show above the file.
 */
export async function shareExport(result: ExportResult, title: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new BackupError('shareUnavailable', 'Sharing files is not available on this phone.');
  }
  await Sharing.shareAsync(result.uri, {
    mimeType: result.mimeType,
    dialogTitle: title,
    UTI: result.uti,
  });
}

/* ------------------------------------------------------------------ */
/* Import: reading and checking                                        */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidVerseId(value: unknown): value is VerseId {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return false;
  const { book, chapter, verse } = parseVerseId(value);
  if (getBook(book) === undefined) return false;
  if (chapter < 1 || chapter > chapterCount(book)) return false;
  if (verse < 1 || verse > MAX_VERSE_NUMBER) return false;
  return makeVerseId(book, chapter, verse) === value;
}

function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === 'string' && (HIGHLIGHT_COLORS as readonly string[]).includes(value);
}

/** A usable timestamp in milliseconds, or the fallback when the file has none. */
function timestampOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function cleanHighlight(raw: unknown): BackupHighlight | null {
  if (!isRecord(raw)) return null;
  const { verseId, translation, color, createdAt } = raw;
  if (!isValidVerseId(verseId)) return null;
  if (typeof translation !== 'string' || !isValidPackId(translation)) return null;
  if (!isHighlightColor(color)) return null;
  return { verseId, translation, color, createdAt: timestampOr(createdAt, Date.now()) };
}

function cleanBookmark(raw: unknown): BackupBookmark | null {
  if (!isRecord(raw)) return null;
  const { verseId, translation, label, createdAt } = raw;
  if (!isValidVerseId(verseId)) return null;
  if (typeof translation !== 'string' || !isValidPackId(translation)) return null;
  const trimmed = typeof label === 'string' ? label.trim().slice(0, MAX_LABEL_LENGTH) : '';
  return {
    verseId,
    translation,
    label: trimmed === '' ? null : trimmed,
    createdAt: timestampOr(createdAt, Date.now()),
  };
}

function cleanNote(raw: unknown): BackupNote | null {
  if (!isRecord(raw)) return null;
  const { verseId, translation, body, tags, createdAt, updatedAt } = raw;
  if (!isValidVerseId(verseId)) return null;
  if (typeof translation !== 'string' || !isValidPackId(translation)) return null;
  if (typeof body !== 'string' || body.trim() === '' || body.length > MAX_NOTE_LENGTH) return null;

  const tagNames = Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  const created = timestampOr(createdAt, Date.now());
  const updated = Math.max(timestampOr(updatedAt, created), created);

  return {
    verseId,
    translation,
    body,
    tags: normalizeTagNames(tagNames).slice(0, MAX_TAGS_PER_NOTE),
    createdAt: created,
    updatedAt: updated,
  };
}

/** The list under `key`: missing means empty, anything that is not a list means this is not our file. */
function listFrom(file: Record<string, unknown>, key: string): unknown[] {
  const value = file[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new BackupError('notBackup', `"${key}" is not a list.`);
  }
  if (value.length > MAX_ITEMS_PER_LIST) {
    throw new BackupError('tooLarge', `"${key}" has too many entries.`);
  }
  return value as unknown[];
}

/**
 * Read and check the text of a backup file. Writes nothing. Entries that are
 * damaged are dropped and counted in `invalid`; a file that is not a Katipan
 * backup at all throws BackupError.
 */
export function parseBackup(text: string): ParsedBackup {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  let json: unknown;
  try {
    json = JSON.parse(withoutBom) as unknown;
  } catch {
    throw new BackupError('notBackup', 'The file is not valid JSON.');
  }

  if (!isRecord(json) || json.app !== BACKUP_APP_ID || typeof json.format !== 'number') {
    throw new BackupError('notBackup', 'The file is not a Katipan backup.');
  }
  if (json.format > BACKUP_FORMAT) {
    throw new BackupError('tooNew', 'This backup was made by a newer version of Katipan.');
  }

  const rawHighlights = listFrom(json, 'highlights');
  const rawBookmarks = listFrom(json, 'bookmarks');
  const rawNotes = listFrom(json, 'notes');

  let invalid = 0;
  const highlights: BackupHighlight[] = [];
  const bookmarks: BackupBookmark[] = [];
  const notes: BackupNote[] = [];

  for (const raw of rawHighlights) {
    const item = cleanHighlight(raw);
    if (item) highlights.push(item);
    else invalid += 1;
  }
  for (const raw of rawBookmarks) {
    const item = cleanBookmark(raw);
    if (item) bookmarks.push(item);
    else invalid += 1;
  }
  for (const raw of rawNotes) {
    const item = cleanNote(raw);
    if (item) notes.push(item);
    else invalid += 1;
  }

  const exportedAt = typeof json.exportedAt === 'string' ? json.exportedAt : null;
  return { highlights, bookmarks, notes, invalid, exportedAt };
}

/**
 * Read a backup file the person picked and check it. `uri` must be a file the
 * app can open directly (the document picker's copy in the cache folder).
 * Writes nothing.
 */
export async function readBackupFile(uri: string): Promise<ParsedBackup> {
  let text: string;
  try {
    const file = new File(uri);
    if (!file.exists) throw new Error('missing');
    const size: number | null = file.size;
    if (typeof size === 'number' && size > MAX_FILE_BYTES) {
      throw new BackupError('tooLarge', 'The file is far bigger than any backup.');
    }
    text = await file.text();
  } catch (error: unknown) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('unreadable', 'The file could not be read.');
  }

  if (text.length > MAX_FILE_BYTES) {
    throw new BackupError('tooLarge', 'The file is far bigger than any backup.');
  }
  return parseBackup(text);
}

/** How many entries applying this backup could add at most, for the "Add these?" question. */
export function countParsed(backup: ParsedBackup): BackupCounts {
  return {
    highlights: backup.highlights.length,
    bookmarks: backup.bookmarks.length,
    notes: backup.notes.length,
  };
}

/* ------------------------------------------------------------------ */
/* Import: writing                                                     */
/* ------------------------------------------------------------------ */

/** Key for "same verse, same words": used so a note is never added twice. */
function noteKey(verseId: VerseId, body: string): string {
  return `${verseId}\u0000${body}`;
}

/**
 * Add a checked backup to user.db, in one transaction. Existing highlights,
 * bookmarks and notes are never changed or removed. Throws
 * BackupError('writeFailed') if anything goes wrong; in that case nothing at
 * all was added.
 *
 * (These inserts live here rather than in db/queries/user.ts because they
 * must keep the original timestamps, which the everyday queries do not.)
 */
export async function applyBackup(backup: ParsedBackup): Promise<ImportResult> {
  const result: ImportResult = {
    highlights: { added: 0, skipped: 0 },
    bookmarks: { added: 0, skipped: 0 },
    notes: { added: 0, skipped: 0 },
    invalid: backup.invalid,
  };

  const db = await getUserDb();

  try {
    await db.withTransactionAsync(async () => {
      // Highlights follow the verse, not the translation: one color per verse.
      const highlighted = new Set<VerseId>(
        (await db.getAllAsync<{ verse_id: number }>('SELECT verse_id FROM highlights')).map(
          (row) => row.verse_id,
        ),
      );
      for (const item of backup.highlights) {
        if (highlighted.has(item.verseId)) {
          result.highlights.skipped += 1;
          continue;
        }
        await db.runAsync(
          'INSERT INTO highlights (verse_id, translation, color, created_at) VALUES (?, ?, ?, ?)',
          item.verseId,
          item.translation,
          item.color,
          item.createdAt,
        );
        highlighted.add(item.verseId);
        result.highlights.added += 1;
      }

      const bookmarked = new Set<VerseId>(
        (await db.getAllAsync<{ verse_id: number }>('SELECT verse_id FROM bookmarks')).map(
          (row) => row.verse_id,
        ),
      );
      for (const item of backup.bookmarks) {
        if (bookmarked.has(item.verseId)) {
          result.bookmarks.skipped += 1;
          continue;
        }
        await db.runAsync(
          'INSERT INTO bookmarks (verse_id, translation, label, created_at) VALUES (?, ?, ?, ?)',
          item.verseId,
          item.translation,
          item.label,
          item.createdAt,
        );
        bookmarked.add(item.verseId);
        result.bookmarks.added += 1;
      }

      const knownNotes = new Set<string>(
        (await db.getAllAsync<{ verse_id: number; body: string }>('SELECT verse_id, body FROM notes')).map(
          (row) => noteKey(row.verse_id, row.body),
        ),
      );
      for (const item of backup.notes) {
        const key = noteKey(item.verseId, item.body);
        if (knownNotes.has(key)) {
          result.notes.skipped += 1;
          continue;
        }
        const inserted = await db.runAsync(
          'INSERT INTO notes (verse_id, translation, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          item.verseId,
          item.translation,
          item.body,
          item.createdAt,
          item.updatedAt,
        );
        const noteId = inserted.lastInsertRowId;
        for (const name of item.tags) {
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
        knownNotes.add(key);
        result.notes.added += 1;
      }
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new BackupError('writeFailed', `Nothing was imported: ${reason}`);
  }

  return result;
}
