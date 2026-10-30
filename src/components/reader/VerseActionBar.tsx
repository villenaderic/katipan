import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { A11Y, READER } from '../../constants/config';
import { useTheme } from '../../theme/ThemeProvider';
import { HIGHLIGHT_COLORS } from '../../theme/themes';
import { space } from '../../theme/tokens';
import type { HighlightColor } from '../../types';
import { Divider } from '../ui/Divider';
import { Text } from '../ui/Text';

/** Translated text for the bar. The reader screen fills this from i18n. */
export interface VerseActionBarLabels {
  /** "1 verse selected" / "3 verses selected" */
  selectedCount: (count: number) => string;
  /** "Done": clears the selection. */
  done: string;
  highlight: string;
  note: string;
  bookmark: string;
  /** Shown instead of "bookmark" when every selected verse is already bookmarked. */
  removeBookmark: string;
  copy: string;
  share: string;
  removeHighlight: string;
  /** "Yellow", "Green", "Blue", "Pink", "Orange" */
  colorName: (color: HighlightColor) => string;
}

export interface VerseActionBarProps {
  /** How many verses are selected. The screen only shows the bar when this is above 0. */
  count: number;
  labels: VerseActionBarLabels;
  /** True when every selected verse is already bookmarked. Turns Bookmark into Remove. */
  allBookmarked: boolean;
  /** True when at least one selected verse is highlighted. Shows "Remove highlight". */
  anyHighlighted: boolean;
  /** The color shared by all selected verses, if they all have the same one. Marked in the swatches. */
  currentColor?: HighlightColor | null;

  /** Pass a color to highlight every selected verse, or null to remove highlights. */
  onHighlight: (color: HighlightColor | null) => void;
  onNote: () => void;
  onBookmark: () => void;
  onCopy: () => void;
  onShare: () => void;
  /** Clears the selection. */
  onDone: () => void;
}

/** Visible size of a color swatch. The touch area around it is 48dp. */
const SWATCH = 32;

/**
 * The bar at the bottom of the reader while verses are selected.
 *
 * Top line: how many verses are selected, and Done.
 * Below: Highlight, Note, Bookmark, Copy, Share as plain text buttons.
 * Tapping Highlight opens one more line of five color squares (and Remove
 * highlight when it applies). It closes again after a color is chosen.
 *
 * It only reports what the person tapped. Saving to user.db, copying and
 * sharing happen in the screen, so this file holds no logic that can fail.
 * No icons, no shadow, no animation: the surface color and a hairline on top
 * are enough, and it costs nothing on a weak phone.
 */
export function VerseActionBar({
  count,
  labels,
  allBookmarked,
  anyHighlighted,
  currentColor = null,
  onHighlight,
  onNote,
  onBookmark,
  onCopy,
  onShare,
  onDone,
}: VerseActionBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [pickingColor, setPickingColor] = useState(false);

  // A new selection starts with the color line closed.
  useEffect(() => {
    if (count === 0) setPickingColor(false);
  }, [count]);

  const chooseColor = (color: HighlightColor | null): void => {
    setPickingColor(false);
    onHighlight(color);
  };

  const actions: { key: string; label: string; onPress: () => void; expanded?: boolean }[] = [
    {
      key: 'highlight',
      label: labels.highlight,
      onPress: () => setPickingColor((open) => !open),
      expanded: pickingColor,
    },
    { key: 'note', label: labels.note, onPress: onNote },
    {
      key: 'bookmark',
      label: allBookmarked ? labels.removeBookmark : labels.bookmark,
      onPress: onBookmark,
    },
    { key: 'copy', label: labels.copy, onPress: onCopy },
    { key: 'share', label: labels.share, onPress: onShare },
  ];

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.sheet, paddingBottom: insets.bottom },
      ]}
    >
      <Divider />
      <View style={styles.column}>
        <View style={styles.top}>
          <Text
            variant="label"
            tone="muted"
            style={styles.count}
            accessibilityLiveRegion="polite"
          >
            {labels.selectedCount(count)}
          </Text>
          <Pressable
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel={labels.done}
            style={styles.done}
          >
            <Text variant="label" tone="accent" style={styles.bold} importantForAccessibility="no">
              {labels.done}
            </Text>
          </Pressable>
        </View>

        {pickingColor ? (
          <View style={styles.colorLine}>
            {HIGHLIGHT_COLORS.map((color) => {
              const chosen = currentColor === color;
              return (
                <Pressable
                  key={color}
                  onPress={() => chooseColor(color)}
                  accessibilityRole="button"
                  accessibilityLabel={labels.colorName(color)}
                  accessibilityState={{ selected: chosen }}
                  style={styles.swatchTouch}
                >
                  <View
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: colors.highlight[color],
                        borderColor: chosen ? colors.accent : colors.divider,
                        borderWidth: chosen ? 2 : 1,
                      },
                    ]}
                  />
                </Pressable>
              );
            })}
            {anyHighlighted ? (
              <Pressable
                onPress={() => chooseColor(null)}
                accessibilityRole="button"
                accessibilityLabel={labels.removeHighlight}
                style={styles.removeHighlight}
              >
                <Text variant="label" tone="accent" numberOfLines={2} importantForAccessibility="no">
                  {labels.removeHighlight}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          {actions.map((action) => (
            <Pressable
              key={action.key}
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={action.expanded === undefined ? undefined : { expanded: action.expanded }}
              style={({ pressed }) => [
                styles.action,
                pressed ? { backgroundColor: colors.selection } : null,
              ]}
            >
              <Text
                variant="caption"
                tone="accent"
                numberOfLines={2}
                style={styles.actionText}
                importantForAccessibility="no"
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sits on the bottom edge of the reader and is as wide as the screen.
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  // Same reading width as the verses, centered on tablets.
  column: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space.lg,
  },
  count: {
    flex: 1,
  },
  done: {
    minHeight: A11Y.minTouchTarget,
    minWidth: A11Y.minTouchTarget,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bold: {
    fontWeight: '600',
  },
  colorLine: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
  },
  swatchTouch: {
    width: A11Y.minTouchTarget,
    height: A11Y.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: SWATCH,
    height: SWATCH,
  },
  removeHighlight: {
    flex: 1,
    minHeight: A11Y.minTouchTarget,
    paddingHorizontal: space.md,
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: space.xs,
  },
  action: {
    flex: 1,
    minHeight: A11Y.minTouchTarget,
    paddingHorizontal: space.xs,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    textAlign: 'center',
    fontWeight: '600',
  },
});
