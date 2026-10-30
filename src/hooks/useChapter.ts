import { useCallback, useEffect, useRef, useState } from 'react';

import { getUserDb } from '../db/client';
import {
  getBookmarksInRange,
  getHighlightsInRange,
  getNotesInRange,
} from '../db/queries/user';
import {
  loadChapter,
  prefetchAdjacentChapters,
  resolveTranslation,
} from '../services/bibleService';
import { selectSettings, useSettingsStore } from '../store/settingsStore';
import type { HighlightColor, VerseId, VerseRow } from '../types';
import { chapterRange } from '../utils/reference';

/**
 * Everything the reader needs for one chapter:
 *
 *  - the verse text, from the person's translation (or the nearest installed
 *    one, see `fellBack`)
 *  - which verses are highlighted, bookmarked, or have notes
 *
 * The text is shown as soon as it is read. Highlights, bookmarks and notes
 * arrive a moment later from user.db and fill in without moving the text.
 * After the person highlights, bookmarks or writes a note, call
 * refreshAnnotations() to update the markers.
 *
 * Annotations are matched by verse id only, never by translation, so a
 * highlight made in one translation shows in all of them.
 */

export type ChapterStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface ChapterData {
  status: ChapterStatus;
  /** The verses of the chapter in order. Empty unless status is "ready". Read-only. */
  verses: readonly VerseRow[];
  /** Pack id the text actually came from. Null until it is known. */
  packId: string | null;
  /** True when the chosen translation is not installed and another pack was used. */
  fellBack: boolean;
  /** Highlight color by verse id. */
  highlights: ReadonlyMap<VerseId, HighlightColor>;
  /** Verses that have a bookmark. */
  bookmarks: ReadonlySet<VerseId>;
  /** Number of notes by verse id (only verses with at least one). */
  noteCounts: ReadonlyMap<VerseId, number>;
  /** Re-read highlights, bookmarks and notes after the person changed them. */
  refreshAnnotations: () => Promise<void>;
  /** Try again after an error. */
  retry: () => void;
}

const NO_VERSES: readonly VerseRow[] = [];
const NO_HIGHLIGHTS: ReadonlyMap<VerseId, HighlightColor> = new Map();
const NO_BOOKMARKS: ReadonlySet<VerseId> = new Set();
const NO_NOTES: ReadonlyMap<VerseId, number> = new Map();

interface Annotations {
  highlights: ReadonlyMap<VerseId, HighlightColor>;
  bookmarks: ReadonlySet<VerseId>;
  noteCounts: ReadonlyMap<VerseId, number>;
}

const NO_ANNOTATIONS: Annotations = {
  highlights: NO_HIGHLIGHTS,
  bookmarks: NO_BOOKMARKS,
  noteCounts: NO_NOTES,
};

async function readAnnotations(book: number, chapter: number): Promise<Annotations> {
  const db = await getUserDb();
  const { fromId, toId } = chapterRange(book, chapter);
  const [highlightRows, bookmarkRows, noteRows] = await Promise.all([
    getHighlightsInRange(db, fromId, toId),
    getBookmarksInRange(db, fromId, toId),
    getNotesInRange(db, fromId, toId),
  ]);

  const highlights = new Map<VerseId, HighlightColor>();
  for (const row of highlightRows) highlights.set(row.verse_id, row.color);

  const bookmarks = new Set<VerseId>();
  for (const row of bookmarkRows) bookmarks.add(row.verse_id);

  const noteCounts = new Map<VerseId, number>();
  for (const row of noteRows) {
    noteCounts.set(row.verse_id, (noteCounts.get(row.verse_id) ?? 0) + 1);
  }

  return { highlights, bookmarks, noteCounts };
}

export function useChapter(book: number, chapter: number): ChapterData {
  const { translation, uiLanguage } = useSettingsStore(selectSettings);

  const [status, setStatus] = useState<ChapterStatus>('loading');
  const [verses, setVerses] = useState<readonly VerseRow[]>(NO_VERSES);
  const [packId, setPackId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotations>(NO_ANNOTATIONS);
  const [attempt, setAttempt] = useState(0);

  /** Identifies the chapter currently on screen, so a slow answer for an old one is dropped. */
  const currentKey = useRef('');
  const key = `${book}:${chapter}`;
  currentKey.current = key;

  useEffect(() => {
    let cancelled = false;

    setStatus('loading');
    setVerses(NO_VERSES);
    setAnnotations(NO_ANNOTATIONS);

    void (async () => {
      try {
        const pack = await resolveTranslation(translation, uiLanguage);
        if (cancelled) return;
        if (!pack) {
          setPackId(null);
          setStatus('error');
          return;
        }

        const rows = await loadChapter(pack, book, chapter);
        if (cancelled) return;

        setPackId(pack);
        setVerses(rows);
        setStatus(rows.length > 0 ? 'ready' : 'empty');

        if (rows.length > 0) prefetchAdjacentChapters(pack, book, chapter);

        // Markers come second so the text never waits for user.db.
        try {
          const found = await readAnnotations(book, chapter);
          if (!cancelled) setAnnotations(found);
        } catch {
          // Reading still works without markers.
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [book, chapter, translation, uiLanguage, attempt]);

  const refreshAnnotations = useCallback(async (): Promise<void> => {
    const requested = currentKey.current;
    try {
      const found = await readAnnotations(book, chapter);
      // Ignore the answer if the person has already moved to another chapter.
      if (currentKey.current === requested) setAnnotations(found);
    } catch {
      // Keep the markers that are showing.
    }
  }, [book, chapter]);

  const retry = useCallback((): void => {
    setAttempt((value) => value + 1);
  }, []);

  return {
    status,
    verses,
    packId,
    fellBack: packId !== null && packId !== translation,
    highlights: annotations.highlights,
    bookmarks: annotations.bookmarks,
    noteCounts: annotations.noteCounts,
    refreshAnnotations,
    retry,
  };
}
