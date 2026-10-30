import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { A11Y, READER } from '../../constants/config';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { Divider } from '../ui/Divider';
import { Text } from '../ui/Text';

/** Translated text for the header. The reader screen fills this from i18n. */
export interface ReaderHeaderLabels {
  /**
   * Spoken label of the title button, for example "John 3. Choose another chapter".
   * Receives the visible title so the screen reader says where the person is.
   */
  jump: (title: string) => string;
  /** Spoken label of the "Aa" button, for example "Reading settings". */
  readerSettings: string;
}

export interface ReaderHeaderProps {
  /** Book and chapter, already translated and formatted, for example "John 3". */
  title: string;
  /**
   * Small muted line under the title, for example the translation name
   * ("World English Bible"). Leave out to show only the title.
   */
  subtitle?: string;
  labels: ReaderHeaderLabels;
  /**
   * False while reading-focus mode has hidden the chrome (readerStore.chromeVisible).
   * The header fades out but keeps its space, so the text never jumps.
   */
  visible?: boolean;
  /** Tap on the title: opens the book and chapter picker. */
  onJump: () => void;
  /** Tap on "Aa": opens the reader settings sheet. */
  onOpenSettings: () => void;
}

/**
 * The top line of the reader: where you are, and the one "Aa" button.
 *
 *  - Left: book and chapter in large UI text. Tapping it jumps elsewhere.
 *    An optional muted line below names the translation.
 *  - Right: "Aa", which opens the reader settings sheet. It is the only
 *    button in the header, on purpose.
 *  - A hairline below instead of a box or shadow. Same column width as the
 *    verses, centered on tablets.
 *
 * Reading-focus mode: when `visible` turns false the header fades out in
 * under 150 ms (instantly in Lite mode or with system "reduce motion") and
 * stops taking touches, so a tap goes through to the verse list, which
 * brings the header back. While hidden it is also hidden from screen readers.
 *
 * It holds no logic: it reports taps and the screen decides what happens.
 */
export function ReaderHeader({
  title,
  subtitle,
  labels,
  visible = true,
  onJump,
  onOpenSettings,
}: ReaderHeaderProps) {
  const { colors, fadeMs } = useTheme();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    const target = visible ? 1 : 0;

    if (fadeMs === 0) {
      opacity.setValue(target);
      return undefined;
    }

    const fade = Animated.timing(opacity, {
      toValue: target,
      duration: fadeMs,
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [visible, fadeMs, opacity]);

  return (
    <Animated.View
      style={[
        styles.bar,
        { backgroundColor: colors.background, paddingTop: insets.top, opacity },
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!visible}
    >
      <View style={styles.column}>
        <View style={styles.row}>
          <Pressable
            onPress={onJump}
            accessibilityRole="button"
            accessibilityLabel={labels.jump(title)}
            style={({ pressed }) => [
              styles.titleTouch,
              pressed ? { backgroundColor: colors.selection } : null,
            ]}
          >
            <Text
              variant="title"
              numberOfLines={1}
              // The button's label already says the title; the header role
              // of a large title would only make it announced twice.
              accessibilityRole="text"
              importantForAccessibility="no"
            >
              {title}
            </Text>
            {subtitle ? (
              <Text variant="caption" tone="muted" numberOfLines={1} importantForAccessibility="no">
                {subtitle}
              </Text>
            ) : null}
          </Pressable>

          <Pressable
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel={labels.readerSettings}
            style={({ pressed }) => [
              styles.settingsTouch,
              pressed ? { backgroundColor: colors.selection } : null,
            ]}
          >
            <Text variant="title" tone="accent" importantForAccessibility="no">
              Aa
            </Text>
          </Pressable>
        </View>
      </View>
      <Divider />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Full screen width, so the hairline and background reach both edges.
  bar: {
    alignItems: 'center',
  },
  // Same reading width as the verses, centered on tablets.
  column: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // minHeight, not height: a large system font may make the title taller.
  titleTouch: {
    flex: 1,
    minHeight: A11Y.minTouchTarget,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    justifyContent: 'center',
  },
  settingsTouch: {
    minHeight: A11Y.minTouchTarget,
    minWidth: A11Y.minTouchTarget,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
