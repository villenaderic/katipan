import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { READER } from '@/constants/config';
import { useI18n } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/**
 * Shown when a link or route does not exist (an old bookmark, a mistyped
 * deep link). One sentence and one button back to Today; nothing else.
 */
export default function NotFoundScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xl,
        },
      ]}
    >
      <View style={styles.column}>
        <Text variant="title" style={styles.centered}>
          {t('notFound.title')}
        </Text>
        <Text variant="body" tone="muted" style={[styles.centered, styles.body]}>
          {t('notFound.body')}
        </Text>
        <Button
          label={t('notFound.action')}
          variant="filled"
          onPress={() => router.replace('/today')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  column: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    alignItems: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  body: {
    marginTop: space.md,
    marginBottom: space.xl,
  },
});
