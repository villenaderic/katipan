import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { DB_NAMES } from '../constants/config';
import { runUserMigrations } from './migrations';
import { BIBLE_REQUIRED_META_KEYS, BIBLE_REQUIRED_TABLES } from './schema';

/**
 * Database access. Two rules live here:
 *   1. user.db is opened once, migrated, and never replaced by an update.
 *   2. Bible packs are opened per pack id and are read-only for the app.
 */

/* ------------------------------------------------------------------ */
/* user.db                                                             */
/* ------------------------------------------------------------------ */

let userDbPromise: Promise<SQLiteDatabase> | null = null;

async function openUserDb(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(DB_NAMES.user);
  // WAL keeps writes fast and means a crash cannot corrupt highlights or notes.
  await db.execAsync('PRAGMA journal_mode = WAL;');
  // Needed for ON DELETE CASCADE on note_tags. SQLite resets it on every connection.
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await runUserMigrations(db);
  return db;
}

/** The single shared connection to user.db. Safe to call from anywhere, any number of times. */
export function getUserDb(): Promise<SQLiteDatabase> {
  if (!userDbPromise) {
    userDbPromise = openUserDb().catch((error: unknown) => {
      // Do not cache a failure: the next call gets a fresh attempt.
      userDbPromise = null;
      throw error;
    });
  }
  return userDbPromise;
}

/* ------------------------------------------------------------------ */
/* Bible packs                                                         */
/* ------------------------------------------------------------------ */

const packDbPromises = new Map<string, Promise<SQLiteDatabase>>();

/** Pack ids become file names, so allow only a safe character set. */
const PACK_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;

export function isValidPackId(id: string): boolean {
  return PACK_ID_PATTERN.test(id);
}

/** expo-sqlite wants a plain path, not a file:// URI. */
function toPlainPath(directory: string): string {
  const stripped = directory.startsWith('file://') ? directory.slice('file://'.length) : directory;
  return stripped.endsWith('/') ? stripped.slice(0, -1) : stripped;
}

async function openPack(id: string, directory: string): Promise<SQLiteDatabase> {
  // A new connection each time, so replacing a pack file during an update
  // (or rolling back) never leaves us reading a stale, cached handle.
  const db = await openDatabaseAsync(`${id}.db`, { useNewConnection: true }, toPlainPath(directory));
  // Packs are read-only for the app. This blocks any accidental write.
  await db.execAsync('PRAGMA query_only = ON;');
  return db;
}

/**
 * Open the pack with the given id from `directory` (a folder that contains
 * `<id>.db`). Repeated calls for the same id share one connection.
 * The caller (bibleService) decides which folder holds the pack.
 */
export function getPackDb(id: string, directory: string): Promise<SQLiteDatabase> {
  if (!isValidPackId(id)) {
    return Promise.reject(new Error(`Invalid pack id: ${id}`));
  }
  const cached = packDbPromises.get(id);
  if (cached) return cached;

  const promise = openPack(id, directory).catch((error: unknown) => {
    packDbPromises.delete(id);
    throw error;
  });
  packDbPromises.set(id, promise);
  return promise;
}

/** Close one pack. Call this before replacing or deleting its file. */
export async function closePackDb(id: string): Promise<void> {
  const promise = packDbPromises.get(id);
  if (!promise) return;
  packDbPromises.delete(id);
  try {
    const db = await promise;
    await db.closeAsync();
  } catch {
    // It never opened, or is already closed. Nothing left to release.
  }
}

export async function closeAllPackDbs(): Promise<void> {
  const ids = Array.from(packDbPromises.keys());
  await Promise.all(ids.map((id) => closePackDb(id)));
}

/**
 * Check that an open database really is a usable Bible pack: every required
 * table exists, every required meta key is present, and it has verses.
 * Used before an updated pack replaces the old one (rollback on failure)
 * and when a downloaded pack is first installed. Never throws.
 */
export async function verifyPackDb(db: SQLiteDatabase): Promise<boolean> {
  try {
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type IN ('table', 'view')`,
    );
    const have = new Set(tables.map((row) => row.name));
    if (!BIBLE_REQUIRED_TABLES.every((table) => have.has(table))) return false;

    const metaRows = await db.getAllAsync<{ key: string }>(`SELECT key FROM meta`);
    const metaKeys = new Set(metaRows.map((row) => row.key));
    if (!BIBLE_REQUIRED_META_KEYS.every((key) => metaKeys.has(key))) return false;

    const books = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM books`);
    const verses = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM verses`);
    return (books?.n ?? 0) > 0 && (verses?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
