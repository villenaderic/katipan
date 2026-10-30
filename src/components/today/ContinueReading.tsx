import { Pressable, StyleSheet, View } from 'react-native';

import { A11Y, READER } from '../../constants/config';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { Text } from '../ui/Text';

export interface ContinueReadingProps {
  /** Small muted line above the title, for example "Continue reading". Already translated. */
  eyebrow: string;
  /** Main line, for example "John 3". Already translated and formatted. */
  title: string;
  /** Optional muted line below the title, for example "Day 12 of 365". */
  detail?: string;
  onPress: () => void;
  /** Defaults to eyebrow, title and detail read in order. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

/**
 * One tappable line on the Today screen, under the verse:
 *
 *     Continue reading
 *     John 3                                  ›
 *
 * The Today screen uses it twice: for the last-read chapter and, once reading
 * plans exist, for today's plan item. No box and no icon; the Today screen
 * puts a hairline between the lines. At least 48dp tall, and the pressed
 * state is an instant tint (no animation to switch off in Lite mode).
 */
export function ContinueReading({
  eyebrow,
  title,
  detail,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ContinueReadingProps) {
  const { colors } = useTheme();

  const spoken =
    accessibilityLabel ??
    [eyebrow, title, detail].filter((part): part is string => !!part).join('. ');

  return (
    <View style={styles.column}>
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.selection }]}
      >
        <View style={styles.texts}>
          <Text variant="caption" tone="muted" importantForAccessibility="no">
            {eyebrow}
          </Text>
          <Text variant="body" style={styles.title} importantForAccessibility="no" numberOfLines={2}>
            {title}
          </Text>
          {detail ? (
            <Text
              variant="caption"
              tone="muted"
              style={styles.detail}
              importantForAccessibility="no"
              numberOfLines={2}
            >
              {detail}
            </Text>
          ) : null}
        </View>

        <Text
          variant="title"
          tone="muted"
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          {'\u203A'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    alignSelf: 'center',
  },
  row: {
    minHeight: A11Y.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  texts: {
    flex: 1,
  },
  title: {
    marginTop: 2,
    fontWeight: '600',
  },
  detail: {
    marginTop: 2,
  },
});
