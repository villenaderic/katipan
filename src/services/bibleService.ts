import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { BUNDLED_PACK_IDS, DEFAULT_TRANSLATION, FOLDERS, APP_VERSION } from '../constants/config';
import { chapterCount } from '../constants/books';
import { closePackDb, getPackDb, getUserDb, isValidPackId, verifyPackDb } from '../db/client';
import { getChapter, getPackMeta, getVerse, getVerseRange, getVerses } from '../db/queries/bible';
import { loadStoredSettings, saveSetting } from '../db/queries/user';
import type { InstalledPack, LangCode, PackMeta, VerseId, VerseRow } from '../types';
import { adjacentChapter } from '../utils/reference';

/**
 * Everything the app needs to know about Bible packs on the phone:
 *   - where they live, and copying the two bundled packs there on first run
 *   - which packs are installed, and their size and version
 *   - reading chapters and verses from any pack, with a small cache
 *   - installing a new or updated pack safely (verify, swap, roll back)
 *   - deleting a downloaded pack
 *
 * It never touches user.db except for one bookkeeping setting that remembers
 * which app version last checked the bundled packs. Downloading is
 * downloadService's job; this file only receives a finished file.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type BundledPackId = (typeof BUNDLED_PACK_IDS)[number];

/** Pack metadata plus what is on disk. Shown in the Translation Manager. */
export interface PackInfo extends PackMeta {
  bytes: number;
  bundled: boolean;
}

/* ------------------------------------------------------------------ */
/* Bundled packs                                                       */
/* ------------------------------------------------------------------ */

/**
 * Metro turns a required .db file into a numeric asset id. `require` has no
 * type for assets, so the cast to number is deliberate. The files themselves
 * are created by tools/build-bible-db.js into assets/data/.
 */
const BUNDLED_ASSETS: Record<BundledPackId, number> = {
  web: require('../../assets/data/web.db') as number,
  adb1905: require('../../assets/data/adb1905.db') as number,
};

/** user.db setting: the app version that last checked the bundled packs. */
const BUNDLED_CHECK_KEY = 'bundledPacksCheckedVersion';

function isBundledId(id: string): id is BundledPackId {
  return (BUNDLED_PACK_IDS as readonly string[]).includes(id);
}

/* ------------------------------------------------------------------ */
/* Folders and files                                                   */
/* ------------------------------------------------------------------ */

function folderName(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

function packsDirectory(): Directory {
  return new Directory(Paths.document, folderName(FOLDERS.packs));
}

function tempDirectory(): Directory {
  return new Directory(Paths.cache, folderName(FOLDERS.temp));
}

function ensureDirectory(directory: Directory): void {
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
}

/** The folder that holds `<id>.db` files, as a file:// URI. */
export function getPacksDirectoryUri(): string {
  ensureDirectory(packsDirectory());
  return packsDirectory().uri;
}

/** A scratch folder for downloads. downloadService writes here, then calls installPack. */
export function getTempDirectoryUri(): string {
  ensureDirectory(tempDirectory());
  return tempDirectory().uri;
}

function packFile(id: string): File {
  return new File(packsDirectory(), `${id}.db`);
}

/** A pack being installed, next to the live one so the final rename is atomic. */
function stagedFile(id: string): File {
  return new File(packsDirectory(), `${id}.new.db`);
}

/** The previous version, kept until the new one has opened successfully. */
function backupFile(id: string): File {
  return new File(packsDirectory(), `${id}.bak.db`);
}

function removeIfExists(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Nothing more can be done for a file that will not delete.
  }
}

/** Also remove SQLite side files that could confuse the next open. */
function removeWithSideFiles(file: File): void {
  removeIfExists(file);
  const dir = packsDirectory();
  for (const suffix of ['-journal', '-wal', '-shm']) {
    removeIfExists(new File(dir, `${file.name}${suffix}`));
  }
}

function sizeOf(file: File): number {
  const size: unknown = file.size;
  return typeof size === 'number' && Number.isFinite(size) ? size : 0;
}

/** expo-sqlite wants a plain path, not a file:// URI. */
function plainPath(directoryUri: string): string {
  const stripped = directoryUri.startsWith('file://') ? directoryUri.slice('file://'.length) : directoryUri;
  return stripped.endsWith('/') ? stripped.slice(0, -1) : stripped;
}

/* ------------------------------------------------------------------ */
/* Simple lock                                                         */
/* ------------------------------------------------------------------ */

/**
 * Installing, deleting and reading the pack list must not overlap (a swap
 * closes and reopens a database). This runs one job at a time.
 */
