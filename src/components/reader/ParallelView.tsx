import { FlashList } from '@shopify/flash-list';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text as RNText,
  useWindowDimensions,
  View,
} from 'react-native';

import { A11Y, READER } from '../../constants/config';
import { loadChapter, prefetchAdjacentChapters } from '../../services/bibleService';
import { useReaderStore } from '../../store/readerStore';
import { selectSettings, useSettingsStore } from '../../store/settingsStore';
import { useTheme } from '../../theme/ThemeProvider';
import { maxUiFontScale, space } from '../../theme/tokens';
import { readerTypography, type ReaderTypography } from '../../theme/typography';
import type { HighlightColor, VerseId, VerseRow } from '../../types';
import { cleanVerseText } from '../../utils/format';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import type { VerseListLabels } from './VerseList';

/**
 * Parallel view (v1.5): two translations of the same chapter, one verse at a
 * time. Verse ids are book * 1000000 + chapter * 1000 + verse in every pack,
 * so the two texts line up by id with no extra data.
 *
 *  - Phones (narrow screens): STACKED. Each verse shows the main translation,
 *    then the second one under it, set off by a hairline on the left.
 *  - Tablets (wide screens): SIDE BY SIDE, one column per translation.
 *  - The rows are the verses of BOTH translations put together, in order.
 *    Translations do not always agree on verse numbers (a verse some Bibles
 *    leave out), so a verse missing from one side shows a quiet dash instead
 *    of shifting the rows out of line.
 *  - Selection, highlights, bookmarks and notes work exactly as in the single
 *    view: they belong to the verse id, so they show in both translations.
 *
 * The main translation comes in as `verses` (from useChapter, which already
 * reads the annotations). This component reads only the second one, after the
 * first text is on screen, so the chapter never waits for it.
 *
 * Every string comes in through props (no text of its own). Nothing here
 * writes to user.db or the network.
 */

/** Screens at least this wide (dp) get two columns. Narrower ones are stacked. */
export const PARALLEL_SIDE_BY_SIDE_MIN_WIDTH = 720;

export interface ParallelViewLabels extends VerseListLabels {
  /** What a screen reader says for the second translation: "Ang Dating Biblia 1905: Sapagka't gayon..." */
  translationText: (name: string, text: string) => string;
  /** Spoken for a verse one translation does not have: "Not in this translation". */
  notInTranslation: string;
  /** Shown when the second translation could not be read. */
  secondaryError: string;
  /** "Try again" */
  retry: string;
}

