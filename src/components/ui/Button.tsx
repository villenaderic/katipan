import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { A11Y } from '../../constants/config';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { Text } from './Text';

export type ButtonVariant = 'text' | 'filled' | 'outline';

export interface ButtonProps {
  /** Visible label. Pass an already-translated string (i18n happens in the caller). */
  label: string;
  onPress: () => void;
  /**
   * text    - default, quiet accent-colored label (the app's "text button" style)
   * filled  - solid accent surface, for the single main action on a screen
   * outline - hairline border, for a secondary action next to a filled one
   */
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Defaults to `label`. Set it when the label alone is ambiguous to a screen reader. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Stretch to the full width of the parent. */
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Themed button. Always at least 48dp tall and wide, no shadows, no animation:
 * the pressed state is an instant tint so it costs nothing on weak phones and
 * needs no Lite-mode special case.
 */
export function Button({
  label,
  onPress,
  variant = 'text',
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  fullWidth = false,
  style,
  testID,
}: ButtonProps) {
  const { colors } = useTheme();

  const labelColor = variant === 'filled' ? colors.onAccent : colors.accent;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        variant === 'filled' && { backgroundColor: colors.accent },
        variant === 'outline' && {
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.accent,
        },
        pressed && !disabled && {
          backgroundColor: variant === 'filled' ? colors.accent : colors.selection,
          opacity: variant === 'filled' ? 0.85 : 1,
        },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text
        variant="label"
        importantForAccessibility="no"
        style={[styles.label, { color: labelColor }]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: A11Y.minTouchTarget,
    minWidth: A11Y.minTouchTarget,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    textAlign: 'center',
    fontWeight: '600',
  },
});