let lockChain: Promise<unknown> = Promise.resolve();

function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = lockChain.then(() => job());
  lockChain = run.catch(() => undefined);
  return run;
}

/* ------------------------------------------------------------------ */
/* Caches                                                              */
/* ------------------------------------------------------------------ */

const MAX_CACHED_CHAPTERS = 8;

const chapterCache = new Map<string, readonly VerseRow[]>();
const infoCache = new Map<string, PackInfo>();

function chapterKey(packId: string, book: number, chapter: number): string {
  return `${packId}:${book}:${chapter}`;
}

/** Forget cached text for one pack, or for every pack. Called after any install or delete. */
export function clearPackCaches(packId?: string): void {
  if (packId === undefined) {
    chapterCache.clear();
    infoCache.clear();
    return;
  }
  infoCache.delete(packId);
  const prefix = `${packId}:`;
  for (const key of Array.from(chapterCache.keys())) {
    if (key.startsWith(prefix)) chapterCache.delete(key);
  }
}

/* ------------------------------------------------------------------ */
/* Checking a pack file                                                */
/* ------------------------------------------------------------------ */

/**
 * Open a pack file that is NOT yet in use, check it is a complete Bible pack,
 * and return its metadata. Returns null for anything wrong. Always closes
 * the database again. Never throws.
 */