export interface ParallelViewProps {
  /** Verses of the main translation, in order. */
  verses: readonly VerseRow[];
  book: number;
  chapter: number;
  /** Pack id of the second translation. Must differ from the main one. */
  secondaryPackId: string;
  /** Names of the two translations, already translated or formatted for the legend. */
  primaryName: string;
  secondaryName: string;
  highlights: ReadonlyMap<VerseId, HighlightColor>;
  bookmarks: ReadonlySet<VerseId>;
  noteCounts: ReadonlyMap<VerseId, number>;
  labels: ParallelViewLabels;
  /** Verse number to open scrolled to. Read once, so key the view by chapter. */
  initialVerse?: number;
  header?: ReactElement | null;
  footer?: ReactElement | null;
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

interface PairedVerse {
  readonly id: VerseId;
  readonly verse: number;
  readonly primary: VerseRow | null;
  readonly secondary: VerseRow | null;
}

/** Put the two texts side by side by verse id. Verses of either text appear once, in order. */
function pairVerses(
  primary: readonly VerseRow[],
  secondary: ReadonlyMap<VerseId, VerseRow>,
): PairedVerse[] {
  const rows = new Map<VerseId, PairedVerse>();
  for (const verse of primary) {
    rows.set(verse.id, {
      id: verse.id,
      verse: verse.verse,
      primary: verse,
      secondary: secondary.get(verse.id) ?? null,
    });
  }
  for (const verse of secondary.values()) {
    if (!rows.has(verse.id)) {
      rows.set(verse.id, { id: verse.id, verse: verse.verse, primary: null, secondary: verse });
    }
  }
  return [...rows.values()].sort((a, b) => a.id - b.id);
}

interface ParallelRowProps {
  pair: PairedVerse;
  typography: ReaderTypography;
  showVerseNumber: boolean;
  sideBySide: boolean;
  highlight?: HighlightColor;
  bookmarked: boolean;
  noteCount: number;
  selected: boolean;
  primaryName: string;
  secondaryName: string;
  onPress: (id: VerseId) => void;
  onLongPress: (id: VerseId) => void;
  accessibilityLabel: string;
  accessibilityHint: string;
}

const MARKER = 6;

function ParallelRowView({
  pair,
  typography,
  showVerseNumber,
  sideBySide,
  highlight,
  bookmarked,
  noteCount,
  selected,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
}: ParallelRowProps) {
  const { colors } = useTheme();
  const id = pair.id;

  const handlePress = useCallback(() => onPress(id), [onPress, id]);
  const handleLongPress = useCallback(() => onLongPress(id), [onLongPress, id]);

  const marked = highlight ? { backgroundColor: colors.highlight[highlight] } : undefined;

  /** One text, or a quiet dash when this translation does not have the verse. */
  const renderText = (verse: VerseRow | null, withNumber: boolean): ReactElement => (
    <RNText
      style={[typography.verse, { color: verse ? colors.text : colors.muted }, styles.text]}
      maxFontSizeMultiplier={maxUiFontScale}
      accessible={false}
    >
      {withNumber ? (
        <RNText style={[typography.verseNumber, { color: colors.muted }]}>
          {pair.verse}
          {'\u00A0'}
        </RNText>
      ) : null}
      <RNText style={verse ? marked : undefined}>
        {verse ? cleanVerseText(verse.text) : '\u2014'}
      </RNText>
    </RNText>
  );

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected }}
    >
      <View style={[styles.row, selected ? { backgroundColor: colors.selection } : null]}>
        <View style={styles.margin} importantForAccessibility="no-hide-descendants">
          {bookmarked ? (
            <View style={[styles.marker, { backgroundColor: colors.accent }]} />
          ) : null}
          {noteCount > 0 ? (
            <View style={[styles.marker, styles.hollow, { borderColor: colors.accent }]} />
          ) : null}
        </View>

        {sideBySide ? (
          <View style={styles.columns} importantForAccessibility="no-hide-descendants">
            <View style={styles.column}>{renderText(pair.primary, showVerseNumber)}</View>
            <View style={[styles.column, styles.columnDivider, { borderLeftColor: colors.divider }]}>
              {renderText(pair.secondary, showVerseNumber)}
            </View>
          </View>
        ) : (
          <View style={styles.stack} importantForAccessibility="no-hide-descendants">
            <View style={styles.textRow}>{renderText(pair.primary, showVerseNumber)}</View>
            <View style={[styles.secondaryBlock, { borderLeftColor: colors.divider }]}>
              {renderText(pair.secondary, false)}
            </View>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const ParallelRow = memo(ParallelRowView, (prev, next) => {
  return (
    prev.pair === next.pair &&
    prev.typography === next.typography &&
    prev.showVerseNumber === next.showVerseNumber &&
    prev.sideBySide === next.sideBySide &&
    prev.highlight === next.highlight &&
    prev.bookmarked === next.bookmarked &&
    prev.noteCount === next.noteCount &&
    prev.selected === next.selected &&
    prev.onPress === next.onPress &&
    prev.onLongPress === next.onLongPress &&
    prev.accessibilityLabel === next.accessibilityLabel &&
    prev.accessibilityHint === next.accessibilityHint
  );
});

/* ------------------------------------------------------------------ */
/* The second translation                                              */
/* ------------------------------------------------------------------ */

type SecondaryStatus = 'loading' | 'ready' | 'error';

const NO_SECONDARY: ReadonlyMap<VerseId, VerseRow> = new Map();

/** Reads one chapter of the second translation. A slow answer for an old chapter is dropped. */
function useSecondaryChapter(packId: string, book: number, chapter: number) {
  const [status, setStatus] = useState<SecondaryStatus>('loading');
  const [verses, setVerses] = useState<ReadonlyMap<VerseId, VerseRow>>(NO_SECONDARY);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setVerses(NO_SECONDARY);

    void (async () => {
      try {
        const rows = await loadChapter(packId, book, chapter);
        if (cancelled) return;
        const byId = new Map<VerseId, VerseRow>();
        for (const row of rows) byId.set(row.id, row);
        setVerses(byId);
        setStatus('ready');
        if (rows.length > 0) prefetchAdjacentChapters(packId, book, chapter);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [packId, book, chapter, attempt]);

  const retry = useCallback((): void => {
    setAttempt((value) => value + 1);
  }, []);

  return { status, verses, retry };
}

/* ------------------------------------------------------------------ */
/* The view                                                            */
/* ------------------------------------------------------------------ */

/** Room under the last verse so the action bar never covers it (same as VerseList). */
const FOOTER_SPACE = space.xxxl;
const FOOTER_SPACE_WITH_SELECTION = space.xxxl * 2 + space.xl;

export function ParallelView({
  verses,
  book,
  chapter,
  secondaryPackId,
  primaryName,
  secondaryName,
  highlights,
  bookmarks,
  noteCounts,
  labels,
  initialVerse,
  header = null,
  footer = null,
}: ParallelViewProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { fontSize, lineHeight, fontFamily, showVerseNumbers } = useSettingsStore(selectSettings);
  const selection = useReaderStore((state) => state.selection);
  const toggleVerse = useReaderStore((state) => state.toggleVerse);
  const touch = useReaderStore((state) => state.touch);

  const sideBySide = width >= PARALLEL_SIDE_BY_SIDE_MIN_WIDTH;

  const typography = useMemo(
    () => readerTypography(fontSize, lineHeight, fontFamily),
    [fontSize, lineHeight, fontFamily],
  );

  const secondary = useSecondaryChapter(secondaryPackId, book, chapter);
  const pairs = useMemo(() => pairVerses(verses, secondary.verses), [verses, secondary.verses]);

  const selectedIds = useMemo<ReadonlySet<VerseId>>(() => new Set(selection), [selection]);
  const selecting = selection.length > 0;

  const handlePress = useCallback(
    (id: VerseId): void => {
      if (useReaderStore.getState().selection.length > 0) toggleVerse(id);
      else touch();
    },
    [toggleVerse, touch],
  );

  const handleLongPress = useCallback(
    (id: VerseId): void => {
      // A long press always selects, never unselects (same rule as the single view).
      if (!useReaderStore.getState().selection.includes(id)) toggleVerse(id);
    },
    [toggleVerse],
  );

  const spokenLabel = useCallback(
    (pair: PairedVerse, isSelected: boolean): string => {
      const parts: string[] = [labels.verse(pair.verse)];
      parts.push(
        pair.primary
          ? labels.translationText(primaryName, cleanVerseText(pair.primary.text))
          : `${primaryName}: ${labels.notInTranslation}`,
      );
      // While the second text is still loading it is simply not mentioned.
      if (secondary.status !== 'loading') {
        parts.push(
          pair.secondary
            ? labels.translationText(secondaryName, cleanVerseText(pair.secondary.text))
            : `${secondaryName}: ${labels.notInTranslation}`,
        );
      }
      const color = highlights.get(pair.id);
      if (color) parts.push(labels.highlighted(color));
      if (bookmarks.has(pair.id)) parts.push(labels.bookmarked);
      const notes = noteCounts.get(pair.id) ?? 0;
      if (notes > 0) parts.push(labels.notes(notes));
      if (isSelected) parts.push(labels.selected);
      return parts.join('. ');
    },
    [labels, primaryName, secondaryName, secondary.status, highlights, bookmarks, noteCounts],
  );

  const renderItem = useCallback(
    ({ item }: { item: PairedVerse }): ReactElement => {
      const isSelected = selectedIds.has(item.id);
      return (
        <ParallelRow
          pair={item}
          typography={typography}
          showVerseNumber={showVerseNumbers}
          sideBySide={sideBySide}
          highlight={highlights.get(item.id)}
          bookmarked={bookmarks.has(item.id)}
          noteCount={noteCounts.get(item.id) ?? 0}
          selected={isSelected}
          primaryName={primaryName}
          secondaryName={secondaryName}
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
      sideBySide,
      highlights,
      bookmarks,
      noteCounts,
      primaryName,
      secondaryName,
      handlePress,
      handleLongPress,
      spokenLabel,
      selecting,
      labels,
    ],
  );

  const keyExtractor = useCallback((item: PairedVerse): string => String(item.id), []);

  const initialIndex = useMemo(() => {
    if (initialVerse === undefined) return undefined;
    const index = pairs.findIndex((pair) => pair.verse === initialVerse);
    return index > 0 ? index : undefined;
    // Read once on purpose: later changes must not move the page under the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Which translation is which: two column titles, or two short lines when stacked. */
  const legend = useMemo(
    () => (
      <View style={[styles.legend, { borderBottomColor: colors.divider }]}>
        <View style={styles.margin} />
        {sideBySide ? (
          <View style={styles.columns}>
            <View style={styles.column}>
              <Text variant="label" tone="muted" numberOfLines={2}>
                {primaryName}
              </Text>
            </View>
            <View style={[styles.column, styles.legendSecond]}>
              <Text variant="label" tone="muted" numberOfLines={2}>
                {secondaryName}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.stack}>
            <Text variant="label" tone="muted" numberOfLines={2}>
              {primaryName}
            </Text>
            <Text variant="label" tone="muted" numberOfLines={2}>
              {secondaryName}
            </Text>
          </View>
        )}
      </View>
    ),
    [sideBySide, primaryName, secondaryName, colors.divider],
  );

  const headerElement = useMemo(
    () => (
      <View>
        {header}
        {legend}
        {secondary.status === 'error' ? (
          <View style={styles.notice}>
            <Text variant="label" tone="muted">
              {labels.secondaryError}
            </Text>
            <Button label={labels.retry} onPress={secondary.retry} style={styles.noticeButton} />
          </View>
        ) : null}
      </View>
    ),
    [header, legend, secondary.status, secondary.retry, labels.secondaryError, labels.retry],
  );

  const footerElement = useMemo(
    () => (
      <View>
        {footer}
        <View style={{ height: selecting ? FOOTER_SPACE_WITH_SELECTION : FOOTER_SPACE }} />
      </View>
    ),
    [footer, selecting],
  );

  // FlashList redraws rows when this object changes, not only when `data` does.
  const extraData = useMemo(
    () => ({ selectedIds, sideBySide, secondaryStatus: secondary.status }),
    [selectedIds, sideBySide, secondary.status],
  );

  return (
    <View style={styles.outer} onTouchStart={touch}>
      <View
        style={[
          styles.container,
          { maxWidth: sideBySide ? READER.maxColumnWidth * 2 : READER.maxColumnWidth },
        ]}
      >
        <FlashList
          data={pairs}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          extraData={extraData}
          initialScrollIndex={initialIndex}
          ListHeaderComponent={headerElement}
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
  container: {
    flex: 1,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: A11Y.minTouchTarget,
    paddingVertical: space.sm,
    paddingRight: space.lg,
  },
  margin: {
    width: space.lg,
    paddingTop: space.sm,
    alignItems: 'center',
    gap: space.xs,
  },
  marker: {
    width: MARKER,
    height: MARKER,
  },
  hollow: {
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  text: {
    flex: 1,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  column: {
    flex: 1,
    flexDirection: 'row',
    paddingRight: space.md,
  },
  columnDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingLeft: space.md,
    paddingRight: 0,
  },
  stack: {
    flex: 1,
  },
  // A row so the text fills the width without trying to fill a height.
  textRow: {
    flexDirection: 'row',
  },
  secondaryBlock: {
    flexDirection: 'row',
    marginTop: space.xs,
    marginLeft: space.xs,
    paddingLeft: space.md,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: space.sm,
    paddingBottom: space.sm,
    paddingRight: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  legendSecond: {
    paddingLeft: space.md,
    paddingRight: 0,
  },
  notice: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  noticeButton: {
    alignSelf: 'flex-start',
    marginLeft: -space.lg,
    marginTop: space.xs,
  },
});
