import { memo } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import { A11Y } from '../../constants/config';
import { useTheme } from '../../theme/ThemeProvider';
import { maxUiFontScale, space } from '../../theme/tokens';
import type { ReaderTypography } from '../../theme/typography';
import type { HighlightColor } from '../../types';
import { cleanVerseText } from '../../utils/format';
import { Divider } from '../ui/Divider';
import { Text } from '../ui/Text';

export interface HighlightItemProps {
  /** Already formatted reference, for example "John 3:16" or "Juan 3:16". */
  reference: string;
  /** Short translation name, for example "WEB" or "ADB1905". */
  translationLabel: string;
  /**
   * The verse text read from the translation pack.
   * Pass null when the pack is not installed or the verse cannot be found.
   */
  text: string | null;
  /** Shown in place of the verse when text is null. Already translated. */
  missingText: string;
  /** Styles from readerTypography(). The Library list builds this once and shares it. */
  typography: ReaderTypography;
  /** Highlight tab: the highlight color. It colors the words like a marker pen. */
  color?: HighlightColor;
  /** Notes tab: the note the person wrote. */
  note?: string;
  /** Bookmarks tab: the label the person gave the bookmark. */
  label?: string;
  /** Tags already joined into one line, for example "peace, hope". */
  tagsText?: string;
  /** Already formatted date, for example "Oct 31, 2026". */
  dateLabel: string;
  /** Tap: the screen opens the chapter at this verse. */
  onPress: () => void;
  /** Long press: the screen offers to remove or edit the item. */
  onLongPress?: () => void;
  /**
   * The whole sentence a screen reader says, already translated, for example
   * "John 3:16, WEB. Highlighted yellow. October 31, 2026."
   */
  accessibilityLabel: string;
  /** Optional spoken hint, already translated. */
  accessibilityHint?: string;
  /** Draw a hairline under the item. Default true. */
  divider?: boolean;
}

/** Side of the small color square, in dp. */
const SWATCH = 12;

/** Library lists stay short on purpose. Long verses are cut after this many lines. */
const VERSE_LINES = 4;
const NOTE_LINES = 3;

/**
 * One line of the Library list: a highlight, a bookmark or a note.
 *
 * It is one component for the three tabs, because they look almost the same:
 *   reference and translation on top,
 *   the verse below (colored like a marker pen when it is a highlight),
 *   then an optional note or bookmark label, optional tags, and the date.
 *
 * Typography first: no card, no icon, no shadow. A hairline under the item is
 * the only separator. The color of a highlight is shown twice, as a small
 * square in the left margin and as the marker color behind the words, so it is
 * still clear on a dim screen. Screen readers get the color name from
 * accessibilityLabel, so the square is hidden from them.
 *
 * It only reports taps. Loading the verse text and saving changes happen in
 * the screen, so this file holds no logic that can fail. It is memoized so a
 * long Library list only draws the rows that change.
 */
function HighlightItemView({
  reference,
  translationLabel,
  text,
  missingText,
  typography,
  color,
  note,
  label,
  tagsText,
  dateLabel,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  divider = true,
}: HighlightItemProps) {
  const { colors } = useTheme();

  const verseText = text === null ? null : cleanVerseText(text);

  return (
    <View>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.selection } : null]}
      >
        <View style={styles.margin} importantForAccessibility="no-hide-descendants">
          {color ? (
            <View
              style={[
                styles.swatch,
                { backgroundColor: colors.highlight[color], borderColor: colors.divider },
              ]}
            />
          ) : null}
        </View>

        <View style={styles.body}>
          <View style={styles.top}>
            <Text variant="label" tone="accent" style={styles.reference} numberOfLines={1}>
              {reference}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {translationLabel}
            </Text>
          </View>

          {verseText === null ? (
            <Text variant="label" tone="muted" style={styles.missing}>
              {missingText}
            </Text>
          ) : (
            <RNText
              style={[typography.verse, { color: colors.text }, styles.verse]}
              maxFontSizeMultiplier={maxUiFontScale}
              numberOfLines={VERSE_LINES}
              ellipsizeMode="tail"
            >
              <RNText style={color ? { backgroundColor: colors.highlight[color] } : undefined}>
                {verseText}
              </RNText>
            </RNText>
          )}

          {note ? (
            <Text variant="label" style={styles.extra} numberOfLines={NOTE_LINES}>
              {note}
            </Text>
          ) : null}

          {label ? (
            <Text variant="label" tone="accent" style={styles.extra} numberOfLines={1}>
              {label}
            </Text>
          ) : null}

          <View style={styles.bottom}>
            {tagsText ? (
              <Text variant="caption" tone="muted" style={styles.tags} numberOfLines={1}>
                {tagsText}
              </Text>
            ) : (
              <View style={styles.tags} />
            )}
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {dateLabel}
            </Text>
          </View>
        </View>
      </Pressable>
      {divider ? <Divider /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: A11Y.minTouchTarget,
    paddingVertical: space.md,
    paddingRight: space.lg,
  },
  // Narrow left margin for the color square. Keeps the text aligned in every tab.
  margin: {
    width: space.xl,
    paddingTop: space.xs,
    alignItems: 'center',
  },
  swatch: {
    width: SWATCH,
    height: SWATCH,
    borderWidth: 1,
  },
  body: {
    flex: 1,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  reference: {
    flex: 1,
    fontWeight: '600',
    marginRight: space.md,
  },
  verse: {
    marginTop: space.xs,
  },
  missing: {
    marginTop: space.xs,
    fontStyle: 'italic',
  },
  extra: {
    marginTop: space.sm,
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  tags: {
    flex: 1,
    marginRight: space.md,
  },
});

export const HighlightItem = memo(HighlightItemView);
