import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, StyleSheet, ToastAndroid, View } from 'react-native';

import { ReaderHeader, type ReaderHeaderLabels } from '@/components/reader/ReaderHeader';
import {
  ReaderSettingsSheet,
  type ReaderSettingsLabels,
} from '@/components/reader/ReaderSettingsSheet';
import {
  VerseActionBar,
  type VerseActionBarLabels,
} from '@/components/reader/VerseActionBar';
import { VerseList, type VerseListLabels } from '@/components/reader/VerseList';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';
import { chapterCount } from '@/constants/books';
import { READER } from '@/constants/config';
import { getUserDb } from '@/db/client';
import {
  addBookmarks,
  clearHighlights,
  removeBookmarks,
  setHighlights,
} from '@/db/queries/user';
import { useChapter } from '@/hooks/useChapter';
import { useI18n } from '@/i18n';
import { copyText, shareText } from '@/services/shareService';
import { selectSettings, useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import type { HighlightColor, ThemeName } from '@/types';
import { buildShareText } from '@/utils/format';
import { adjacentChapter, formatReference } from '@/utils/reference';

/**
 * Reader screen: route /reader/[book]/[chapter], optional ?verse=16.
 *
 *  - The route is the source of truth for which chapter is shown. Whenever it
 *    changes, readerStore.openChapter() is told, which saves the place so the
 *    next launch resumes here.
 *  - Text and markers come from useChapter(). The list is given
 *    key="book:chapter" so every chapter starts at the top (or at ?verse=).
 *  - Long-press selects verses; the action bar then offers Highlight, Note,
 *    Bookmark, Copy and Share. Saving goes straight to user.db, then the
 *    markers are re-read. Android Back clears a selection before it leaves.
 *  - Every string comes from i18n; the components below only receive labels.
 */

const ERROR_TOAST_KEY = 'common.error';

/** Expo Router gives a string, or an array when a param repeats. */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toInteger(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) return 0;
  return parseInt(value, 10);
}

