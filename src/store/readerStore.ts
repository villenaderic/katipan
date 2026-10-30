import { create } from 'zustand';

import { chapterCount } from '../constants/books';
import { READER } from '../constants/config';
import { getUserDb } from '../db/client';
import { getLastReadingProgress, saveReadingProgress } from '../db/queries/user';
import type { VerseId } from '../types';
import { adjacentChapter, type ChapterRef } from '../utils/reference';
import { ensureSettingsLoaded, useSettingsStore } from './settingsStore';

/**
 * What the reader is doing right now: which chapter is open, which verses are
 * selected, and whether the header and tab bar are visible.
 *
 * What it does NOT hold: the verse text (useChapter loads that), the font and
 * theme (settingsStore), or highlights and notes (user.db).
 *
 *  - Resume: restore() reads the last chapter from user.db on launch.
 *  - Open: openChapter() validates, moves, clears the selection, and saves the
 *    position, so the next launch resumes here.
 *  - Select: long-press a verse calls toggleVerse(); while anything is
 *    selected the action bar shows. Changing chapter clears the selection.
 *  - Focus mode: touch() shows the chrome and, if focus mode is on, hides it
 *    again after READER.focusHideDelayMs (2 seconds) without a touch. It never
 *    hides while verses are selected.
 */

/** Where a brand-new install opens: John 1. */
const DEFAULT_POSITION: ChapterRef = { book: 43, chapter: 1 };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** True for a chapter that exists (book 1..66, chapter within the book). */
function isValidPosition(book: number, chapter: number): boolean {
  return (
    Number.isInteger(book) &&
    Number.isInteger(chapter) &&
    chapter >= 1 &&
    chapter <= chapterCount(book)
  );
}

/** Insert or remove `id`, keeping the list sorted so ranges read in verse order. */
function toggleInSortedList(list: readonly VerseId[], id: VerseId): VerseId[] {
  if (list.includes(id)) return list.filter((existing) => existing !== id);
  const next = [...list, id];
  next.sort((a, b) => a - b);
  return next;
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;

function clearHideTimer(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/** The last position written to user.db, so reopening the same chapter does not write again. */
let lastSavedKey = '';

async function savePosition(position: ChapterRef): Promise<void> {
  try {
    const settings = await ensureSettingsLoaded();
    const key = `${position.book}:${position.chapter}:${settings.translation}`;
    if (key === lastSavedKey) return;

    const db = await getUserDb();
    await saveReadingProgress(db, position.book, position.chapter, settings.translation);
    lastSavedKey = key;
  } catch {
    // Not being able to remember the place must never get in the way of reading.
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

interface ReaderState {
  /** The open chapter, or null until restore() has finished. */
  position: ChapterRef | null;
  /** Selected verse ids in verse order. Empty means no selection. */
  selection: readonly VerseId[];
  /** False when focus mode has hidden the header and tab bar. */
  chromeVisible: boolean;

  /** Read the last-read chapter. Safe to call many times; it only runs once. */
  restore: () => Promise<ChapterRef>;
  /** Open a chapter. Returns false (and changes nothing) if it does not exist. */
  openChapter: (book: number, chapter: number) => boolean;
  /** Go to the next (+1) or previous (-1) chapter across books. False at the ends of the Bible. */
  step: (direction: 1 | -1) => boolean;

  toggleVerse: (id: VerseId) => void;
  clearSelection: () => void;

  /** Call on any touch in the reader. See the note on focus mode above. */
  touch: () => void;
}

let restorePromise: Promise<ChapterRef> | null = null;

export const useReaderStore = create<ReaderState>()((set, get) => {
  async function runRestore(): Promise<ChapterRef> {
    let found: ChapterRef = DEFAULT_POSITION;

    try {
      const db = await getUserDb();
      const last = await getLastReadingProgress(db);
      if (last && isValidPosition(last.book, last.chapter)) {
        found = { book: last.book, chapter: last.chapter };
      }
    } catch {
      // Unreadable history: open at the default.
    }

    // Something (a tapped notification, a quick-jump) may have opened a chapter
    // while this was reading. The person's latest action wins over history.
    const current = get().position;
    if (current) return current;

    set({ position: found });
    return found;
  }

  return {
    position: null,
    selection: [],
    chromeVisible: true,

    restore: () => {
      if (!restorePromise) restorePromise = runRestore();
      return restorePromise;
    },

    openChapter: (book, chapter) => {
      if (!isValidPosition(book, chapter)) return false;

      const position: ChapterRef = { book, chapter };
      const current = get().position;
      const sameChapter = current?.book === book && current.chapter === chapter;

      if (!sameChapter) {
        set({ position, selection: [] });
      }
      get().touch();
      void savePosition(position);
      return true;
    },

    step: (direction) => {
      const current = get().position;
      if (!current) return false;
      const next = adjacentChapter(current.book, current.chapter, direction);
      if (!next) return false;
      return get().openChapter(next.book, next.chapter);
    },

    toggleVerse: (id) => {
      const next = toggleInSortedList(get().selection, id);
      set({ selection: next });
      // The action bar needs the screen chrome out of the way of the person's hand,
      // and a selection must never be hidden by the focus timer.
      if (next.length > 0) {
        clearHideTimer();
        set({ chromeVisible: true });
      } else {
        get().touch();
      }
    },

    clearSelection: () => {
      if (get().selection.length === 0) return;
      set({ selection: [] });
      get().touch();
    },

    touch: () => {
      clearHideTimer();

      const { focusMode } = useSettingsStore.getState().settings;
      if (!focusMode || get().selection.length > 0) {
        if (!get().chromeVisible) set({ chromeVisible: true });
        return;
      }

      if (!get().chromeVisible) set({ chromeVisible: true });
      hideTimer = setTimeout(() => {
        hideTimer = null;
        // Re-check at fire time: a selection may have started in the meantime.
        if (get().selection.length === 0 && useSettingsStore.getState().settings.focusMode) {
          set({ chromeVisible: false });
        }
      }, READER.focusHideDelayMs);
    },
  };
});
