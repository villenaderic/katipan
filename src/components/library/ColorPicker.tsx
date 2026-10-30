import { Pressable, StyleSheet, View } from 'react-native';

import { A11Y } from '../../constants/config';
import { useTheme } from '../../theme/ThemeProvider';
import { HIGHLIGHT_COLORS } from '../../theme/themes';
import { space } from '../../theme/tokens';
import type { HighlightColor } from '../../types';
import { Text } from '../ui/Text';

/** Translated text for the picker. The Library screen fills this from i18n. */
export interface ColorPickerLabels {
  /** Spoken name of the whole group, for example "Filter by color". */
  group: string;
  /** The "no filter" choice, for example "All". */
  all: string;
  /** "Yellow", "Green", "Blue", "Pink", "Orange" */
  colorName: (color: HighlightColor) => string;
}

export interface ColorPickerProps {
  /** The color that is filtering the list now, or null for "All". */
  value: HighlightColor | null;
  labels: ColorPickerLabels;
  /** Called with a color, or with null when the person taps "All". */
  onChange: (color: HighlightColor | null) => void;
}

/** Visible size of a color square. The touch area around it is 48dp. */
const SWATCH = 32;

/**
 * One line to filter the Library by highlight color: "All", then five squares.
 *
 * The chosen square gets a thicker accent border and a check mark, so the
 * choice does not depend on color alone. "All" is chosen when value is null.
 * Screen readers hear it as a group of radio buttons: "Yellow, radio button,
 * checked".
 *
 * It only reports what the person tapped. Filtering the list happens in the
 * screen. No icons, no shadow, no animation.
 */
export function ColorPicker({ value, labels, onChange }: ColorPickerProps) {
  const { colors } = useTheme();
  const allChosen = value === null;

  return (
    <View
      style={styles.line}
      accessible={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={labels.group}
    >
      <Pressable
        onPress={() => onChange(null)}
        accessibilityRole="radio"
        accessibilityLabel={labels.all}
        accessibilityState={{ checked: allChosen }}
        style={({ pressed }) => [
          styles.all,
          pressed ? { backgroundColor: colors.selection } : null,
        ]}
      >
        <Text
          variant="label"
          tone={allChosen ? 'accent' : 'muted'}
          style={allChosen ? styles.bold : undefined}
          importantForAccessibility="no"
        >
          {labels.all}
        </Text>
      </Pressable>

      {HIGHLIGHT_COLORS.map((color) => {
        const chosen = value === color;
        return (
          <Pressable
            key={color}
            onPress={() => onChange(color)}
            accessibilityRole="radio"
            accessibilityLabel={labels.colorName(color)}
            accessibilityState={{ checked: chosen }}
            style={styles.touch}
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
            >
              {chosen ? (
                <Text variant="label" style={styles.check} importantForAccessibility="no">
                  {'✓'}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
  },
  all: {
    minHeight: A11Y.minTouchTarget,
    minWidth: A11Y.minTouchTarget,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bold: {
    fontWeight: '600',
  },
  touch: {
    width: A11Y.minTouchTarget,
    height: A11Y.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: SWATCH,
    height: SWATCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    fontWeight: '700',
  },
});
