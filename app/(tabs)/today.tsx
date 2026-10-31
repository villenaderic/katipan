import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContinueReading } from '@/components/today/ContinueReading';
import {
  DailyVerseHero,
  type DailyVerseHeroLabels,
} from '@/components/today/DailyVerseHero';
import { Divider } from '@/components/ui/Divider';
import { formatReadings } from '@/constants/plans';
import { useDailyVerse } from '@/hooks/useDailyVerse';
import { useI18n } from '@/i18n';
import { getTodayPlanItem, type TodayPlanItem } from '@/services/planService';
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
 * One verse, one "Continue reading" line, one reading-plan line. Nothing
 * else: no feed, no badges, no streak, no prompts.
 *
 *  - The plan line shows the next reading of the active plan. With no active
 *    plan, or a finished one, it is not drawn at all. It never says "behind"
 *    or "missed" (see planService.ts) and it never shows the streak.
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

  // The next reading of the active plan. Re-read every time Today comes back
  // into view, because the plan screen may have changed it.
  const [planItem, setPlanItem] = useState<TodayPlanItem | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getTodayPlanItem().then((item) => {
        if (!cancelled) setPlanItem(item);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

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

  const handleOpenPlan = useCallback((): void => {
    if (!acceptTap()) return;
    router.push('/plans');
  }, [acceptTap, router]);

  const planTitle = planItem ? formatReadings(planItem.chapters, uiLanguage) : null;

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

      {continueTitle || (planItem && planTitle) ? (
        <View style={styles.lines}>
          <Divider inset={space.xl} />
          {continueTitle ? (
            <>
              <ContinueReading
                eyebrow={t('today.continue')}
                title={continueTitle}
                accessibilityHint={t('today.continueHint')}
                onPress={handleContinue}
              />
              <Divider inset={space.xl} />
            </>
          ) : null}
          {planItem && planTitle ? (
            <>
              <ContinueReading
                eyebrow={t('today.planEyebrow', {
                  day: planItem.day,
                  total: planItem.totalDays,
                })}
                title={planTitle}
                detail={t(`plans.${planItem.planId}.name`)}
                accessibilityHint={t('today.planHint')}
                onPress={handleOpenPlan}
              />
              <Divider inset={space.xl} />
            </>
          ) : null}
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
