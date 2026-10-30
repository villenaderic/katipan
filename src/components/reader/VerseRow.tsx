import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import { A11Y } from '../../constants/config';
import { useTheme } from '../../theme/ThemeProvider';
import { maxUiFontScale, space } from '../../theme/tokens';
import type { ReaderTypography } from '../../theme/typography';
import type { HighlightColor, VerseId, VerseRow as VerseData } from '../../types';
import { cleanVerseText } from '../../utils/format';

export interface VerseRowProps {
  verse: VerseData;
  /** Styles from readerTypography(). The list builds this once and shares it. */
  typography: ReaderTypography;
  showVerseNumber: boolean;
  /** The verse's highlight color, if it has one. */
  highlight?: HighlightColor;
  bookmarked?: boolean;
  /** Number of notes on this verse. 0 or undefined shows no marker. */
  noteCount?: number;
  /** True while the verse is part of the current selection. */
  selected?: boolean;
  /** Tap. In the list this selects or unselects when a selection exists. */
  onPress?: (id: VerseId) => void;
  /** Long press starts a selection. */
  onLongPress?: (id: VerseId) => void;
  /**
   * The whole sentence a screen reader says, already translated by the list,
   * for example "Verse 16. For God so loved the world. Highlighted. Bookmarked."
   */
  accessibilityLabel: string;
  /** Optional spoken hint, already translated. */
  accessibilityHint?: string;
}

/** Side of the small square markers, in dp. */
const MARKER = 6;

/**
 * One verse. Typography first: the text is the interface, so a verse has no
 * box, no icon and no border.
 *
 *  - The verse number is small and muted, set inline before the text.
 *  - A highlight colors only the words, like a marker pen on paper.
 *  - A selected verse gets a quiet tint behind the whole row.
 *  - A bookmark is a small filled square, a note a small hollow square, both in
 *    the accent color in the left margin. Screen readers get the same facts
 *    from accessibilityLabel, so the markers are hidden from them.
 *
 * The row is at least 48dp tall and the whole row is the touch target. It is
 * memoized: scrolling a long chapter such as Psalm 119 only draws the rows
 * that change.
 */
function VerseRowView({
  verse,
  typography,
  showVerseNumber,
  highlight,
  bookmarked = false,
  noteCount = 0,
  selected = false,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
}: VerseRowProps) {
  const { colors } = useTheme();
  const id = verse.id;

  const handlePress = useCallback(() => onPress?.(id), [onPress, id]);
  const handleLongPress = useCallback(() => onLongPress?.(id), [onLongPress, id]);

  const interactive = onPress !== undefined || onLongPress !== undefined;
  const hasNote = noteCount > 0;
  const text = cleanVerseText(verse.text);

  const content = (
    <View style={[styles.row, selected ? { backgroundColor: colors.selection } : null]}>
      <View style={styles.margin} importantForAccessibility="no-hide-descendants">
        {bookmarked ? <View style={[styles.marker, { backgroundColor: colors.accent }]} /> : null}
        {hasNote ? (
          <View style={[styles.marker, styles.hollow, { borderColor: colors.accent }]} />
        ) : null}
      </View>

      <RNText
        style={[typography.verse, { color: colors.text }, styles.text]}
        maxFontSizeMultiplier={maxUiFontScale}
        // Scripture is read aloud as one sentence from the row's label instead.
        accessible={false}
      >
        {showVerseNumber ? (
          <RNText style={[typography.verseNumber, { color: colors.muted }]}>
            {verse.verse}
            {'\u00A0'}
          </RNText>
        ) : null}
        <RNText style={highlight ? { backgroundColor: colors.highlight[highlight] } : undefined}>
          {text}
        </RNText>
      </RNText>
    </View>
  );

  if (!interactive) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }

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
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: A11Y.minTouchTarget,
    paddingVertical: space.sm,
    paddingRight: space.lg,
  },
  // A narrow left margin that holds the markers and keeps the text aligned.
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
});

/**
 * Re-draws only when something this verse shows has changed. The callbacks
 * must be stable (useCallback) in the list, or every row would re-draw anyway.
 */
export const VerseRow = memo(VerseRowView, (prev, next) => {
  return (
    prev.verse === next.verse &&
    prev.typography === next.typography &&
    prev.showVerseNumber === next.showVerseNumber &&
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
