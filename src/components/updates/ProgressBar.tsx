import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';

export interface ProgressBarProps {
  /**
   * 0 to 1. Pass null while the total size is not known yet (the value
   * getTaskFraction() returns), and the bar shows as "working" instead.
   */
  fraction: number | null;
  /**
   * What a screen reader says for this bar, for example "Downloading World
   * English Bible". The percentage is added by the system from the value.
   */
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/** Bar thickness in dp. Thin on purpose: typography first, chrome last. */
const BAR_HEIGHT = 4;

/** An unknown amount is drawn as a full, faded bar. A moving stripe would need animation. */
const INDETERMINATE_OPACITY = 0.35;

/**
 * A flat progress bar for downloads: a hairline-weight track with an accent
 * fill. Square ends, no shadow, no animation, so it costs nothing on a weak
 * phone and needs no Lite mode variant.
 *
 * It is not interactive, so it has no touch target. It is announced to screen
 * readers as a progress bar with its percentage, or as "working" with no
 * number while the size is unknown.
 */
function ProgressBarBase({ fraction, accessibilityLabel, style }: ProgressBarProps) {
  const { colors } = useTheme();

  const known = fraction !== null && Number.isFinite(fraction);
  const clamped = known ? Math.min(1, Math.max(0, fraction)) : 0;
  const percent = Math.round(clamped * 100);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={known ? { min: 0, max: 100, now: percent } : { min: 0, max: 100 }}
      style={[{ height: BAR_HEIGHT, backgroundColor: colors.divider }, style]}
    >
      <View
        style={{
          height: BAR_HEIGHT,
          width: known ? `${percent}%` : '100%',
          backgroundColor: colors.accent,
          opacity: known ? 1 : INDETERMINATE_OPACITY,
        }}
      />
    </View>
  );
}

export const ProgressBar = memo(ProgressBarBase);
