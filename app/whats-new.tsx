import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { READER } from '@/constants/config';
import { useI18n } from '@/i18n';
import { getWhatsNew, markWhatsNewSeen } from '@/services/whatsNewService';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/**
 * What's new: route /whats-new. The root layout opens it once, the first time
 * the app starts after an update. It is also a row in the More tab, so the
 * notes can be read again.
 *
 * Plain text only: the version, the notes from tools/release-notes.json in the
 * interface language, and one Done button. No images, no animation, no
 * questions, no "rate us".
 *
 * Opening the screen counts as seeing it. Even if the person leaves with the
 * back button, it will not appear again by itself.
 */

export default function WhatsNewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t, lang } = useI18n();

  const notes = useMemo(() => getWhatsNew(lang), [lang]);

  useEffect(() => {
    markWhatsNewSeen().catch(() => {
      // If this fails the screen simply shows again next time. Nothing to tell the person.
    });
  }, []);

  const close = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
      >
        {notes ? (
          <>
            <Text variant="title" style={styles.heading}>
              {t('whatsNew.version', { version: notes.version })}
            </Text>
            {notes.lines.map((line, index) => (
              <View key={`${index}-${line.text}`} style={styles.line} accessible>
                {line.bullet ? (
                  <Text
                    variant="body"
                    tone="accent"
                    style={styles.bullet}
                    importantForAccessibility="no"
                    accessibilityElementsHidden
                  >
                    {'\u2022'}
                  </Text>
                ) : null}
                <Text variant="body" style={styles.lineText}>
                  {line.text}
                </Text>
              </View>
            ))}
          </>
        ) : (
          <Text variant="body" tone="muted" style={styles.heading}>
            {t('whatsNew.empty')}
          </Text>
        )}

        <View style={styles.actions}>
          <Button label={t('common.done')} variant="filled" onPress={close} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    alignSelf: 'center',
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
  },
  heading: {
    marginBottom: space.lg,
  },
  line: {
    flexDirection: 'row',
    marginBottom: space.md,
  },
  bullet: {
    width: space.lg,
  },
  lineText: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    marginTop: space.xl,
  },
});
