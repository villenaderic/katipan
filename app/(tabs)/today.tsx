import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContinueReading } from '@/components/today/ContinueReading';
import {
  DailyVerseHero,
  type DailyVerseHeroLabels,
} from '@/components/today/DailyVerseHero';
import { Divider } from '@/components/ui/Divider';
import { useDailyVerse } from '@/hooks/useDailyVerse';
import { useI18n } from '@/i18n';
import { shareText } from '@/services/shareService';
import { useReaderStore } from '@/store/readerStore';
import { selectSettings, useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { formatLongDate } from '@/utils/date';
import { buildShareText } from '@/utils/format';
import { formatReference, parseVerseId } from '@/utils/reference';

/**
 * Today: the home screen.
 *
 * One verse, one "Continue reading" line. Nothing else: no feed, no badges,
 * no streak, no prompts. The reading-plan line the design calls for is added
 * when reading plans are built (v1.0); until then there is nothing to show,
 * so nothing is drawn.
 *
 *  - Two taps from launch to reading: this screen is the first one, and
 *    "Continue reading" opens the last chapter straight away.
 *  - The verse comes from useDailyVerse(), which works offline and moves to a
 *    new verse by itself when the date or translation changes.
 *  - "Open in context" opens the chapter and scrolls to the verse (?verse=).
 *  - Every string comes from i18n.
 */

/** Ignore a second tap on the same button inside this time. */
const DOUBLE_TAP_MS = 800;

export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { uiLanguage } = useSettingsStore(selectSettings);

  const { status, verse, retry } = useDailyVerse();

  const position = useReaderStore((state) => state.position);
  const restore = useReaderStore((state) => state.restore);

  // Read the last position so "Continue reading" knows where to go.
  useEffect(() => {
    void restore();
  }, [restore]);

  const lastTap = useRef(0);
  /** True the first time within the debounce window, false for an accidental repeat. */
  const acceptTap = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) return false;
    lastTap.current = now;
    return true;
  }, []);

  /* ---------------- Labels ---------------- */

  const heroLabels = useMemo<DailyVerseHeroLabels>(
    () => ({
      share: t('today.share'),
      shareA11y: t('today.shareA11y'),
      openInContext: t('today.openInContext'),
      openInContextA11y: (reference) => t('today.openInContextA11y', { reference }),
      verseA11y: (reference, text) => t('today.verseA11y', { reference, text }),
      loadError: t('today.loadError'),
      retry: t('common.retry'),
    }),
    [t],
  );

  const dateLabel = useMemo(
    () => formatLongDate(new Date(), uiLanguage),
    // The verse changes when the day does, so re-read the date with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uiLanguage, verse?.date],
  );

  /* ---------------- Actions ---------------- */

  const handleShare = useCallback((): void => {
    if (!verse || !acceptTap()) return;

    const text = buildShareText(
      [{ id: verse.verseId, text: verse.text }],
      verse.translation.toUpperCase(),
      uiLanguage,
    );

    void shareText(text).catch(() => {
      ToastAndroid.show(t('common.error'), ToastAndroid.SHORT);
      AccessibilityInfo.announceForAccessibility(t('common.error'));
    });
  }, [verse, acceptTap, uiLanguage, t]);

  const handleOpenInContext = useCallback((): void => {
    if (!verse || !acceptTap()) return;
    const ref = parseVerseId(verse.verseId);
    router.push({
      pathname: '/reader/[book]/[chapter]',
      params: {
        book: String(ref.book),
        chapter: String(ref.chapter),
        verse: String(ref.verse),
      },
    });
  }, [verse, acceptTap, router]);

  const handleContinue = useCallback((): void => {
    if (!position || !acceptTap()) return;
    router.push({
      pathname: '/reader/[book]/[chapter]',
      params: { book: String(position.book), chapter: String(position.chapter) },
    });
  }, [position, acceptTap, router]);

  const continueTitle = position
    ? formatReference({ book: position.book, chapter: position.chapter }, uiLanguage)
    : null;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.xxl, paddingBottom: space.xxxl },
      ]}
      showsVerticalScrollIndicator={false}
      // Taps on the buttons must work even while the keyboard is up elsewhere.
      keyboardShouldPersistTaps="handled"
    >
      <DailyVerseHero
        status={status}
        verse={verse}
        dateLabel={dateLabel}
        labels={heroLabels}
        onShare={handleShare}
        onOpenInContext={handleOpenInContext}
        onRetry={retry}
      />

      {continueTitle ? (
        <View style={styles.lines}>
          <Divider inset={space.xl} />
          <ContinueReading
            eyebrow={t('today.continue')}
            title={continueTitle}
            accessibilityHint={t('today.continueHint')}
            onPress={handleContinue}
          />
          <Divider inset={space.xl} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  lines: {
    marginTop: space.xxl,
  },
});
