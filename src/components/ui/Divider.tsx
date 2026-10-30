import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { hairline } from '../../theme/tokens';

export interface DividerProps {
  /** Left indent in dp, for dividers that line up with row text instead of the screen edge. */
  inset?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Hairline divider (1px, low contrast). The app uses these instead of boxes
 * and cards. Purely decorative, so screen readers skip it.
 */
export function Divider({ inset = 0, style }: DividerProps) {
  const { colors } = useTheme();

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          height: hairline,
          marginLeft: inset,
          backgroundColor: colors.divider,
        },
        style,
      ]}
    />
  );
}