async function inspectPackFile(file: File): Promise<PackMeta | null> {
  if (!file.exists) return null;
  let db: SQLiteDatabase | null = null;
  try {
    db = await openDatabaseAsync(file.name, { useNewConnection: true }, plainPath(packsDirectory().uri));
    await db.execAsync('PRAGMA query_only = ON;');
    if (!(await verifyPackDb(db))) return null;
    return await getPackMeta(db);
  } catch {
    return null;
  } finally {
    if (db) {
      try {
        await db.closeAsync();
      } catch {
        // Already closed.
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Installing                                                          */
/* ------------------------------------------------------------------ */

/**
 * Put `source` in place as pack `id`. The source file is moved or copied next
 * to the live pack, checked, then swapped in. The old pack is kept until the
 * new one opens; if anything fails the old pack is put back and an Error is
 * thrown, so the app never ends up without a working translation.
 *
 * `mode` is 'move' for a file we downloaded (it is consumed) and 'copy' for
 * a bundled asset (the original must stay).
 */
async function installPackFile(id: string, source: File, mode: 'move' | 'copy'): Promise<PackMeta> {
  if (!isValidPackId(id)) throw new Error(`Invalid pack id: ${id}`);
  if (!source.exists) throw new Error(`Pack file not found for ${id}`);

  ensureDirectory(packsDirectory());
  const staged = stagedFile(id);
  const live = packFile(id);
  const backup = backupFile(id);

  // 1. Stage it next to the live pack.
  removeWithSideFiles(staged);
  if (mode === 'move') source.move(staged);
  else source.copy(staged);

  // 2. Check it before it can replace anything.
  const meta = await inspectPackFile(staged);
  if (!meta || meta.id !== id) {
    removeWithSideFiles(staged);
    throw new Error(`Pack ${id} failed verification`);
  }

  // 3. Swap. Close our connection first so no handle points at the old file.
  await closePackDb(id);
  clearPackCaches(id);

  const hadLive = live.exists;
  removeWithSideFiles(backup);
  try {
    if (hadLive) live.move(backup);
    staged.move(live);
  } catch (error) {
    // Put things back exactly as they were.
    removeWithSideFiles(live);
    if (hadLive && backup.exists) backup.move(live);
    removeWithSideFiles(staged);
    throw error instanceof Error ? error : new Error(`Could not install pack ${id}`);
  }

  // 4. The new pack must really open. If not, roll back.
  const opened = await inspectPackFile(live);
  if (!opened) {
    await closePackDb(id);
    removeWithSideFiles(live);
    if (hadLive && backup.exists) backup.move(live);
    clearPackCaches(id);
    throw new Error(`Pack ${id} did not open after install; previous version restored`);
  }

  removeWithSideFiles(backup);
  return opened;
}

/** Copy a bundled pack out of the APK into the packs folder. */
async function installBundledPack(id: BundledPackId): Promise<PackMeta> {
  const asset = Asset.fromModule(BUNDLED_ASSETS[id]);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error(`Bundled pack ${id} is missing from the app`);
  return installPackFile(id, new File(asset.localUri), 'copy');
}

/* ------------------------------------------------------------------ */
/* Startup                                                             */
/* ------------------------------------------------------------------ */

let initPromise: Promise<void> | null = null;

async function runInit(): Promise<void> {
  ensureDirectory(packsDirectory());
  ensureDirectory(tempDirectory());

  // Leftovers from an install that was interrupted (the app was killed).
  for (const id of BUNDLED_PACK_IDS) {
    removeWithSideFiles(stagedFile(id));
    const live = packFile(id);
    const backup = backupFile(id);
    if (!live.exists && backup.exists) backup.move(live);
    else removeWithSideFiles(backup);
  }

  const userDb = await getUserDb();
  const stored = await loadStoredSettings(userDb);
  const appVersionChanged = stored[BUNDLED_CHECK_KEY] !== APP_VERSION;

  for (const id of BUNDLED_PACK_IDS) {
    const live = packFile(id);

    if (!live.exists) {
      await installBundledPack(id);
      continue;
    }
    if (!appVersionChanged) continue;

    // The app was updated. Keep the installed pack if it is the same or newer
    // (a content update may be ahead of the bundle). Replace it if it is
    // older or damaged.
    const installed = await inspectPackFile(live);
    const bundled = await readBundledVersion(id);
    if (!installed || (bundled !== null && bundled > installed.version)) {
      await installBundledPack(id);
    }
  }

  if (appVersionChanged) await saveSetting(userDb, BUNDLED_CHECK_KEY, APP_VERSION);
}

/** Version number of the pack inside the APK, or null if it cannot be read. */
async function readBundledVersion(id: BundledPackId): Promise<number | null> {
  const probe = new File(tempDirectory(), `${id}.probe.db`);
  try {
    const asset = Asset.fromModule(BUNDLED_ASSETS[id]);
    await asset.downloadAsync();
    if (!asset.localUri) return null;

    removeWithSideFiles(probe);
    new File(asset.localUri).copy(probe);

    let db: SQLiteDatabase | null = null;
    try {
      db = await openDatabaseAsync(probe.name, { useNewConnection: true }, plainPath(tempDirectory().uri));
      const meta = await getPackMeta(db);
      return meta ? meta.version : null;
    } finally {
      if (db) await db.closeAsync();
    }
  } catch {
    return null;
  } finally {
    removeIfExists(probe);
  }
}

/**
 * Call once at app start (the root layout does) and again from anywhere that
 * needs packs: it is cheap after the first run. The first launch copies the
 * two bundled packs out of the APK, which takes a moment.
 */
export function initBibleService(): Promise<void> {
  if (!initPromise) {
    initPromise = runInit().catch((error: unknown) => {
      // Do not cache a failure: the next call tries again.
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

/* ------------------------------------------------------------------ */
/* Pack list                                                           */
/* ------------------------------------------------------------------ */

const PACK_FILE_PATTERN = /^([a-z0-9_-]{1,32})\.db$/;

async function openPack(id: string): Promise<SQLiteDatabase> {
  await initBibleService();
  return getPackDb(id, getPacksDirectoryUri());
}

/** True when `<id>.db` is on the phone. Does not open it. */
export async function isPackInstalled(id: string): Promise<boolean> {
  if (!isValidPackId(id)) return false;
  await initBibleService();
  return packFile(id).exists;
}

/** Details of one installed pack, or null if it is missing or unreadable. */
export async function getPackInfo(id: string): Promise<PackInfo | null> {
  if (!(await isPackInstalled(id))) return null;

  const cached = infoCache.get(id);
  if (cached) return cached;

  try {
    const db = await openPack(id);
    const meta = await getPackMeta(db);
    if (!meta) return null;
    const info: PackInfo = { ...meta, bytes: sizeOf(packFile(id)), bundled: isBundledId(id) };
    infoCache.set(id, info);
    return info;
  } catch {
    return null;
  }
}

/** Every pack that is installed and opens, bundled ones first, then by id. */
export async function listInstalledPacks(): Promise<InstalledPack[]> {
  await initBibleService();

  const ids: string[] = [];
  for (const item of packsDirectory().list()) {
    if (!(item instanceof File)) continue;
    const match = PACK_FILE_PATTERN.exec(item.name);
    if (match && match[1]) ids.push(match[1]);
  }

  const result: InstalledPack[] = [];
  for (const id of ids) {
    const info = await getPackInfo(id);
    if (info) result.push({ id, version: info.version, bytes: info.bytes, bundled: info.bundled });
  }

  return result.sort((a, b) => {
    if (a.bundled !== b.bundled) return a.bundled ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Total bytes used by all installed packs (the Translation Manager footer). */
export async function getPacksTotalBytes(): Promise<number> {
  const packs = await listInstalledPacks();
  return packs.reduce((sum, pack) => sum + pack.bytes, 0);
}

/**
 * The pack to read from: `preferredId` if it is installed, otherwise the
 * default for the interface language, otherwise any bundled pack. Returns
 * null only if no pack at all can be found.
 */
export async function resolveTranslation(preferredId: string, lang: LangCode): Promise<string | null> {
  const candidates = [preferredId, DEFAULT_TRANSLATION[lang], ...BUNDLED_PACK_IDS];
  for (const id of candidates) {
    if (await isPackInstalled(id)) return id;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Installing and deleting (public)                                    */
/* ------------------------------------------------------------------ */

/**
 * Install or update a pack from a finished, already checksum-verified file.
 * The file is moved into place and consumed. Throws if the file is not a
 * valid pack for `id`; in that case the previous version keeps working.
 */
export async function installPack(id: string, downloadedUri: string): Promise<PackInfo> {
  await initBibleService();
  await exclusive(() => installPackFile(id, new File(downloadedUri), 'move'));
  clearPackCaches(id);
  const info = await getPackInfo(id);
  if (!info) throw new Error(`Pack ${id} is not readable after install`);
  return info;
}

/**
 * Delete a downloaded pack to free space. The two bundled packs cannot be
 * deleted (the app must always have something to read), so this throws for them.
 */
export async function deletePack(id: string): Promise<void> {
  if (!isValidPackId(id)) throw new Error(`Invalid pack id: ${id}`);
  if (isBundledId(id)) throw new Error(`Bundled pack ${id} cannot be deleted`);

  await initBibleService();
  await exclusive(async () => {
    await closePackDb(id);
    clearPackCaches(id);
    removeWithSideFiles(packFile(id));
    removeWithSideFiles(backupFile(id));
    removeWithSideFiles(stagedFile(id));
  });
}

/* ------------------------------------------------------------------ */
/* Reading text                                                        */
/* ------------------------------------------------------------------ */

/**
 * One chapter of one translation, in verse order. Returns an empty list when
 * the pack does not contain it (for example a New Testament only pack asked
 * for Genesis) or when the chapter does not exist. The result is shared with
 * the cache, so treat it as read-only.
 */
export async function loadChapter(
  packId: string,
  book: number,
  chapter: number,
): Promise<readonly VerseRow[]> {
  if (chapter < 1 || chapter > chapterCount(book)) return [];

  const key = chapterKey(packId, book, chapter);
  const cached = chapterCache.get(key);
  if (cached) {
    // Mark as most recently used.
    chapterCache.delete(key);
    chapterCache.set(key, cached);
    return cached;
  }

  const db = await openPack(packId);
  const verses = await getChapter(db, book, chapter);

  chapterCache.set(key, verses);
  if (chapterCache.size > MAX_CACHED_CHAPTERS) {
    const oldest = chapterCache.keys().next();
    if (!oldest.done) chapterCache.delete(oldest.value);
  }
  return verses;
}

/**
 * Warm the cache for the chapters before and after, so swiping to the next
 * chapter feels instant. Never throws and never blocks the caller.
 */
export function prefetchAdjacentChapters(packId: string, book: number, chapter: number): void {
  for (const direction of [1, -1] as const) {
    const next = adjacentChapter(book, chapter, direction);
    if (next) {
      loadChapter(packId, next.book, next.chapter).catch(() => {
        // A failed prefetch only means the chapter loads when it is opened.
      });
    }
  }
}

/** One verse, or null if this pack lacks it. */
export async function loadVerse(packId: string, id: VerseId): Promise<VerseRow | null> {
  const db = await openPack(packId);
  return getVerse(db, id);
}

/** Several verses in the order of `ids` (highlights, bookmarks, notes). Missing ids are skipped. */
export async function loadVerses(packId: string, ids: readonly VerseId[]): Promise<VerseRow[]> {
  const db = await openPack(packId);
  return getVerses(db, ids);
}

/** Every verse from `fromId` to `toId` inclusive, across chapters if needed. */
export async function loadVerseRange(
  packId: string,
  fromId: VerseId,
  toId: VerseId,
): Promise<VerseRow[]> {
  const db = await openPack(packId);
  return getVerseRange(db, fromId, toId);
}

/**
 * The open database of a pack, for code that runs its own read-only query
 * (search). Prefer the load* functions above for everything else.
 */
export function getPackDatabase(packId: string): Promise<SQLiteDatabase> {
  return openPack(packId);
}
