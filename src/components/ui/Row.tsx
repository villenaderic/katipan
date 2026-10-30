import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { A11Y } from '../../constants/config';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { Divider } from './Divider';
import { Text } from './Text';

export interface RowProps {
  /** Main line. Pass an already-translated string. */
  title: string;
  /** Optional muted second line (for example a pack size or a short description). */
  subtitle?: string;
  /** Optional muted text on the right (for example the current setting value). */
  value?: string;
  /** Shows a chevron on the right. Use for rows that open another screen. */
  chevron?: boolean;
  /** Marks the row as the current choice (theme, translation, and so on). */
  selected?: boolean;
  /** Without onPress the row is plain, non-interactive text. */
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Draw a hairline under the row. */
  divider?: boolean;
  /** Overrides the spoken label. Defaults to title, subtitle and value read in order. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Standard list row: title on the left, optional value and chevron on the
 * right, hairline below instead of a box. At least 48dp tall when tappable.
 */
export function Row({
  title,
  subtitle,
  value,
  chevron = false,
  selected = false,
  onPress,
  onLongPress,
  disabled = false,
  divider = true,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: RowProps) {
  const { colors } = useTheme();
  const interactive = onPress !== undefined || onLongPress !== undefined;

  const spoken =
    accessibilityLabel ?? [title, subtitle, value].filter((part): part is string => !!part).join('. ');

  const content = (
    <View style={styles.inner}>
      <View style={styles.texts}>
        <Text variant="body">{title}</Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {value ? (
        <Text variant="label" tone="muted" style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}

      {selected ? (
        <Text
          variant="body"
          tone="accent"
          style={styles.mark}
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          {'\u2713'}
        </Text>
      ) : null}

      {chevron ? (
        <Text
          variant="title"
          tone="muted"
          style={styles.mark}
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          {'\u203A'}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={style}>
      {interactive ? (
        <Pressable
          testID={testID}
          onPress={onPress}
          onLongPress={onLongPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={spoken}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ disabled, selected }}
          style={({ pressed }) => [
            styles.row,
            pressed && !disabled && { backgroundColor: colors.selection },
            disabled && styles.disabled,
          ]}
        >
          {content}
        </Pressable>
      ) : (
        <View
          testID={testID}
          accessible
          accessibilityLabel={spoken}
          style={styles.row}
        >
          {content}
        </View>
      )}
      {divider ? <Divider /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: A11Y.minTouchTarget,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  texts: {
    flex: 1,
  },
  subtitle: {
    marginTop: 2,
  },
  value: {
    marginLeft: space.md,
    flexShrink: 1,
    maxWidth: '45%',
  },
  mark: {
    marginLeft: space.md,
  },
  disabled: {
    opacity: 0.45,
  },
});
