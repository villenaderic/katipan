import type { SQLiteDatabase } from 'expo-sqlite';

import { USER_SCHEMA_V1, USER_SCHEMA_VERSION } from './schema';

/**
 * user.db migrations. The applied version is stored in SQLite's own
 * PRAGMA user_version, so there is no extra table to keep in sync.
 *
 * Rules for adding a migration:
 *   1. Add a new entry at the END of MIGRATIONS with the next version number.
 *   2. Bump USER_SCHEMA_VERSION in schema.ts to match.
 *   3. Only ever ADD (new tables, new columns, new indexes). Never drop or
 *      rewrite a column that holds user data; this file is the only thing
 *      standing between an app update and someone's notes.
 *   4. Never edit a migration that has already shipped.
 */

interface Migration {
  version: number;
  statements: readonly string[];
}

const MIGRATIONS: readonly Migration[] = [{ version: 1, statements: USER_SCHEMA_V1 }];

async function readVersion(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Bring user.db up to the current schema. Each migration runs in its own
 * transaction together with its version bump, so a crash or a failure halfway
 * leaves the database exactly as it was and the next launch simply retries.
 */
export async function runUserMigrations(db: SQLiteDatabase): Promise<void> {
  const current = await readVersion(db);

  // The database was written by a NEWER build (for example after a manual
  // downgrade). Migrations only add things, so the older app can still read
  // what it knows about. Leave the file alone.
  if (current > USER_SCHEMA_VERSION) return;

  const pending = MIGRATIONS.filter((migration) => migration.version > current);

  for (const migration of pending) {
    await db.withTransactionAsync(async () => {
      for (const statement of migration.statements) {
        await db.execAsync(statement);
      }
      // PRAGMA does not accept bound parameters; the value is our own integer.
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }
}