export default function ReaderScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { uiLanguage, translation } = useSettingsStore(selectSettings);

  const params = useLocalSearchParams<{
    book?: string | string[];
    chapter?: string | string[];
    verse?: string | string[];
  }>();
  const book = toInteger(firstParam(params.book));
  const chapter = toInteger(firstParam(params.chapter));
  const verseParam = toInteger(firstParam(params.verse));
  const valid = book >= 1 && chapter >= 1 && chapter <= chapterCount(book);

  const data = useChapter(book, chapter);
  const { refreshAnnotations } = data;

  const selection = useReaderStore((state) => state.selection);
  const chromeVisible = useReaderStore((state) => state.chromeVisible);
  const openChapter = useReaderStore((state) => state.openChapter);
  const clearSelection = useReaderStore((state) => state.clearSelection);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const busy = useRef(false);

  // Remember this chapter (resume on next launch) and clear any old selection.
  useEffect(() => {
    if (valid) openChapter(book, chapter);
  }, [valid, book, chapter, openChapter]);

  // Back clears a selection first, and only then leaves the screen.
  useEffect(() => {
    if (selection.length === 0) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      clearSelection();
      return true;
    });
    return () => subscription.remove();
  }, [selection.length, clearSelection]);

  /* ---------------- Labels (built once per language) ---------------- */

  const headerLabels = useMemo<ReaderHeaderLabels>(
    () => ({
      jump: (title) => t('reader.jump', { title }),
      readerSettings: t('reader.settings'),
    }),
    [t],
  );

  const listLabels = useMemo<VerseListLabels>(
    () => ({
      verse: (number) => t('reader.verse', { number }),
      highlighted: (color) => t('reader.highlighted', { color: t(`color.${color}`) }),
      bookmarked: t('reader.bookmarked'),
      notes: (count) => (count === 1 ? t('reader.noteOne') : t('reader.noteMany', { count })),
      selected: t('reader.selected'),
      hintStart: t('reader.hintStart'),
      hintToggle: t('reader.hintToggle'),
    }),
    [t],
  );

  const actionLabels = useMemo<VerseActionBarLabels>(
    () => ({
      selectedCount: (count) =>
        count === 1 ? t('reader.selectedOne') : t('reader.selectedMany', { count }),
      done: t('common.done'),
      highlight: t('reader.highlight'),
      note: t('reader.note'),
      bookmark: t('reader.bookmark'),
      removeBookmark: t('reader.removeBookmark'),
      copy: t('reader.copy'),
      share: t('reader.share'),
      removeHighlight: t('reader.removeHighlight'),
      colorName: (color) => t(`color.${color}`),
    }),
    [t],
  );

  const settingsLabels = useMemo<ReaderSettingsLabels>(
    () => ({
      title: t('reader.settingsTitle'),
      close: t('common.close'),
      textSize: t('reader.textSize'),
      smaller: t('reader.smaller'),
      larger: t('reader.larger'),
      lineSpacing: t('reader.lineSpacing'),
      tighter: t('reader.tighter'),
      looser: t('reader.looser'),
      typeface: t('reader.typeface'),
      serif: t('reader.serif'),
      sans: t('reader.sans'),
      verseNumbers: t('reader.verseNumbers'),
      on: t('common.on'),
      off: t('common.off'),
      theme: t('reader.theme'),
      themeName: (name: ThemeName) => t(`theme.${name}`),
      preview: t('reader.preview'),
    }),
    [t],
  );

  /* ---------------- Derived facts about the selection ---------------- */

  const selectedVerses = useMemo(() => {
    if (selection.length === 0) return [];
    const wanted = new Set(selection);
    return data.verses.filter((verse) => wanted.has(verse.id));
  }, [selection, data.verses]);

  const { allBookmarked, anyHighlighted, currentColor } = useMemo(() => {
    if (selection.length === 0) {
      return { allBookmarked: false, anyHighlighted: false, currentColor: null };
    }
    let every = true;
    let any = false;
    let shared: HighlightColor | null | undefined;
    for (const id of selection) {
      if (!data.bookmarks.has(id)) every = false;
      const color = data.highlights.get(id) ?? null;
      if (color) any = true;
      if (shared === undefined) shared = color;
      else if (shared !== color) shared = null;
    }
    return { allBookmarked: every, anyHighlighted: any, currentColor: shared ?? null };
  }, [selection, data.bookmarks, data.highlights]);

  /* ---------------- Actions ---------------- */

  const packId = data.packId ?? translation;

  const fail = useCallback((): void => {
    ToastAndroid.show(t(ERROR_TOAST_KEY), ToastAndroid.SHORT);
  }, [t]);

  /** Runs one save at a time, so a double tap cannot write twice. */
  const runSave = useCallback(
    async (work: () => Promise<void>): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      try {
        await work();
        await refreshAnnotations();
        clearSelection();
      } catch {
        fail();
      } finally {
        busy.current = false;
      }
    },
    [refreshAnnotations, clearSelection, fail],
  );

  const handleHighlight = useCallback(
    (color: HighlightColor | null): void => {
      const ids = useReaderStore.getState().selection;
      void runSave(async () => {
        const db = await getUserDb();
        if (color === null) await clearHighlights(db, ids);
        else await setHighlights(db, ids, packId, color);
      });
    },
    [runSave, packId],
  );

  const handleBookmark = useCallback((): void => {
    const ids = useReaderStore.getState().selection;
    const remove = ids.length > 0 && ids.every((id) => data.bookmarks.has(id));
    void runSave(async () => {
      const db = await getUserDb();
      if (remove) await removeBookmarks(db, ids);
      else await addBookmarks(db, ids, packId);
    });
  }, [runSave, packId, data.bookmarks]);

  const handleNote = useCallback((): void => {
    // A note belongs to one verse: the first selected one. The editor shows
    // that verse's reference, and any notes already on it.
    const first = useReaderStore.getState().selection[0];
    if (first === undefined) return;
    clearSelection();
    router.push({
      pathname: '/note-editor',
      params: { verseId: String(first), translation: packId },
    });
  }, [router, clearSelection, packId]);

  const selectionText = useCallback((): string => {
    return buildShareText(
      selectedVerses.map((verse) => ({ id: verse.id, text: verse.text })),
      packId.toUpperCase(),
      uiLanguage,
    );
  }, [selectedVerses, packId, uiLanguage]);

  const handleCopy = useCallback((): void => {
    const text = selectionText();
    if (text.length === 0) return;
    void (async () => {
      try {
        await copyText(text);
        ToastAndroid.show(t('reader.copied'), ToastAndroid.SHORT);
        AccessibilityInfo.announceForAccessibility(t('reader.copied'));
        clearSelection();
      } catch {
        fail();
      }
    })();
  }, [selectionText, t, clearSelection, fail]);

  const handleShare = useCallback((): void => {
    const text = selectionText();
    if (text.length === 0) return;
    void (async () => {
      try {
        await shareText(text);
        clearSelection();
      } catch {
        fail();
      }
    })();
  }, [selectionText, clearSelection, fail]);

  /* ---------------- Navigation ---------------- */

  const openPicker = useCallback((): void => {
    router.push('/books');
  }, [router]);

  const goToChapter = useCallback(
    (target: { book: number; chapter: number }): void => {
      // replace, not push: Back should leave the reader, not walk back
      // through every chapter that was read.
      router.replace({
        pathname: '/reader/[book]/[chapter]',
        params: { book: String(target.book), chapter: String(target.chapter) },
      });
    },
    [router],
  );

  const previous = valid ? adjacentChapter(book, chapter, -1) : null;
  const next = valid ? adjacentChapter(book, chapter, 1) : null;

  /* ---------------- Pieces ---------------- */

  const title = valid ? formatReference({ book, chapter }, uiLanguage) : '';
  const subtitle = data.packId ? data.packId.toUpperCase() : undefined;

  const listHeader = useMemo(
    () =>
      data.fellBack ? (
        <View style={styles.notice}>
          <Text variant="caption" tone="muted">
            {t('reader.fallbackNote', { pack: (data.packId ?? '').toUpperCase() })}
          </Text>
        </View>
      ) : null,
    [data.fellBack, data.packId, t],
  );

  const listFooter = useMemo(() => {
    if (!previous && !next) return null;
    return (
      <View>
        <Divider />
        <View style={styles.pager}>
          <View style={styles.pagerSide}>
            {previous ? (
              <Button
                label={`‹ ${formatReference(previous, uiLanguage)}`}
                accessibilityLabel={t('reader.goTo', { ref: formatReference(previous, uiLanguage) })}
                onPress={() => goToChapter(previous)}
              />
            ) : null}
          </View>
          <View style={[styles.pagerSide, styles.pagerEnd]}>
            {next ? (
              <Button
                label={`${formatReference(next, uiLanguage)} ›`}
                accessibilityLabel={t('reader.goTo', { ref: formatReference(next, uiLanguage) })}
                onPress={() => goToChapter(next)}
              />
            ) : null}
          </View>
        </View>
      </View>
    );
  }, [previous, next, uiLanguage, t, goToChapter]);

  /* ---------------- Body ---------------- */

  let body;
  if (!valid || data.status === 'empty') {
    body = (
      <Message
        text={valid ? t('reader.emptyChapter') : t('reader.invalidChapter')}
        actionLabel={t('reader.chooseChapter')}
        onAction={openPicker}
      />
    );
  } else if (data.status === 'error') {
    body = (
      <Message
        text={t('reader.loadError')}
        actionLabel={t('common.retry')}
        onAction={data.retry}
      />
    );
  } else if (data.status === 'ready') {
    body = (
      <VerseList
        key={`${book}:${chapter}`}
        verses={data.verses}
        highlights={data.highlights}
        bookmarks={data.bookmarks}
        noteCounts={data.noteCounts}
        labels={listLabels}
        initialVerse={verseParam > 0 ? verseParam : undefined}
        header={listHeader}
        footer={listFooter}
      />
    );
  } else {
    // Loading: show nothing. A chapter opens in well under 300 ms, so a
    // spinner would only flash.
    body = null;
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <ReaderHeader
        title={title}
        subtitle={subtitle}
        labels={headerLabels}
        visible={chromeVisible}
        onJump={openPicker}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <View style={styles.body}>{body}</View>

      {selection.length > 0 ? (
        <VerseActionBar
          count={selection.length}
          labels={actionLabels}
          allBookmarked={allBookmarked}
          anyHighlighted={anyHighlighted}
          currentColor={currentColor}
          onHighlight={handleHighlight}
          onNote={handleNote}
          onBookmark={handleBookmark}
          onCopy={handleCopy}
          onShare={handleShare}
          onDone={clearSelection}
        />
      ) : null}

      <ReaderSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        labels={settingsLabels}
      />
    </View>
  );
}

/** A short centered message with one text button, for empty and error states. */
function Message({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <View style={styles.message}>
      <Text variant="body" tone="muted" style={styles.messageText}>
        {text}
      </Text>
      <Button label={actionLabel} onPress={onAction} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  notice: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  pager: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  pagerSide: {
    flex: 1,
    flexDirection: 'row',
  },
  pagerEnd: {
    justifyContent: 'flex-end',
  },
  message: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    alignSelf: 'center',
  },
  messageText: {
    textAlign: 'center',
    marginBottom: space.md,
  },
});
