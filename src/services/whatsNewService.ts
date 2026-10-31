import { APP_VERSION } from '../constants/config';
import { getUserDb } from '../db/client';
import { saveSetting } from '../db/queries/user';
import type { LangCode } from '../types';
// The same file the release workflow checks and publishes as the update notes
// (tools/release-notes.json), so there is one place to write them for each release.
import releaseNotes from '../../tools/release-notes.json';

/**
 * "What's new": the notes for the version that is installed right now.
 *
 * WHERE THE NOTES COME FROM
 *   tools/release-notes.json is bundled into the app at build time, so the
 *   notes are on the phone the moment the new version opens. Nothing is
 *   downloaded and nothing needs the internet. The release workflow already
 *   refuses to build unless that file's "version" equals app.json's, so the
 *   notes always belong to the version they ship in.
 *
 * WHEN IT SHOWS
 *   Once, the first time the app opens after an update (the root layout opens
 *   the screen). Never on a fresh install, because nothing is new yet. It is
 *   always reachable again from the More tab.
 *
 * HOW IT KNOWS
 *   user.db's settings table holds `whatsNewSeenVersion`, the last version
 *   whose notes the person has seen. No row means a fresh install (or the
 *   first run of this feature): the row is written quietly and nothing shows.
 *
 * The notes are plain text, one item per line. A line that starts with "- " is
 * a bullet. The same text is used on the GitHub Release page.
 */

const SEEN_KEY = 'whatsNewSeenVersion';

export interface WhatsNewLine {
  text: string;
  bullet: boolean;
}

export interface WhatsNew {
  version: string;
  lines: readonly WhatsNewLine[];
}

/** Read the notes file defensively: a bad edit must never crash the app. */
function notesFor(lang: LangCode): WhatsNew | null {
  const raw: unknown = releaseNotes;
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  if (record.version !== APP_VERSION) return null;

  const preferred = record[lang];
  const fallback = record.en;
  const text =
    typeof preferred === 'string' && preferred.trim() !== ''
      ? preferred
      : typeof fallback === 'string'
        ? fallback
        : '';

  const lines: WhatsNewLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === '') continue;
    const bullet = /^[-*•]\s+/.test(trimmed);
    lines.push({ text: bullet ? trimmed.replace(/^[-*•]\s+/, '') : trimmed, bullet });
  }

  return lines.length === 0 ? null : { version: APP_VERSION, lines };
}

/** The notes for the installed version in this language, or null if there are none. */
export function getWhatsNew(lang: LangCode): WhatsNew | null {
  return notesFor(lang);
}

async function readSeenVersion(): Promise<string | null> {
  const db = await getUserDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    SEEN_KEY,
  );
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Remember that the notes for the installed version have been seen. */
export async function markWhatsNewSeen(): Promise<void> {
  const db = await getUserDb();
  await saveSetting(db, SEEN_KEY, APP_VERSION);
}

/**
 * True when the app was updated since the person last saw the notes AND this
 * version has notes to show. Never throws: if anything fails, nothing shows.
 *
 * Side effects, on purpose:
 *  - No stored version (fresh install): it is recorded now and this returns false.
 *  - Updated, but this version has no notes: it is recorded and this returns false,
 *    so the check is not repeated on every launch.
 */
export async function hasUnseenWhatsNew(): Promise<boolean> {
  try {
    const seen = await readSeenVersion();
    if (seen === APP_VERSION) return false;

    if (seen === null) {
      await markWhatsNewSeen();
      return false;
    }

    // The language only picks the wording; whether notes exist does not depend on it.
    if (notesFor('en') === null) {
      await markWhatsNewSeen();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
