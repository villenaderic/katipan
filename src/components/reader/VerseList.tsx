import { FlashList } from '@shopify/flash-list';
import { useCallback, useMemo, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { READER } from '../../constants/config';
import { selectSettings, useSettingsStore } from '../../store/settingsStore';
import { useReaderStore } from '../../store/readerStore';
import { space } from '../../theme/tokens';
import { readerTypography } from '../../theme/typography';
import type { HighlightColor, VerseId, VerseRow as VerseData } from '../../types';
import { cleanVerseText } from '../../utils/format';
import { VerseRow } from './VerseRow';

/**
 * Translated phrases the list needs to build what a screen reader says for
 * each verse. The reader screen fills this from i18n, so this file has no
 * text of its own. Example result for John 3:16 highlighted yellow:
 *   "Verse 16. For God so loved the world... Highlighted yellow. Bookmarked."
 */
export interface VerseListLabels {
  /** "Verse 16" */
  verse: (number: number) => string;
  /** "Highlighted yellow" */
  highlighted: (color: HighlightColor) => string;
  /** "Bookmarked" */
  bookmarked: string;
  /** "Has a note" / "Has 2 notes" */
  notes: (count: number) => string;
  /** "Selected" */
  selected: string;
  /** Hint when nothing is selected: "Long press to select". */
  hintStart: string;
  /** Hint when a selection exists: "Tap to select or unselect". */
  hintToggle: string;
}

export interface VerseListProps {
  /** The chapter's verses in order. */
  verses: readonly VerseData[];
  highlights: ReadonlyMap<VerseId, HighlightColor>;
  bookmarks: ReadonlySet<VerseId>;
  noteCounts: ReadonlyMap<VerseId, number>;
  labels: VerseListLabels;
  /**
   * Verse number to open scrolled to (for "Open in context"). Only read when
   * the list first appears, so give the list `key={book:chapter}` in the
   * screen to start fresh for every chapter.
   */
  initialVerse?: number;
  /** Shown above the first verse, for example the chapter title. */
  header?: ReactElement | null;
  /** Shown after the last verse, for example Previous and Next chapter. */
  footer?: ReactElement | null;
}

/** Room under the last verse so the action bar never covers it. */
const FOOTER_SPACE = space.xxxl;
const FOOTER_SPACE_WITH_SELECTION = space.xxxl * 2 + space.xl;

/**
 * The verse list. Long chapters (Psalm 119) stay smooth on a 2 GB phone
 * because only the rows on screen exist.
 *
 *  - Reading column is at most 640dp wide and centered on tablets.
 *  - Long-press selects a verse; while anything is selected a tap on another
 *    verse adds or removes it. The selection lives in readerStore.
 *  - Any touch or scroll calls readerStore.touch(), which is what keeps the
 *    reading-focus chrome visible and restarts its 2 second timer.
 *  - Text size, spacing, serif or sans, and verse numbers come from settings,
 *    so changing them in the Aa sheet updates this list at once.
 */
export function VerseList({
  verses,
  highlights,
  bookmarks,
  noteCounts,
  labels,
  initialVerse,
  header = null,
  footer = null,
}: VerseListProps) {
  const { fontSize, lineHeight, fontFamily, showVerseNumbers } = useSettingsStore(selectSettings);
  const selection = useReaderStore((state) => state.selection);
  const toggleVerse = useReaderStore((state) => state.toggleVerse);
  const touch = useReaderStore((state) => state.touch);

  const typography = useMemo(
    () => readerTypography(fontSize, lineHeight, fontFamily),
    [fontSize, lineHeight, fontFamily],
  );

  const selectedIds = useMemo<ReadonlySet<VerseId>>(() => new Set(selection), [selection]);
  const selecting = selection.length > 0;

  const handlePress = useCallback(
    (id: VerseId): void => {
      if (useReaderStore.getState().selection.length > 0) {
        toggleVerse(id);
      } else {
        touch();
      }
    },
    [toggleVerse, touch],
  );

  const handleLongPress = useCallback(
    (id: VerseId): void => {
      // A long press always selects. It never unselects, so a slow tap on a
      // selected verse cannot undo itself.
      if (!useReaderStore.getState().selection.includes(id)) toggleVerse(id);
    },
    [toggleVerse],
  );

  const spokenLabel = useCallback(
    (verse: VerseData, isSelected: boolean): string => {
      const parts: string[] = [labels.verse(verse.verse), cleanVerseText(verse.text)];
      const color = highlights.get(verse.id);
      if (color) parts.push(labels.highlighted(color));
      if (bookmarks.has(verse.id)) parts.push(labels.bookmarked);
      const notes = noteCounts.get(verse.id) ?? 0;
      if (notes > 0) parts.push(labels.notes(notes));
      if (isSelected) parts.push(labels.selected);
      return parts.join('. ');
    },
    [labels, highlights, bookmarks, noteCounts],
  );

  const renderItem = useCallback(
    ({ item }: { item: VerseData }): ReactElement => {
      const isSelected = selectedIds.has(item.id);
      return (
        <VerseRow
          verse={item}
          typography={typography}
          showVerseNumber={showVerseNumbers}
          highlight={highlights.get(item.id)}
          bookmarked={bookmarks.has(item.id)}
          noteCount={noteCounts.get(item.id)}
          selected={isSelected}
          onPress={handlePress}
          onLongPress={handleLongPress}
          accessibilityLabel={spokenLabel(item, isSelected)}
          accessibilityHint={selecting ? labels.hintToggle : labels.hintStart}
        />
      );
    },
    [
      selectedIds,
      typography,
      showVerseNumbers,
      highlights,
      bookmarks,
      noteCounts,
      handlePress,
      handleLongPress,
      spokenLabel,
      selecting,
      labels,
    ],
  );

  const keyExtractor = useCallback((item: VerseData): string => String(item.id), []);

  const initialIndex = useMemo(() => {
    if (initialVerse === undefined) return undefined;
    const index = verses.findIndex((verse) => verse.verse === initialVerse);
    return index > 0 ? index : undefined;
    // Read once on purpose: later changes must not move the page under the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const footerElement = useMemo(
    () => (
      <View>
        {footer}
        <View style={{ height: selecting ? FOOTER_SPACE_WITH_SELECTION : FOOTER_SPACE }} />
      </View>
    ),
    [footer, selecting],
  );

  return (
    <View style={styles.outer} onTouchStart={touch}>
      <View style={styles.column}>
        <FlashList
          data={verses}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          // Rows redraw when these change; the rest is covered by renderItem.
          extraData={selectedIds}
          initialScrollIndex={initialIndex}
          ListHeaderComponent={header}
          ListFooterComponent={footerElement}
          onScrollBeginDrag={touch}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    alignItems: 'center',
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: READER.maxColumnWidth,
  },
});
