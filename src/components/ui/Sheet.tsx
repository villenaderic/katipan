import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { READER } from '../../constants/config';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { Button } from './Button';
import { Divider } from './Divider';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /** Optional heading. Pass an already-translated string. */
  title?: string;
  /** Translated "Close". Used for the header button and the dimmed backdrop. */
  closeLabel: string;
  children: ReactNode;
}

/** Dimmed area behind the sheet. Plain black at low alpha: no blur, cheap everywhere. */
const BACKDROP = '#00000073';

/** The sheet never grows taller than this share of the screen. */
const MAX_HEIGHT_RATIO = 0.8;

/**
 * Bottom sheet built on the React Native Modal (no extra dependency).
 * Closes with the backdrop, the Close button, or the Android back button.
 * The only motion is a fade under 150 ms, skipped in Lite mode or with
 * the system "reduce motion" setting (see ThemeProvider.fadeMs).
 */
export function Sheet({ visible, onClose, title, closeLabel, children }: SheetProps) {
  const { colors, fadeMs } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const opacity = useRef(new Animated.Value(fadeMs === 0 ? 1 : 0)).current;

  useEffect(() => {
    if (!visible) return;
    if (fadeMs === 0) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: fadeMs,
      useNativeDriver: true,
    }).start();
  }, [visible, fadeMs, opacity]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.fill, { opacity }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={[styles.fill, { backgroundColor: BACKDROP }]}
        />

        <View style={styles.bottom} pointerEvents="box-none">
          <View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: colors.sheet,
                maxHeight: height * MAX_HEIGHT_RATIO,
                paddingBottom: insets.bottom,
              },
            ]}
          >
            <View style={styles.header}>
              <View style={styles.headerTitle}>
                {title ? <Text variant="title">{title}</Text> : null}
              </View>
              <Button label={closeLabel} onPress={onClose} />
            </View>
            <Divider />

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  bottom: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.lg,
    paddingRight: space.sm,
    minHeight: 56,
  },
  headerTitle: {
    flex: 1,
  },
  content: {
    padding: space.lg,
  },
});
