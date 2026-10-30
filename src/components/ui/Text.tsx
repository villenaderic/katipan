import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { maxUiFontScale } from '../../theme/tokens';
import { uiTextStyle, type UiVariant } from '../../theme/typography';

export type TextTone = 'default' | 'muted' | 'accent' | 'danger';

export interface TextProps extends RNTextProps {
  variant?: UiVariant;
  tone?: TextTone;
}

/**
 * Themed UI text (system font). Scripture uses the reader styles instead.
 * Large headings are announced as headers to screen readers.
 */
export function Text({
  variant = 'body',
  tone = 'default',
  style,
  accessibilityRole,
  maxFontSizeMultiplier,
  ...rest
}: TextProps) {
  const { colors } = useTheme();
  const color =
    tone === 'muted'
      ? colors.muted
      : tone === 'accent'
        ? colors.accent
        : tone === 'danger'
          ? colors.danger
          : colors.text;

  const role = accessibilityRole ?? (variant === 'title' || variant === 'display' ? 'header' : undefined);

  return (
    <RNText
      {...rest}
      accessibilityRole={role}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? maxUiFontScale}
      style={[uiTextStyle(variant), { color }, style]}
    />
  );
}
